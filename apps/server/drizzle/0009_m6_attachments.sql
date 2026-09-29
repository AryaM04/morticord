ALTER TABLE "attachments" DROP CONSTRAINT "attachments_channel_id_channels_id_fk";
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attachments" ADD CONSTRAINT "attachments_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachments_uploader_idx" ON "attachments" USING btree ("uploader_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachments_created_idx" ON "attachments" USING btree ("created_at");