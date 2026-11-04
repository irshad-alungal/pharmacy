# SQL tests (local in-memory Postgres, no Supabase needed)
    npm i @electric-sql/pglite
    node tests/sql-phase2.test.mjs    # purchasing (20 checks)
    node tests/sql-phase3.test.mjs    # inventory (22 checks)
Stubs Supabase's `auth` schema, runs all migrations (twice, for idempotency), then checks logic, RLS and column privileges per role.
Last run: Phase 2 = 20 passed, Phase 3 = 22 passed, 0 failed. These do not test the browser screens.
