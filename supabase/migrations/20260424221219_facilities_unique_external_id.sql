-- The initial schema created a PARTIAL unique index on facilities.external_id
-- (WHERE external_id IS NOT NULL). Postgres requires a full unique constraint
-- or non-partial unique index to be targeted by ON CONFLICT, which the CMS ETL
-- relies on to upsert by external_id. Drop the partial index and recreate it
-- as a full unique index.
--
-- Rows with NULL external_id remain non-conflicting: default NULLS DISTINCT
-- still treats multiple NULLs as distinct, so phase-2 user-added facilities
-- without a CMS CCN can coexist.

drop index if exists facilities_external_id_key;

create unique index facilities_external_id_key on facilities (external_id);
