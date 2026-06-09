CREATE TABLE "case_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"invited_email" text,
	"role" text NOT NULL,
	"invitation_status" text DEFAULT 'active' NOT NULL,
	"visibility" text DEFAULT 'shared' NOT NULL,
	"relation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_participants" ADD CONSTRAINT "case_participants_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_participants" ADD CONSTRAINT "case_participants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_participants" ADD CONSTRAINT "case_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "case_participants" (
	"case_id",
	"organization_id",
	"user_id",
	"role",
	"invitation_status",
	"visibility",
	"relation"
)
SELECT
	"id",
	"organization_id",
	"primary_applicant_user_id",
	'applicant',
	'active',
	'shared',
	'{"kind":"primary_applicant"}'::jsonb
FROM "cases";--> statement-breakpoint
CREATE UNIQUE INDEX "case_participants_case_user_role_unique" ON "case_participants" USING btree ("case_id","user_id","role") WHERE "case_participants"."user_id" IS NOT NULL;
