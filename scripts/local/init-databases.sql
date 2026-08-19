-- Runs once, on first boot of the postgres volume.
--
-- `neondb` is created by POSTGRES_DB; this adds the test database so
-- `npm run test:int` has somewhere isolated to be destructive. Their separation
-- is the same guarantee `scripts/guard-test-db.ts` enforces against Neon: the
-- integration suite wipes what it points at, so it must never point at the
-- database holding sixteen years of league history.
CREATE DATABASE neondb_test;
