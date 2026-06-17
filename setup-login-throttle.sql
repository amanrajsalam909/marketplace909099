-- Invisible brute-force throttle for admin/vendor PASSWORD logins.
-- One row per principal (e.g. 'vendor:alice@example.com'); cleared on success.
-- The app FAILS OPEN if this table is absent, so deploying the code before
-- running this SQL will not lock anyone out — it just leaves logins unthrottled
-- until the table exists.

create table if not exists login_attempts (
  identifier    text primary key,
  fails         integer not null default 0,
  blocked_until timestamptz,
  updated_at    timestamptz not null default now()
);

-- Service role (used by the API) bypasses RLS; enabling it keeps the table
-- locked down to anon/auth clients as defense-in-depth.
alter table login_attempts enable row level security;
