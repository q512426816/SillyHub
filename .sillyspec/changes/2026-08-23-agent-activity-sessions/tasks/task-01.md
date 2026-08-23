---
id: task-01
title: 'cli-protocol-context'
title_zh: 'CLI 协议上下文上报（entry 级 ctx + hub_session_id）'
author: qinyi
created_at: 2026-08-23 14:06:00
priority: P0
depends_on: []
blocks: []
repo: sillyspec
base_commit: 7135771dac8a617b72aeb175ce89d0571f6c1a1e
head_commit: 0749ca6559fa219997b42190b90dbd7dff86420e
repo_root: C:/Users/qinyi/IdeaProjects/sillyspec
requirement_ids: [FR-01]
decision_ids: [D-009]
allowed_paths:
  - src/agent-session-log.js
  - src/run/command.js
  - docs/platform-agent-log-protocol.md
  - test/agent-session-log.test.mjs
goal: >
  sillyspec CLI 上报携带会话化上下文：entry 级 change_key/quick_id（随 entry 持久化，
  存量 entry 保留原 ctx）+ body 级 hub_session_id（env SILLYHUB_SESSION_ID），供平台
  做会话关联与 (workspace,harness,ctx) 聚合（design §3.1 / D-009 / Grill P1-3/P1-5）。
implementation:
  - src/run/command.js：把 :379-393 上报调用块移到 changeName(:507)/quickSessionId(:547-581) 解析之后；构造 context：hubSessionId=env.SILLYHUB_SESSION_ID（非空才带）、quick 会话时 quickId=quickSessionId 去 quick- 前缀段、否则 changeKey=changeName；传给 recordAgentLogInvocation 新参 context
  - src/agent-session-log.js：合并留底时被检出/更新的 entry 写入本次 ctx（entry.change_key/entry.quick_id），未触及的存量 entry 展开保留原值；payload entries 携带 entry 级 ctx + body 级 hub_session_id；schema_version 保持 1
  - docs/platform-agent-log-protocol.md §1 增补：entry 级 ctx 字段语义、body 级 hub_session_id、daemon 注入 env SILLYHUB_SESSION_ID 说明、平台端聚合口径引用本变更
  - test/agent-session-log.test.mjs：mock fetch 断言 entry 级 ctx 透传与存量 entry 原ctx 保留；quick/change 互斥；env 缺省不带 hub_session_id
acceptance:
  - node --test 全绿（既有 52 断言零回归 + 新增）
  - 真实跑 node src/index.js status --change <x> 抓包（或本地起后端）可见 payload 含 entry.change_key 与 body.hub_session_id（env 时）
verify:
  - cd C:/Users/qinyi/IdeaProjects/sillyspec && node --test test/agent-session-log.test.mjs
constraints:
  - best-effort 语义不变（ctx 解析失败不带，不阻断 run）
  - 只记 flag 名/标识不记 flag 值（协议 §7）
---

# task-01 补充说明
跨仓任务：在 sillyspec 仓直做直提（不进主仓 worktree）；commit message 注明本变更名。
