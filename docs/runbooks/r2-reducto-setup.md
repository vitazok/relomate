# R2 + Reducto Provisioning Runbook

Steps to turn on real object storage and document extraction for Phase 3A. Until these
are done, the pipeline runs on the Anthropic-vision fallback with R2 unavailable (uploads
will fail; unit tests use fakes and are unaffected).

## A. Cloudflare R2 bucket

1. Cloudflare dashboard → **R2** → **Create bucket**.
   - Name: `visa-documents` (or your choice — this is `R2_BUCKET`).
   - **Location / jurisdiction: European Union (EU)** — data residency requirement.
2. Bucket → **Settings** → enable **server-side encryption (SSE-S3)** if not on by default.
3. Bucket → **Settings** → **CORS policy** → add:
   ```json
   [
     {
       "AllowedOrigins": ["https://YOUR-APP-DOMAIN", "http://localhost:3000"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   CORS is required because the browser PUTs bytes straight to R2 via the presigned URL
   (presigned direct upload, bypassing Vercel's ~4.5 MB body limit).
4. **R2** → **Manage R2 API Tokens** → **Create API token**:
   - Permissions: **Object Read & Write**, scoped to the bucket.
   - Copy the **Access Key ID** → `R2_ACCESS_KEY_ID`.
   - Copy the **Secret Access Key** → `R2_SECRET_ACCESS_KEY`.
5. Your **Account ID** (R2 overview page) → `R2_ACCOUNT_ID`.
6. Endpoint → `R2_ENDPOINT` = `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`.

Set all five in `.env.local` (dev) and Vercel project env (prod). All five are
`superRefine`-required in production (`src/lib/env.ts`), like `AUTH_RESEND_KEY`:
```
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=visa-documents
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
```

## B. Reducto

1. Sign up at https://reducto.ai → create an account (first 15,000 credits free).
2. Dashboard → **API Keys** → create a key → copy → `REDUCTO_API_KEY`.
3. Set `REDUCTO_API_KEY` in `.env.local` and Vercel env. Unlike the `R2_*` vars,
   `REDUCTO_API_KEY` is **NOT** production-required — without it the pipeline uses the
   Anthropic-vision provider (`makeExtractionProvider()` returns vision-only when the key
   is absent; with it, Reducto primary + vision fallback via `withFallback`).
4. **Verify the live API shape** against `src/lib/extraction/reducto.ts`:
   - Confirm the parse/extract endpoint path, request body keys, and where per-field
     confidence appears in the response. Reconcile `reducto.ts` + `tests/extraction/reducto.test.ts`
     if they differ from the live contract (the plan pinned a best-effort shape).
   - Until verified, the vision fallback carries extraction — no error.

## C. Database migration

The `documents` table ships in `drizzle/0003_dear_grandmaster.sql`. Apply it to the real DB
before the routes will work:
```bash
pnpm db:migrate   # uses DIRECT_URL (session pooler, port 5432)
```

## D. Smoke test

With env set, the migration applied, and a real case id owned by a real user:
```bash
node --env-file=.env.local --import tsx scripts/dev-only/extract-doc.ts ./fixtures/passport.pdf <caseId>
```
The script looks up the case owner, uploads the fixture to R2, runs the extract-document
workflow against the real provider, and dumps the row. Expect `status: 'awaiting_confirmation'`
with extracted fields + per-field confidences.

**PII check:** spot-check that `activity_log` rows of kind `case.document.extracted` carry
field KEYS + confidences only — never field values (e.g. `passportNumber` the key, never the
number). Values live only in the `documents.extracted` column.
