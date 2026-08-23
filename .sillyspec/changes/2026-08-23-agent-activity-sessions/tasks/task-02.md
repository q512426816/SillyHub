---
id: task-02
title: 'daemon-env-inject'
title_zh: 'daemon spawn env 注入 SILLYHUB_SESSION_ID'
author: qinyi
created_at: 2026-08-23 14:07:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-008]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/spawn-env.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/tests/spawn-env.test.ts
goal: >
  daemon 派生 agent 进程注入 SILLYHUB_SESSION_ID=<平台 agent_sessions.id>，
  使平台会话中跑的 sillyspec CLI 上报自带会话身份（design §3.2 / Grill P1-4：
  create + restore/_reloadSession 双注入源）。注：sillyhub-daemon 是主仓目录
  （非独立 git 仓，plan review P1 修正），随主仓 worktree 走。
implementation:
  - sillyhub-daemon/src/spawn-env.ts：buildSpawnEnv 增可选入参 agentSessionId；合并层在 tool_config（层1）之上注入 SILLYHUB_SESSION_ID（防同名键覆盖）
  - sillyhub-daemon/src/daemon.ts：_startInteractiveSession 的 buildSpawnEnv 调用传 execPayload.agentSessionId（:3414 已取）
  - sillyhub-daemon/src/interactive/session-manager.ts：restoreEnv（:2655）与 _reloadSession（:3038）两处 buildSpawnEnv 重建传 state.sessionId
  - sillyhub-daemon/tests/spawn-env.test.ts（既有文件，vitest include tests/**）：三路径注入断言 + 非平台会话缺省断言
acceptance:
  - pnpm test / typecheck 绿；注入键不破坏四层合并既有断言
verify:
  - cd sillyhub-daemon && pnpm test && pnpm typecheck
constraints:
  - 不改 credentials/tool_config 语义；env 仅内存传递禁落盘（既有 CreateSessionInput.env 约定）
---

# task-02 补充说明
主仓任务（sillyhub-daemon 为仓库内目录）；commit 归主仓本变更。
