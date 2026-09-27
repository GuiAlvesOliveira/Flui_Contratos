-- Target: Supabase project (Auth only) — NOT the Azure PostgreSQL app database,
-- whose schema is owned by the TypeORM migrations in backend/src/database.
-- Applied 2026-09-27; version matches supabase_migrations.schema_migrations.

-- SEC-04 (#118): rls_auto_enable() is the SECURITY DEFINER function behind the
-- `ensure_rls` event trigger (auto-enables RLS on new tables). Event triggers
-- don't check EXECUTE when they fire, so no role needs to call it directly —
-- but the default grants exposed it to anon/authenticated via /rest/v1/rpc.
-- PUBLIC is revoked too; otherwise both roles would keep inheriting EXECUTE.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
