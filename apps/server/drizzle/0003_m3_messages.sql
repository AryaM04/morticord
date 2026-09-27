ALTER TABLE "channels" ADD COLUMN "last_event_id" bigint;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "codec" text DEFAULT 'plain-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "nonce" text NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_channel_id_idx" ON "events" USING btree ("channel_id","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_relates_to_idx" ON "events" USING btree ("relates_to_id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_sender_device_nonce_key" UNIQUE("sender_device_id","nonce");