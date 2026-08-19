---
schema_version: 1
doc_type: task
id: task-04
title: Create RuntimeLiveService
title_zh: 新建 RuntimeLiveService
author: qinyi
created_at: 2026-08-19T06:45:00+00:00
change_name: 2026-08-19-runtime-live-daemon-read
wave: 4
allowed_paths:
  - backend/app/modules/runtime/service.py
  - backend/app/modules/runtime/schema.py
goal: 封装 daemon RPC 调用，替代容器直读快照
implementation: 新增 RuntimeLiveService 类，含 get_progress/get_user_inputs/get_artifacts/get_artifact_content；内部调用 MemberBindingResolver + ws_hub.send_rpc(runtime.*)
acceptance: 4 个方法均通过 daemon RPC 获取数据；绑定缺失抛 RuntimeNotBound
verify: backend runtime 模块新增 test_live_service.py 覆盖成功与失败路径
constraints: 不访问 spec_ws.spec_root；只读
---

# task-04：新建 RuntimeLiveService
