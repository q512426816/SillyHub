-- migration.sql - 校验 alembic upgrade head 后的状态
-- change: 2026-06-16-admin-org-role-center / task-12
--
-- 使用：
--   docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T postgres \
--     psql -U sillyhub -d sillyhub -f /tmp/migration.sql
--
-- 校验项（人工/脚本读取输出对照）：
--   - 3 张新表：organizations / user_organizations / user_roles
--   - roles 表新增 2 字段：is_active（默认 true） / updated_at
--   - users 表新增 1 字段：login_enabled（默认 true）
--   - platform_admin 系统角色存在，is_system=true, is_active=true
--   - platform_admin 关联 32 项权限（Permission 全集）

\echo '=== Tables (organizations, user_organizations, user_roles) ==='
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('organizations', 'user_organizations', 'user_roles')
ORDER BY tablename;
-- 期望：3 行

\echo '=== roles columns (is_active, updated_at) ==='
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'roles'
  AND column_name IN ('is_active', 'updated_at')
ORDER BY column_name;
-- 期望：is_active | boolean | true
--       updated_at | timestamp with time zone | now()

\echo '=== users.login_enabled ==='
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name = 'login_enabled';
-- 期望：login_enabled | boolean | true

\echo '=== organizations columns ==='
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'organizations'
ORDER BY ordinal_position;

\echo '=== platform_admin role ==='
SELECT key, name, is_system, is_active
FROM roles
WHERE key = 'platform_admin';
-- 期望：platform_admin | platform_admin | t | t （1 行）

\echo '=== platform_admin permissions count ==='
SELECT count(*) AS perm_count
FROM role_permissions rp
JOIN roles r ON rp.role_id = r.id
WHERE r.key = 'platform_admin';
-- 期望：32（task-02 扩展后 Permission 全集）

\echo '=== platform_admin permission keys (sample) ==='
SELECT rp.permission
FROM role_permissions rp
JOIN roles r ON rp.role_id = r.id
WHERE r.key = 'platform_admin'
ORDER BY rp.permission;

\echo '=== Data integrity (counts) ==='
SELECT
  (SELECT count(*) FROM users) AS users_count,
  (SELECT count(*) FROM organizations) AS orgs_count,
  (SELECT count(*) FROM user_organizations) AS user_orgs_count,
  (SELECT count(*) FROM user_roles) AS user_roles_count,
  (SELECT count(*) FROM roles) AS roles_count,
  (SELECT count(*) FROM role_permissions) AS role_permissions_count;

\echo '=== roles with is_active=false (sample, expect 0 unless manually disabled) ==='
SELECT id, key, name, is_system, is_active
FROM roles
WHERE is_active = false
LIMIT 10;

\echo '=== users with login_enabled=false (sample, expect 0 unless manually disabled) ==='
SELECT id, email, login_enabled
FROM users
WHERE login_enabled = false
LIMIT 10;

\echo '=== Done ==='
