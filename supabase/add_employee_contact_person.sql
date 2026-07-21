-- Emergency/contact person for each employee, captured at creation time.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contact_person_name text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contact_person_relationship text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contact_person_phone text;
