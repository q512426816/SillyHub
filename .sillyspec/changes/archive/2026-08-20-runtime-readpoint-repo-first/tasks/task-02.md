---
schema_version: 1
doc_type: task
id: task-02
title: Backend runtime RPC params carry root_path
title_zh: backend 四个 runtime.* RPC params 加 root_path
author: qinyi
created_at: 2026-08-20T11:05:00+08:00
change_name: 2026-08-20-runtime-readpoint-repo-first
wave: 1
allowed_paths:
  - backend/app/modules/runtime/service.py
  - backend/app/modules/runtime/tests/test_live_service.py
  - backend/app/modules/runtime/tests/test_router.py
provides:
  - 四个服务方法 RPC params 均含 root_path（resolve_root_path_for_daemon(binding.root_path) 改写后值）
expects_from:
  - resolve_root_path_for_daemon（workspace/service.py:75，既有）
goal: backend 把当前用户 binding 行的 root_path 经容器→宿主改写后随四个 runtime.* RPC 下发
implementation: _resolve_binding 返回 (daemon_id, root_path)；四方法 params 加 root_path 键；老 daemon 忽略新键（兼容性由 daemon 侧契约保证）
acceptance: test_live_service.py 断言四方法 params 含改写后 root_path（patch settings 前缀验证改写生效）；无 binding 仍 404；test_router.py:152 精确 params 断言同步加 root_path 键后通过
verify: cd backend && uv run pytest app/modules/runtime -q --no-cov
constraints: 不改 RPC 方法名与响应形状；错误映射/超时/鉴权不动；test_router.py 属连带测试归属（plan-review gap 修订项）
---

# task-02：backend RPC params 加 root_path

依据：design.md §5.1 / D-02@v1 / D-03@v1；requirements FR-01；AC-03。
