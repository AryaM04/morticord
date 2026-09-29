ALTER TABLE "cross_signing_keys" DROP COLUMN IF EXISTS "self_signing_key";--> statement-breakpoint
ALTER TABLE "cross_signing_keys" DROP COLUMN IF EXISTS "signatures";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN IF EXISTS "signature_by_user_ssk";--> statement-breakpoint
ALTER TABLE "one_time_keys" DROP COLUMN IF EXISTS "claimed";