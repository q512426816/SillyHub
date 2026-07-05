---
author: qinyi
created_at: 2026-06-27T01:05:08
---

# Tasks: 2026-06-27-p0-perf-optimization

P0 性能优化三件套（阿里云 2核1.6G 单用户卡顿根因：API key 每请求同步 bcrypt cost12 阻塞事件循环）。无 API 行为变更，纯优化。

## P0-1 API key 认证 Redis 缓存 + bcrypt 异步化
- [x] `backend/app/core/config.py`：加 `auth_api_key_cache_ttl`(默认 60) / `auth_api_key_negative_cache_ttl`(默认 30) （done）
- [x] `backend/app/modules/auth/api_key_service.py`：
  - [x] authenticate 加正缓存 `auth:apikey:{key_prefix}:{sha256(plaintext)}` 存 user_id，TTL=正 TTL；命中后仍查 DB 校验 user 实时状态（active/未删除），不缓存 bcrypt 结果直接放行
  - [x] authenticate 加负缓存 `auth:apikey:neg:{sha256(plaintext)}` 存 "1"，TTL=负 TTL，防止无效 key 探测穿透
  - [x] bcrypt `verify_refresh_token` 放 `asyncio.to_thread` 不阻塞事件循环
  - [x] 缓存读写 try/except 降级：redis 不可用时回退原 bcrypt 路径（测试/生产抖动不影响认证）
  - [x] revoke 改为先查 `key_prefix`，UPDATE revoked_at 后 SCAN `auth:apikey:{key_prefix}:*` 清正缓存

## P0-2 agent_run_logs 索引
- [x] `backend/app/modules/agent/model.py`：`AgentRunLog.__table_args__` 加 `ix_agent_run_logs_timestamp`(单列) + `ix_agent_run_logs_run_timestamp`(run_id,timestamp 联合)。注：该表无 started_at 字段（属 agent_runs），跳过。
- [x] `backend/migrations/versions/202606271300_add_agent_run_log_indexes.py`：down_revision=`202606261130`，upgrade 加索引 / downgrade 删索引（可回滚）

## P0-3 容器 mem_limit
- [x] `deploy/docker-compose.yml`：postgres `mem_limit: 256m` / redis `mem_limit: 128m` / backend `mem_limit: 800m` / frontend `mem_limit: 400m`（总和 1584m ≤ 1.6G 物理）

## 验证
- [x] `cd backend && python -m pytest tests/ -x -q`
- [x] Alembic 迁移 upgrade/downgrade 可逆自检
