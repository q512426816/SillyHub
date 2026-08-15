---
id: task-06
title: daemon tools 透传链
title_zh: cli.ts 构造 TaskRunner 前 detectAgents 映射注入；TaskRunner 构造增可选 detectedAgents；_runInitLease 透传 tools
author: qinyi
created_at: 2026-08-15 16:06:52
priority: P1
depends_on: [task-05]
blocks: [task-08]
requirement_ids: [FR-04]
decision_ids: [D-005@v1, D-007@v1]
allowed_paths:
  - sillyhub-daemon/src/cli.ts
  - sillyhub-daemon/src/task-runner.ts
goal: >
  打通 agent-detector 检测结果 → runSillyspecInit 的透传链：cli.ts（new TaskRunner 唯一创建点 ~:769）构造前用 AgentDetector 探测本机已装 agent，映射 sillyspec VALID_TOOLS（同名交集：claude/cursor/openclaw/codex/gemini/opencode），构造注入 TaskRunner 可选 detectedAgents；_runInitLease 组 initParams 时透传 tools。
implementation:
  - cli.ts 构造 TaskRunner 前：复用 AgentDetector（或静态探测方法）拿已装列表；映射函数集中在 task-runner 或 cli 一处（agent 名 → VALID_TOOLS 同名过滤）
  - TaskRunner 构造签名加可选 detectedAgents?: string[]（存私有字段）
  - _runInitLease：initParams.tools = this._detectedAgents?.length ? 映射结果 : undefined（undefined 走 runSillyspecInit 兜底 ['claude']）
  - 探测失败（异常/空）→ 注入 undefined，不阻塞 daemon 启动
acceptance:
  - 本机装 claude 时 tools 含 'claude'（映射后）
  - 未注入/空 → _runInitLease 传 undefined，runSillyspecInit 兜底 claude
  - daemon 启动不因探测失败阻塞
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm exec vitest run tests/test_init_lease.test.ts（含 tools 透传用例，task-08 落）
constraints:
  - 创建点在 cli.ts 非 daemon.ts（复核 N-03：detectAgents 在 Daemon.start() 晚于 TaskRunner 构造，故 cli 构造前独立探测）
  - 映射表集中一处便于扩展（agent-detector 12 provider 里 6 个同名）
---
