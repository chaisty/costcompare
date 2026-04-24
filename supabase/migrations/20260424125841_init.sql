-- Initial schema for costcompare.
-- Tables: procedures, facilities, submissions (private), rates (public).
-- See supabase/schema-design.md for rationale.

create extension if not exists pgcrypto;

-- Enums

create type rate_type as enum ('cash', 'medicare', 'negotiated');

create type submission_status as enum ('pending', 'confirmed', 'rejected');

create type facility_type as enum ('asc', 'hospital', 'medical_center', 'clinic', 'other');

-- procedures: reference data, one row per procedure concept.

create table procedures (
    id uuid primary key default gen_random_uuid(),
    primary_code text not null,
    procedure_codes text[] not null,
    name text not null,
    description text,
    created_at timestamptz not null default now(),
    constraint procedures_primary_code_in_codes
        check (primary_code = any(procedure_codes))
);

create unique index procedures_primary_code_key on procedures (primary_code);

-- facilities: seeded from CMS ETL; user submissions reference existing rows.

create table facilities (
    id uuid primary key default gen_random_uuid(),
    external_id text,
    name text not null,
    facility_type facility_type not null,
    address_line1 text,
    address_line2 text,
    city text,
    state text,
    zip text,
    network text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint facilities_state_format check (state is null or state ~ '^[A-Z]{2}$')
);

create unique index facilities_external_id_key on facilities (external_id)
    where external_id is not null;

create index facilities_state_idx on facilities (state);

-- rates: public read surface. Cash + Medicare + negotiated unified.
-- Defined before submissions so submissions.rate_id FK resolves.

create table rates (
    id uuid primary key default gen_random_uuid(),
    rate_type rate_type not null,
    facility_id uuid references facilities(id) on delete set null,
    procedure_codes text[] not null,
    price numeric(10, 2) not null,
    rate_year int not null,
    locality text,
    payer text,
    plan_variant text,
    source_url text,
    source_fetched_at timestamptz,
    confidence_note text,
    source_submission_id uuid,
    created_at timestamptz not null default now(),
    constraint rates_price_positive check (price > 0),
    constraint rates_year_range check (rate_year between 2000 and 2100),
    constraint rates_cash_has_submission
        check ((rate_type = 'cash') = (source_submission_id is not null)),
    constraint rates_non_cash_has_provenance
        check (rate_type = 'cash'
               or (source_url is not null and source_fetched_at is not null))
);

create index rates_procedure_codes_gin on rates using gin (procedure_codes);
create index rates_rate_type_idx on rates (rate_type);
create index rates_facility_idx on rates (facility_id);

-- submissions: PRIVATE. Anon has no grants here; written via RPC only.

create table submissions (
    id uuid primary key default gen_random_uuid(),
    email text not null check (email <> '' and email = lower(email)),
    facility_id uuid not null references facilities(id) on delete restrict,
    procedure_codes text[] not null,
    quoted_price numeric(10, 2) not null,
    quote_year int not null,
    had_procedure boolean not null,
    submission_status submission_status not null default 'pending',
    token_hash text not null,
    token_expires_at timestamptz not null default (now() + interval '48 hours'),
    confirmed_at timestamptz,
    submitter_ip_hash text not null,
    rate_id uuid references rates(id) on delete set null,
    created_at timestamptz not null default now(),
    constraint submissions_price_positive check (quoted_price > 0),
    constraint submissions_year_range check (quote_year between 2000 and 2100)
);

create index submissions_email_created_idx on submissions (email, created_at desc);
create index submissions_ip_hash_created_idx on submissions (submitter_ip_hash, created_at desc);
create index submissions_token_hash_idx on submissions (token_hash);

-- Back-reference: rates.source_submission_id -> submissions.id.
-- Added after both tables exist to avoid a circular FK at create time.

alter table rates
    add constraint rates_source_submission_fk
    foreign key (source_submission_id) references submissions(id) on delete cascade;

-- updated_at trigger for facilities

create or replace function set_updated_at() returns trigger
    language plpgsql
    as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create trigger facilities_set_updated_at
    before update on facilities
    for each row execute function set_updated_at();
