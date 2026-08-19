---
schema_version: 1
doc_type: task
id: task-11
title: Spawn sillyspec and read files in handler
title_zh: handler 内调用 sillyspec 与文件读取
author: qinyi
created_at: 2026-08-19T06:45:00+00:00
change_name: 2026-08-19-runtime-live-daemon-read
wave: 11
allowed_paths:
  - sillyhub-daemon/src/runtime-handler.ts
  - sillyhub-daemon/src/host-fs-handler.ts
  - sillyhub-daemon/src/file-rpc.ts
goal: 进度走 sillyspec CLI，文件类走宿主 fs
implementation: read_progress 用 execFile 非 shell spawn sillyspec progress dump --spec-dir <specCacheRoot> --json；其余读 .runtime/user-inputs.md 与 .runtime/artifacts/*
acceptance: JSON 解析成功返回 progress；旧版 sillyspec 返回 method_not_found；文件不存在返回 not_found
verify: handler 单元测试覆盖命令成功/失败/旧版不存在、文件读/不存在
constraints: filename 拒绝 .. / 绝对路径 / 控制字符；单产物限制 1MB
---

# task-11：handler 内调用 sillyspec 与文件读取
