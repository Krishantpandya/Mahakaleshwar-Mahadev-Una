-- Predefined guest comment options. Existing custom comments remain unchanged.
-- Apply after 002_single_admin_sessions.sql.
BEGIN;

CREATE TABLE predefined_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    body TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT predefined_comments_body_not_empty CHECK (length(trim(body)) > 0),
    CONSTRAINT predefined_comments_body_max_length CHECK (char_length(body) <= 2000)
);

CREATE UNIQUE INDEX predefined_comments_body_lower_unique
    ON predefined_comments (lower(body));

ALTER TABLE photo_comments
    ADD COLUMN predefined_comment_id UUID
    REFERENCES predefined_comments(id) ON DELETE SET NULL;

CREATE INDEX photo_comments_predefined_comment_id_idx
    ON photo_comments (predefined_comment_id)
    WHERE predefined_comment_id IS NOT NULL;

-- Only seed wording explicitly confirmed by the site owner.
INSERT INTO predefined_comments (body, sort_order)
VALUES ('Har Har Mahadev', 10)
ON CONFLICT (lower(body)) DO NOTHING;

COMMIT;
