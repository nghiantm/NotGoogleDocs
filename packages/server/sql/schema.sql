-- Idempotent schema — safe to run multiple times

CREATE TABLE IF NOT EXISTS documents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title              VARCHAR NOT NULL DEFAULT 'Untitled',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  slug               VARCHAR(64) UNIQUE,
  salt               BYTEA,
  kdf_iterations     INTEGER DEFAULT 600000,
  verifier           TEXT,
  encryption_version SMALLINT DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS doc_sequences (
  doc_id   UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  next_seq BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS operations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id        UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  seq           BIGINT NOT NULL,
  client_id     VARCHAR NOT NULL,
  lamport_clock BIGINT NOT NULL,
  op_type       VARCHAR NOT NULL,
  char_id       VARCHAR NOT NULL,
  char_value       CHAR(1),
  left_id          VARCHAR,
  right_id         VARCHAR,
  is_deleted       BOOLEAN NOT NULL DEFAULT false,
  wall_clock       BIGINT NOT NULL,
  encrypted_value  TEXT,
  UNIQUE (doc_id, seq)
);

CREATE INDEX IF NOT EXISTS operations_doc_seq
  ON operations (doc_id, seq ASC);

CREATE INDEX IF NOT EXISTS operations_doc_wall_clock
  ON operations (doc_id, wall_clock ASC);

CREATE TABLE IF NOT EXISTS snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id       UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  snapshot_seq BIGINT NOT NULL,
  state        JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doc_id, snapshot_seq)
);

CREATE INDEX IF NOT EXISTS snapshots_doc_seq_desc
  ON snapshots (doc_id, snapshot_seq DESC);

CREATE INDEX IF NOT EXISTS idx_documents_slug ON documents(slug) WHERE slug IS NOT NULL;

CREATE OR REPLACE FUNCTION next_seq(p_doc_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_seq BIGINT;
BEGIN
  INSERT INTO doc_sequences (doc_id, next_seq)
    VALUES (p_doc_id, 2)
    ON CONFLICT (doc_id) DO UPDATE
      SET next_seq = doc_sequences.next_seq + 1
    RETURNING next_seq - 1 INTO v_seq;
  RETURN v_seq;
END;
$$;
