-- Seed reference data. Procedures table is versioned in migrations because
-- the set of procedures is small and part of the app's identity; facilities
-- are seeded by the CMS ETL (tools/), not here.

insert into procedures (primary_code, procedure_codes, name, description)
values (
    '64628',
    array['64628'],
    'Intracept',
    'Basivertebral nerve ablation for chronic low back pain'
)
on conflict (primary_code) do nothing;
