CREATE TABLE IF NOT EXISTS "key_backup_secrets" (
	"user_id" bigint NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "key_backup_secrets_user_id_version_name_pk" PRIMARY KEY("user_id","version","name")
);
