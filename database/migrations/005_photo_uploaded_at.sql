-- Store the photo's actual upload timestamp separately from row creation time.
-- Existing photos are backfilled from their existing created_at timestamp.
BEGIN;

ALTER TABLE photos ADD COLUMN uploaded_at TIMESTAMPTZ;
UPDATE photos SET uploaded_at = created_at WHERE uploaded_at IS NULL;
ALTER TABLE photos ALTER COLUMN uploaded_at SET DEFAULT NOW();
ALTER TABLE photos ALTER COLUMN uploaded_at SET NOT NULL;

CREATE INDEX photos_uploaded_at_idx ON photos (uploaded_at DESC);
DROP INDEX photos_created_at_idx;

COMMIT;
