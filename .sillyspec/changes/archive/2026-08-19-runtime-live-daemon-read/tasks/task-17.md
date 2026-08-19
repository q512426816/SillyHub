---
schema_version: 1
doc_type: task
id: task-17
title: sillyspec repo release coordination
title_zh: sillyspec 仓发版协调
author: qinyi
created_at: 2026-08-19T06:45:00+00:00
change_name: 2026-08-19-runtime-live-daemon-read
wave: 17
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/sillyspec/src
  - C:/Users/qinyi/IdeaProjects/sillyspec/tests
goal: 跨仓 sillyspec 命令可用且测试通过
implementation: 在 sillyspec 仓完成 task-01~03 后跑其测试；确认 daemon 侧旧版命令报错路径
acceptance: sillyspec 仓 npm test 绿；daemon handler 对旧版返回 method_not_found
verify: 真实或 mock 环境验证旧版 sillyspec 行为
constraints: 不阻塞本仓其他 Wave；可并行推进
---

# task-17：sillyspec 仓发版协调
