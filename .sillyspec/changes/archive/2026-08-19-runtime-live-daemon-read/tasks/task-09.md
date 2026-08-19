---
schema_version: 1
doc_type: task
id: task-09
title: Register runtime RPC in daemon
title_zh: daemon 注册 runtime RPC
author: qinyi
created_at: 2026-08-19T06:45:00+00:00
change_name: 2026-08-19-runtime-live-daemon-read
wave: 9
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
goal: daemon 侧暴露 4 个 runtime.* 方法
implementation: 在 daemon.ts _registerHostFsRpcHandler 附近新增 _registerRuntimeRpcHandler；注册 runtime.read_progress/read_user_inputs/list_artifacts/read_artifact
acceptance: 4 个方法名与 backend 调用一致；handler 能被正确调用
verify: daemon vitest 覆盖注册与分发
constraints: 不污染 host_fs 九方法契约
---

# task-09：daemon 注册 runtime RPC
