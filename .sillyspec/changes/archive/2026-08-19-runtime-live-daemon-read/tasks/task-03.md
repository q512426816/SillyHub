---
schema_version: 1
doc_type: task
id: task-03
title: progress dump JSON envelope and tests
title_zh: progress dump JSON envelope 输出与测试
author: qinyi
created_at: 2026-08-19T06:45:00+00:00
change_name: 2026-08-19-runtime-live-daemon-read
wave: 3
allowed_paths:
  - sillyspec/src/progress.js
  - sillyspec/src/machine-interface.js
  - sillyspec/tests/progress-dump.test.js
goal: 输出机器可读的 JSON envelope
implementation: 复用 buildEnvelope 组装 {schema_version, command, ok, data, errors, warnings, generated_at}；data 字段含 progress + user_inputs + artifacts 占位
acceptance: stdout JSON 符合 schema；非 JSON 模式输出人类可读摘要
verify: sillyspec 仓测试覆盖成功/失败/空数据三种 envelope
constraints: stdout 在 --json 模式下不能被 console.error 之外的内容污染
---

# task-03：progress dump JSON envelope 输出与测试
