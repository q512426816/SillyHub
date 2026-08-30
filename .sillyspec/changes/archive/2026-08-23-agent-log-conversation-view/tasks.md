---
author: qinyi
created_at: 2026-08-23 21:12:30
---

# 任务清单（Tasks）

- [x] task-01: daemon zcode 解析器——统一 offset 对齐合并（full/delta/tail）+ 消息形状段产出（消息级 toolCalls/reasoning/字符串 content）+ system/reminder 剥离 + 末行 response 补尾去重 + 20MB 预算与坏行容错 + 200 段窗口与 before_seq 切片 + 真实形状 fixture 单测 (depends_on: —)
- [x] task-02: daemon 解析器注册表 + host_fs RPC 方法 read_agent_log_messages——白名单复用、not_found/forbidden 走既有 throw 通道、status 分层返回、未注册 format→unsupported + RPC 单测 (depends_on: task-01)
- [x] task-03: backend 新端点 GET /agent-logs/{id}/messages——从 read_agent_log_content 抽共享 helper（scope/daemon 定位/错误映射）+ AgentLogMessagesResponse schema + 二进制 409/method-not-found 422/status 200 分层 + 单测（mock RPC，不依赖 task-02 实现） (depends_on: —)
- [x] task-04: pnpm gen:types 同步 openapi/api-types（gen:types:check 通过）+ 前端 readAgentLogMessages API 封装 (depends_on: task-03)
- [x] task-05: 前端 agent-log-card「查看内容」升级——直构段列表复用 tool-renderers 组件（tool_use_id 配对/失配「结果未记录」）+ 对话/原文切换 + 加载更早 + 全场景静默回落 + 组件测试 (depends_on: task-04)
- [x] task-06: 三仓回归（pytest/vitest/daemon test+typecheck）+ 真实 zcode 会话端到端实证（对话渲染/回落/无 system 泄漏）+ runtime-evidence 留档 (depends_on: task-01, task-02, task-03, task-04, task-05)
