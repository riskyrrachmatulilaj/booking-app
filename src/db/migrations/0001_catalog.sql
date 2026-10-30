ALTER TABLE users ADD COLUMN active boolean NOT NULL DEFAULT true;
CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  price integer NOT NULL CHECK (price >= 0),
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX services_business_idx ON services(business_id);
CREATE UNIQUE INDEX services_business_name_idx ON services(business_id, name);
CREATE TABLE staff_services (
  staff_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);
CREATE INDEX staff_services_service_idx ON staff_services(service_id);
CREATE FUNCTION catalog_staff_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.staff_id AND role = 'staff') THEN
    RAISE EXCEPTION 'Catalog assignment requires staff' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_services_role BEFORE INSERT OR UPDATE ON staff_services FOR EACH ROW EXECUTE FUNCTION catalog_staff_only();
CREATE TABLE working_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday integer NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start text NOT NULL CHECK (start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  "end" text NOT NULL CHECK ("end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CHECK (start < "end")
);
CREATE INDEX working_hours_staff_day_idx ON working_hours(staff_id, weekday);
CREATE TRIGGER working_hours_role BEFORE INSERT OR UPDATE ON working_hours FOR EACH ROW EXECUTE FUNCTION catalog_staff_only();
