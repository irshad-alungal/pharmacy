# Tests (no live Supabase needed)
    npm i @electric-sql/pglite
    node tests/billing-engine.test.mjs              # billing calculation / FEFO engine (25 checks)
    node tests/sql-billing-fefo.test.mjs            # migration 0020 on a stub schema (43 checks)
    node tests/live-replica/live-0021.test.mjs      # migration 0021 on a replica of the LIVE structure (63 checks)
    node tests/sql-phase2.test.mjs / sql-phase3.test.mjs   # older phase tests (core schema only)

## End-to-end (real pages in Chrome against the replica)
    sh tests/e2e/build-site.sh && node tests/e2e/server.mjs      # serves on http://localhost:8790
    pip install playwright && playwright install chromium
    python3 tests/e2e/flows.py && python3 tests/e2e/flows2.py    # 80 workflow checks
    python3 tests/e2e/monkey.py                                  # clicks every button, every role
Refresh `tests/live-replica/live-schema.json` by running `database/diagnostics/full_live_schema_export.sql` in Supabase and saving the result.
