-- Existing rows deliberately keep NULL. Their original delivery address cannot
-- be reconstructed safely, so the application rejects them and offers a new link.
ALTER TABLE email_auth_tokens ADD COLUMN target_email TEXT;
