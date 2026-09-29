ALTER TABLE "fallback_keys" DROP CONSTRAINT "fallback_keys_device_id_devices_id_fk";
--> statement-breakpoint
ALTER TABLE "one_time_keys" DROP CONSTRAINT "one_time_keys_device_id_devices_id_fk";
--> statement-breakpoint
ALTER TABLE "to_device_queue" DROP CONSTRAINT "to_device_queue_recipient_device_id_devices_id_fk";
--> statement-breakpoint
ALTER TABLE "to_device_queue" DROP CONSTRAINT "to_device_queue_sender_device_id_devices_id_fk";
--> statement-breakpoint
ALTER TABLE "cross_signing_keys" ADD COLUMN "device_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "cross_signing_keys" ADD COLUMN "device_signature" text NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "key_signature" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "master_signature" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fallback_keys" ADD COLUMN "signature" text NOT NULL;--> statement-breakpoint
ALTER TABLE "fallback_keys" ADD COLUMN "used" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "one_time_keys" ADD COLUMN "signature" text NOT NULL;--> statement-breakpoint
ALTER TABLE "to_device_queue" ADD COLUMN "sender_user_id" bigint NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fallback_keys" ADD CONSTRAINT "fallback_keys_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "one_time_keys" ADD CONSTRAINT "one_time_keys_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "to_device_queue" ADD CONSTRAINT "to_device_queue_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "to_device_queue" ADD CONSTRAINT "to_device_queue_recipient_device_id_devices_id_fk" FOREIGN KEY ("recipient_device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "to_device_queue" ADD CONSTRAINT "to_device_queue_sender_device_id_devices_id_fk" FOREIGN KEY ("sender_device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "to_device_queue_recipient_id_idx" ON "to_device_queue" USING btree ("recipient_device_id","id");