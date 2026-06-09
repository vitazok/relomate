ALTER TABLE "approvals" ADD COLUMN "assignee_user_id" uuid;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "required_role" text DEFAULT 'applicant' NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "escalation_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "visibility" text DEFAULT 'shared' NOT NULL;--> statement-breakpoint
UPDATE "approvals" SET "assignee_user_id" = "user_id", "visibility" = 'client_visible' WHERE "subject_type" = 'document';--> statement-breakpoint
UPDATE "approvals" SET "required_role" = 'consultant', "visibility" = 'internal' WHERE "subject_type" = 'draft';--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
