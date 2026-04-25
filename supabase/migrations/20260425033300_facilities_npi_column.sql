-- facilities.npi: identity from NPPES via NLM CTSS lookups (issue #13 phase B).
--
-- POS-sourced ASCs already populate facilities.external_id (the CMS provider
-- number / CCN); they leave npi null. CTSS-sourced facilities populate npi.
-- A facility may have BOTH set (cross-validated) when a CTSS pick matches an
-- existing POS row by name+state during upsert — that's the "Medicare-certified"
-- signal preserved from the POS ETL.

alter table facilities
    add column npi text;

alter table facilities
    add constraint facilities_npi_shape
    check (npi is null or npi ~ '^\d{10}$');

create unique index facilities_npi_key on facilities (npi)
    where npi is not null;
