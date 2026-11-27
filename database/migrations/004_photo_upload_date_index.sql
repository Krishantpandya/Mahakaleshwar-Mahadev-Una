-- Index upload timestamps for the visitor photo date filter and newest-first listing.
-- Apply after 003_predefined_comments.sql.
BEGIN;

CREATE INDEX photos_created_at_idx ON photos (created_at DESC);

COMMIT;
