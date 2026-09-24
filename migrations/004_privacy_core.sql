-- Stackroom v4.1 — Privacy Core
-- User vault metadata only.
-- The server never stores the plaintext vault master key.

create table if not exists user_vaults (
    owner_id text primary key,

    encrypted_master_key text not null,
    salt text not null,
    wrap_iv text not null,

    kdf text not null default 'PBKDF2-SHA256',
    kdf_iterations integer not null default 600000,

    crypto_version integer not null default 1,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists user_vaults_owner_id_idx
    on user_vaults(owner_id);

-- Encrypted project payload support.
-- Existing plaintext columns remain untouched during migration.

alter table projects
    add column if not exists encrypted_payload text;

alter table projects
    add column if not exists encryption_version integer;

alter table projects
    add column if not exists is_encrypted boolean not null default false;