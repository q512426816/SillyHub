---
id: task-10
title: 权限缓存测试（FR-06, AC-01~05）
title_zh: 权限缓存读写/降级/失效安全/uuid 类型/无 Redis 回退测试
author: qinyi
created_at: 2026-07-23 09:42:00
priority: P6
depends_on: [task-01, task-03, task-04, task-05, task-06, task-07, task-08, task-09]
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-002@v2, D-003@v2, D-004@v1, D-005@v1]
allowed_paths:
  - backend/tests/modules/test_permission_cache.py
  - backend/app/modules/auth/tests/
  - backend/app/modules/workspace/tests/
  - backend/app/modules/admin/tests/
  - backend/tests/modules/
goal: >
  覆盖权限缓存的读写正确性、Redis 故障降级、每个失效点(含 scan_generate)的"改完即清空"安全测试、
  ppm-scope uuid 反序列化类型断言、无 Redis 回退查库正确性、经理 problem_operable 权限正确性。
implementation:
  - 缓存读写+降级单测:mock Redis,get/set 往返、Redis 故障 get 返回 None/set 静默、invalidate 失败升 ERROR
  - 每失效点"改完即清空"安全测试:task-05~09 各 service 写操作 + **task-08 的 scan_generate 路径**,commit 后断言 invalidate_all_permissions 被调用且 perm:*/ppm-scope:* 清空(AC-02)
  - ppm-scope uuid 反序列化类型断言:get_cached_ppm_scope 后 manager_project_ids 元素 isinstance uuid.UUID、is_super_admin isinstance bool(AC-04)
  - 无 Redis 回退:测试环境无 Redis 时 has_permission/data_scope 回退查 DB,结果与无缓存一致(AC-03)
  - 经理 problem_operable:缓存启用后部门/项目/开发/业务经理的编辑/删除权限正确(AC-05)
acceptance:
  - AC-01:受保护路由权限检查命中缓存时不再打 DB JOIN(除 miss/失效后首次)
  - AC-02:任一失效触发点(含 scan_generate)执行后,perm:* + ppm-scope:* 全部清空
  - AC-03:Redis 故障/无 Redis 时权限检查回退查 DB,结果与无缓存一致
  - AC-04:ppm-scope 反序列化后 manager_project_ids 元素类型为 uuid.UUID(类型断言)
  - AC-05:经理经 problem_operable 的编辑/删除权限在缓存启用后仍正确
verify:
  - cd backend && uv run pytest tests/modules/test_permission_cache.py app/modules/auth/tests/ app/modules/workspace/tests/ app/modules/admin/tests/ tests/modules/ -q
constraints:
  - 测试用 SQLite(aiosqlite)无 Redis → 走降级回 DB 路径(AC-03 验证此为正确行为);Redis 读写用 fakeredis 或 mock
  - scan_generate 路径安全测试必须有(plan-review 阻断项的回归保护)
  - local.yaml test_strategy=module,modules 块仅定义 ppm/frontend/daemon;本变更跨 auth/admin/workspace/core,verify 阶段需确认测试命令覆盖(可能补 local.yaml modules 定义或手动指定 pytest 路径)
---

流程位置:Wave 3(测试,依赖 task-01~09 全部)。本 task 是 plan-review 阻断项(scan_generate)回归保护 + 全部 AC 的验证出口。
