import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/lib/env';

export interface StorageAdapter {
  presignUpload(key: string, contentType: string): Promise<{ url: string; key: string }>;
  presignDownload(key: string): Promise<string>;
  getObject(key: string): Promise<{ body: Uint8Array; contentType: string }>;
  headObject(key: string): Promise<{ size: number; contentType: string } | null>;
  deleteObject(key: string): Promise<void>;
}

export function sanitizeFileName(name: string): string {
  // MVP (India-only scope): collapse anything outside [A-Za-z0-9._-] to '_'. This also
  // strips non-ASCII filenames (e.g. Devanagari) to underscores — revisit if i18n filenames matter.
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function documentKey(caseId: string, documentId: string, fileName: string): string {
  return `cases/${caseId}/documents/${documentId}/${sanitizeFileName(fileName)}`;
}

const UPLOAD_TTL_SECONDS = 600;
const DOWNLOAD_TTL_SECONDS = 300;

let client: S3Client | null = null;
function r2Client(): S3Client {
  if (client) return client;
  if (!env.R2_ENDPOINT || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 is not configured (R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)');
  }
  client = new S3Client({
    region: 'auto',
    endpoint: env.R2_ENDPOINT,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

export function makeR2StorageAdapter(): StorageAdapter {
  const bucket = env.R2_BUCKET;
  if (!bucket) throw new Error('R2_BUCKET is not configured');
  const c = r2Client();
  return {
    async presignUpload(key, contentType) {
      const url = await getSignedUrl(
        c,
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
        { expiresIn: UPLOAD_TTL_SECONDS },
      );
      return { url, key };
    },
    async presignDownload(key) {
      return getSignedUrl(c, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: DOWNLOAD_TTL_SECONDS,
      });
    },
    async getObject(key) {
      const out = await c.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = new Uint8Array(await out.Body!.transformToByteArray());
      return { body, contentType: out.ContentType ?? 'application/octet-stream' };
    },
    async headObject(key) {
      try {
        const out = await c.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return {
          size: out.ContentLength ?? 0,
          contentType: out.ContentType ?? 'application/octet-stream',
        };
      } catch (err) {
        // Only "the object isn't there" maps to null — callers use headObject as an
        // existence check (e.g. the finalize route). A network/auth/rate-limit error
        // must propagate so it isn't misread as "upload not found".
        if (err instanceof Error && (err.name === 'NotFound' || err.name === 'NoSuchKey')) {
          return null;
        }
        throw err;
      }
    },
    async deleteObject(key) {
      await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

export interface FakeStorageAdapter extends StorageAdapter {
  __putForTest(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

export function makeFakeStorageAdapter(): FakeStorageAdapter {
  const store = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    async presignUpload(key) {
      return { url: `https://fake-r2.local/${key}?sig=test`, key };
    },
    async presignDownload(key) {
      return `https://fake-r2.local/${key}?sig=test-get`;
    },
    async getObject(key) {
      const v = store.get(key);
      if (!v) throw new Error(`fake-r2: missing ${key}`);
      return v;
    },
    async headObject(key) {
      const v = store.get(key);
      return v ? { size: v.body.length, contentType: v.contentType } : null;
    },
    async deleteObject(key) {
      store.delete(key);
    },
    async __putForTest(key, body, contentType) {
      store.set(key, { body, contentType });
    },
  };
}
