-- Fail explicitly rather than running without database overlap protection.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS btree_gist;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION 'Booking migration requires btree_gist. Ask the database owner to install the extension and rerun migration.';
END $$;
CREATE TYPE appointment_status AS ENUM ('confirmed', 'cancelled', 'completed');
CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES users(id),
  staff_id uuid NOT NULL REFERENCES users(id),
  service_id uuid NOT NULL REFERENCES services(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  price integer NOT NULL CHECK (price >= 0),
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
  status appointment_status NOT NULL DEFAULT 'confirmed',
  sequence integer NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (ends_at = starts_at + duration_minutes * interval '1 minute'),
  CONSTRAINT appointments_staff_overlap EXCLUDE USING gist
    (staff_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
    WHERE (status = 'confirmed')
);
CREATE INDEX appointments_customer_start_idx ON appointments(customer_id, starts_at, id);
CREATE INDEX appointments_staff_start_idx ON appointments(staff_id, starts_at, id);
CREATE INDEX appointments_start_idx ON appointments(starts_at, id);
CREATE INDEX appointments_service_idx ON appointments(service_id);
