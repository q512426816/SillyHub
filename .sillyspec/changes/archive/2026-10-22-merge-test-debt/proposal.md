---
author: flow-machine-draft
created_at: 2026-10-22T07:49:11.302Z
---
# 提案书（Proposal）— 2026-10-22-merge-test-debt

## 动机

任务原话转写：合并后测试债清偿：l10n文案与守卫钉子同步

动机与背景：合并 origin/main（b36be20da）后全量回归暴露 4 笔既有测试债（双侧分叉期间 scoped 跑法漏网，非合并引入）：
① knowledge/vector_router.py 报错文案纯英文违 l10n 守卫；② session_attachment f-string 常量段拼接后无 CJK 判违；③ test_mission_session_id 模型字段钉子漏收 title_fallback（2026-10-16 列，姊妹守卫已收）；④ daemon json-rpc 握手用例硬编码版本 0.1.1，package.json 已 0.2.0（实现用 DAEMON_VERSION 单源，测试字面量随版本提升假败）。

成功标准：
- tests/core/test_error_message_l10n.py 全参数化用例绿（vector_router/session_attachment 两 offender 清零）
- test_mission_session_id::test_agent_sessions_model_fields_unchanged 绿（expected 补 title_fallback）
- sillyhub-daemon tests/adapters/json-rpc.test.ts 60/60 绿（clientInfo.version 改与 DAEMON_VERSION 同源断言）
- 四处修复均为守卫/文案同步，无业务逻辑变更

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. tests/core/test_error_message_l10n.py 全参数化用例绿（vector_router/session_attachment 两 offender 清零）
2. test_mission_session_id::test_agent_sessions_model_fields_unchanged 绿（expected 补 title_fallback）
3. sillyhub-daemon tests/adapters/json-rpc.test.ts 60/60 绿（clientInfo.version 改与 DAEMON_VERSION 同源断言）
4. 四处修复均为守卫/文案同步，无业务逻辑变更

## 成功标准（可验证）

1. tests/core/test_error_message_l10n.py 全参数化用例绿（vector_router/session_attachment 两 offender 清零）
2. test_mission_session_id::test_agent_sessions_model_fields_unchanged 绿（expected 补 title_fallback）
3. sillyhub-daemon tests/adapters/json-rpc.test.ts 60/60 绿（clientInfo.version 改与 DAEMON_VERSION 同源断言）
4. 四处修复均为守卫/文案同步，无业务逻辑变更
