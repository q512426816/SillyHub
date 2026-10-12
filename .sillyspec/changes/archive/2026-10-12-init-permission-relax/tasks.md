---
author: flow-machine-draft
created_at: 2026-10-12T06:19:08.221Z
---
# 任务注册表（Tasks）— 2026-10-12-init-permission-relax

- [x] task-01: 新建 backend/tests/modules/workspace/test_init_permission.py——developer 成员(仅 workspace:read)POST /init 期望 409、非成员期望 403、activate 非成员期望 403;旧实现下跑出 developer 用例红(403)(验证:pytest -k init 1 failed)
- [x] task-02: workspace/router.py init 端点权限依赖改 WORKSPACE_READ + docstring 口径更新为修订说明;task-01 三用例转绿(验证:pytest tests/modules/workspace/test_init_permission.py 全绿)
- [x] task-03: 回归与提交——重跑 test_init_permission.py + 相邻 workspace 测试抽样;显式 pathspec 提交(消息带 task-NN);确认 openapi.json 零变化(验证:git diff backend/openapi.json 为空)
