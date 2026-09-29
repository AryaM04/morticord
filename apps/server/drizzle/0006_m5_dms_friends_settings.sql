ALTER TABLE "channel_recipients" ADD COLUMN "joined_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "dm_key" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_recipients_user_idx" ON "channel_recipients" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_dm_key_key" UNIQUE("dm_key");--> statement-breakpoint
-- The old "pending" status had no direction. No code wrote it, so drop any such row.
DELETE FROM "friendships" WHERE "status" = 'pending';
