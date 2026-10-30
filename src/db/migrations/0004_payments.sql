ALTER TABLE appointments ADD COLUMN calendar_uid uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
CREATE TYPE payment_status AS ENUM ('paid', 'refunded');
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL UNIQUE REFERENCES appointments(id),
  amount integer NOT NULL CHECK (amount >= 0),
  status payment_status NOT NULL DEFAULT 'paid',
  simulated boolean NOT NULL DEFAULT true CHECK (simulated),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
