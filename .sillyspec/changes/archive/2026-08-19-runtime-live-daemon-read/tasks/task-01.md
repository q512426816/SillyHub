---
schema_version: 1
doc_type: task
id: task-01
title: Register sillyspec progress dump command
title_zh: sillyspec 注册 progress dump 命令
author: qinyi
created_at: 2026-08-19T06:45:00+00:00
change_name: 2026-08-19-runtime-live-daemon-read
wave: 1
allowed_paths:
  - sillyspec/src/index.js
goal: 让 sillyspec CLI 支持只读进度导出命令
implementation: 在 index.js progress 分支增加 dump 子命令；--json 时劫持 console 输出到 stderr，stdout 输出纯 JSON；调用 ProgressManager.dump(specDir)
acceptance: CLI 能解析 sillyspec progress dump --spec-dir /path --json 并输出合法 JSON
verify: 在 sillyspec 仓跑新增命令测试
constraints: 不改动现有 progress show/status 命令行为
---

# task-01：sillyspec 注册 progress dump 命令
