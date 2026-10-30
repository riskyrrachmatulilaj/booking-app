ALTER TABLE users ADD COLUMN whatsapp_phone text CHECK (whatsapp_phone ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE users ADD COLUMN whatsapp_opted_in_at timestamptz;
ALTER TABLE users ADD CONSTRAINT users_whatsapp_consent CHECK (whatsapp_opted_in_at IS NULL OR whatsapp_phone IS NOT NULL);
CREATE TYPE reminder_status AS ENUM ('pending','sent','failed','cancelled');
CREATE TABLE reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  phone_snapshot text NOT NULL CHECK (phone_snapshot ~ '^\+[1-9][0-9]{7,14}$'),
  due_at timestamptz NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  status reminder_status NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  lease_token uuid,
  lease_until timestamptz,
  provider_message_id text,
  last_error text,
  CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  CHECK (status <> 'sent' OR provider_message_id IS NOT NULL)
);
CREATE INDEX reminders_due_idx ON reminders(status,next_attempt_at,due_at);
