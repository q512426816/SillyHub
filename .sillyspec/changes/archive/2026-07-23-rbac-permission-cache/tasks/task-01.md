---
id: task-01
title: 新建 core/permission_cache.py 权限缓存 helper（FR-01, D-002@v2/D-003@v2/D-004@v1/D-005@v1）
title_zh: 新建 core/permission_cache.py 权限缓存 helper
author: qinyi
created_at: 2026-07-23 09:42:00
priority: P1
depends_on: []
blocks: [task-03, task-04, task-05, task-06, task-07, task-08, task-09]
requirement_ids: [FR-01, FR-05]
decision_ids: [D-002@v2, D-003@v2, D-004@v1, D-005@v1]
allowed_paths:
  - backend/app/core/permission_cache.py
goal: >
  新建集中式权限缓存 helper,提供 has_permission 三个权限集(platform/all/workspace)与 PPM data_scope 的缓存读写,
  以及整体清空失效(失败升 ERROR)。复用 api_key_service 降级范式 + core/redis.py async 客户端,无新依赖。
implementation:
  - get/set_cached_permissions(user_id, *, scope, workspace_id=None):key 分别 `perm:{u}:platform`/`perm:{u}:all`/`perm:{u}:{wsid}`,value 为 JSON 序列化的 set[str];scope ∈ {platform,all,workspace},workspace 仅 scope=workspace 时必填
  - get/set_cached_ppm_scope(user_id):key `ppm-scope:{u}`,value JSON {manager_project_ids:[uuid-str...], is_super_admin:bool};**get 时 manager_project_ids 必须反序列化为 set[uuid.UUID]、is_super_admin 为 bool**(D-005@v1,否则 data_scope.problem_operable 的 `project_id in manager_pids`(uuid-in-set[str])恒 False,经理编辑/删除问题静默失效)
  - invalidate_all_permissions():用 scan_iter 扫描删除全部 `perm:*` + `ppm-scope:*`(量大改 pipeline/UNLINK);**失败升 structlog ERROR 级日志**(含触发点上下文),不向上抛、不阻断业务 commit(D-002@v2)
  - 业务读写(get/set)包 try/except 降级:Redis 故障 get 返回 None(miss,调用方回退查 DB)、set/delete 静默吞错(log warning)(D-004);**认证/鉴权永不因缓存层失败**
  - TTL 读 settings.permission_cache_ttl(默认 300,task-02 新增);task-01 与 task-02 同 Wave,执行时先做 task-02 字段即就位
acceptance:
  - get/set_cached_permissions 三种 scope 读写往返一致(set[str] 不变形)
  - get_cached_ppm_scope 反序列化后 manager_project_ids 元素类型为 uuid.UUID、is_super_admin 为 bool
  - invalidate_all_permissions 删除全部 perm:*/ppm-scope:* key;Redis 故障时记 ERROR 且不向上抛
  - 业务读写在 Redis 故障时 get 返回 None、set/delete 不抛
verify:
  - cd backend && uv run pytest tests/modules/test_permission_cache.py -q
  - cd backend && uv run mypy app/core/permission_cache.py
  - cd backend && uv run ruff check app/core/permission_cache.py
constraints:
  - D-003@v2:三键分离(platform/all/workspace),everywhere 不单独存(读 platform+all 内存并集)
  - D-004@v1:不引入 cachetools/TTLCache 本地兜底,Redis 故障直接回退 DB
  - D-005@v1:ppm-scope uuid 必须反序列化为 set[uuid.UUID]
  - D-002@v2:invalidate 失败升 ERROR(非 warning),业务读写故障仍降级静默
---

流程位置:Wave 1(缓存基础设施,无依赖)。下游 task-03/04(读接入)与 task-05~09(失效触发)均消费本 helper 的 public API。本 helper 不接 router/endpoint,经 rbac/data_scope 被 auth_deps 间接调用。
