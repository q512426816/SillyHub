---
author: qinyi
created_at: 2026-07-23 09:16:00
change: 2026-07-23-rbac-permission-cache
plan_level: large
---

# 实现计划(Plan)

> **无 Spike**:技术方案确定(复用 `api_key_service` 范式 + Redis 已就绪 + "整体清空 + TTL 兜底 + 降级回 DB"),无未验证集成。task 细节见 `tasks/task-NN.md` 蓝图。

## 概览

- plan_level: large
- 总 task: 10(task-01~10,细节见 `tasks/task-NN.md`)
- Wave: 3(基础设施 → 读接入+失效触发 → 测试)

## 依赖图

```
Wave 1 (基础设施: task-01/02) ──┬─→ Wave 2 (读接入 task-03/04 + 失效触发 task-05~09) ──→ Wave 3 (测试 task-10)
```

Wave 2 全部只依赖 task-01,内部可并行;Wave 3 依赖 task-01~09。

## Wave 1: 缓存基础设施(无依赖)

- [ ] task-01: 新建 core/permission_cache.py 缓存 helper(覆盖: FR-01, FR-05, D-001@v1, D-002@v2, D-003@v2, D-004@v1, D-005@v1)
- [ ] task-02: core/config.py 加 permission_cache_ttl=300(覆盖: FR-05)

## Wave 2: 缓存读接入 + 失效触发(均依赖 task-01,可并行)

> 读接入(task-03/04)与失效触发(task-05~09)是两类关注点,均只依赖 task-01,同 Wave 并行。

- [ ] task-03: auth/rbac.py collect_* 缓存接入 + everywhere 内存并集(覆盖: FR-02, D-003@v2)
- [ ] task-04: ppm/common/data_scope.py manager_project_ids/is_super_admin 缓存接入(覆盖: FR-03, D-005@v1)
- [ ] task-05: admin/roles_service 失效 hook(覆盖: FR-04, D-002@v2)
- [ ] task-06: admin/users_service 失效 hook(覆盖: FR-04, D-002@v2)
- [ ] task-07: workspace/members_service 失效 hook(覆盖: FR-04, D-002@v2)
- [ ] task-08: workspace/service `_ensure_creator_as_owner` 所有调用方(create + scan_generate)失效 hook(覆盖: FR-04, D-006@v1, D-002@v2)
- [ ] task-09: ppm/project/service.ProjectMemberService 失效 hook(覆盖: FR-04, D-002@v2)

## Wave 3: 测试(依赖 task-01~09)

- [ ] task-10: 权限缓存测试(读写/降级/失效安全含 scan_generate/uuid 类型/无 Redis 回退)(覆盖: FR-06, AC-01~05)

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D |
|---|---|---|---|---|---|
| task-01 | 新建 permission_cache.py helper | W1 | P1 | — | FR-01, FR-05, D-001@v1/D-002@v2/D-003@v2/D-004/D-005 |
| task-02 | config 加 permission_cache_ttl | W1 | P5 | — | FR-05 |
| task-03 | rbac collect_* 缓存接入 | W2 | P2 | task-01 | FR-02, D-003@v2 |
| task-04 | data_scope 缓存接入 | W2 | P3 | task-01 | FR-03, D-005@v1 |
| task-05 | roles_service 失效 hook | W2 | P4 | task-01 | FR-04, D-002@v2 |
| task-06 | users_service 失效 hook | W2 | P4 | task-01 | FR-04, D-002@v2 |
| task-07 | members_service 失效 hook | W2 | P4 | task-01 | FR-04, D-002@v2 |
| task-08 | workspace/service(create+scan_generate)失效 hook | W2 | P4 | task-01 | FR-04, D-006@v1, D-002@v2 |
| task-09 | ProjectMemberService 失效 hook | W2 | P4 | task-01 | FR-04, D-002@v2 |
| task-10 | 权限缓存测试 | W3 | P6 | task-01,03~09 | FR-06, AC-01~05 |

## 测试策略注意(execute/verify 阶段处理)

- `local.yaml` `test_strategy=module`,modules 块**仅定义 ppm/frontend/daemon**。本次改动跨 auth/admin/workspace/core,verify 时这些路径不在 module 定义内 → execute 完成后 verify 阶段需确认测试命令覆盖(可能需补 `local.yaml` modules 定义 auth/admin/workspace/core,或 verify 手动指定 `cd backend && uv run pytest app/modules/auth app/modules/admin app/modules/workspace app/modules/ppm tests/modules/test_permission_cache.py -q --no-cov`)。
- 测试用 SQLite(aiosqlite),无 Redis → 走降级回 DB 路径(正确行为,AC-03 验证);Redis 读写用 fakeredis 或 mock。

## 生产接线

- 入口:`backend/app/main.py`(uvicorn app.main:app),**无需改入口**。
- `permission_cache.py` 经 rbac/data_scope 被 `auth_deps` 间接调用,无需新增 router/endpoint。
- Redis 已是基础设施(`deploy/docker-compose.yml` redis:7-alpine + `core/redis.py` async 客户端),无需新基建。
