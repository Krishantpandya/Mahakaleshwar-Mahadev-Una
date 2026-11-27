-- Allow private object storage keys to be the durable media reference.
-- Presigned URLs are temporary and must not be required in database rows.
BEGIN;

ALTER TABLE photos
    ALTER COLUMN media_url DROP NOT NULL;

ALTER TABLE announcements
    ALTER COLUMN poster_media_url DROP NOT NULL;

ALTER TABLE announcements
    DROP CONSTRAINT announcements_content_required;

ALTER TABLE announcements
    ADD CONSTRAINT announcements_content_required
    CHECK (
        (message IS NOT NULL AND length(trim(message)) > 0)
        OR poster_storage_key IS NOT NULL
    );

ALTER TABLE announcements
    DROP CONSTRAINT announcements_poster_fields_paired;

ALTER TABLE announcements
    ADD CONSTRAINT announcements_poster_url_requires_storage_key
    CHECK (poster_media_url IS NULL OR poster_storage_key IS NOT NULL);

COMMIT;
