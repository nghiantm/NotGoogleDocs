-- Idempotent encryption migration — safe to run multiple times

ALTER TABLE documents ADD COLUMN IF NOT EXISTS slug VARCHAR(64) UNIQUE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS salt BYTEA;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS kdf_iterations INTEGER DEFAULT 600000;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS verifier TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS encryption_version SMALLINT DEFAULT 0 NOT NULL;

ALTER TABLE operations ADD COLUMN IF NOT EXISTS encrypted_value TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_slug ON documents(slug) WHERE slug IS NOT NULL;
