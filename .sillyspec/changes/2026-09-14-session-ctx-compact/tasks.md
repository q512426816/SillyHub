---
author: qinyi
created_at: 2026-09-14 10:55:00
---
# 任务清单（Tasks）

- [x] task-01: ProviderCaps 第 12 键 compact 三端贯通（gen 脚本+双守护+pre-session-picker）
- [x] task-02: backend compact 端点双分路（claude=inject 复用+TurnConflict 映射 / pi·codex=ws RPC+三异常映射）+ schema + gen:types (depends_on: task-01)
- [x] task-03: daemon session_compact RPC handler + session-manager compact 六守卫 + driver 契约（compact?/CompactResult） (depends_on: task-01)
- [x] task-04: PiRpcDriver.compact()（_sendCommand+回执+10s 超时）+ 测试 (depends_on: task-03)
- [x] task-05: CodexAppServerDriver.compact() + 新 id→pending response 机制 + 测试 (depends_on: task-03)
- [x] task-06: 前端 compactSession API + 环浮层按钮（caps/空闲/预会话三态）+ 三分型通知 + vitest (depends_on: task-01, task-02)
- [x] task-07: onboarding 文档 compact 接入指引 + 真机三引擎验证（spike-01/02 含） (depends_on: task-02, task-04, task-05, task-06)
