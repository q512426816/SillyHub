---
schema_version: 1
doc_type: task
id: task-08
title: Backend runtime tests rewrite
title_zh: 后端 runtime 测试改写
author: qinyi
created_at: 2026-08-19T06:45:00+00:00
change_name: 2026-08-19-runtime-live-daemon-read
wave: 8
allowed_paths:
  - backend/app/modules/runtime/tests/test_router.py
  - backend/app/modules/runtime/tests/test_live_service.py
goal: 测试基于 mock daemon RPC 而非本地文件快照
implementation: 改写 test_router.py mock ws_hub.send_rpc；新增 test_live_service.py 覆盖绑定缺失、offline、timeout、method_not_found、成功路径
acceptance: runtime 模块 pytest 全绿；不再写 sillyspec.db 文件
verify: cd backend && uv run pytest app/modules/runtime -q --no-cov
constraints: 非测试逻辑有误时不改测试断言来通过
---

# task-08：后端 runtime 测试改写
