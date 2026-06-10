CREATE TABLE "organization_members" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "primary_applicant_user_id" uuid;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "assigned_consultant_id" uuid;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "reviewer_id" uuid;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "stage" text DEFAULT 'intake' NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "priority" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "target_submission_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "organization_members" ("organization_id", "user_id", "role", "status")
SELECT "organization_id", "id", 'firm_admin', 'active' FROM "users"
ON CONFLICT ("organization_id", "user_id") DO NOTHING;--> statement-breakpoint
UPDATE "cases"
SET
	"organization_id" = "users"."organization_id",
	"primary_applicant_user_id" = "cases"."user_id"
FROM "users"
WHERE "cases"."user_id" = "users"."id";--> statement-breakpoint
ALTER TABLE "cases" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ALTER COLUMN "primary_applicant_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_primary_applicant_user_id_users_id_fk" FOREIGN KEY ("primary_applicant_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_assigned_consultant_id_users_id_fk" FOREIGN KEY ("assigned_consultant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
