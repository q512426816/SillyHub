---
id: task-12
title: sillyspec client.js createMission 传 external + dispatchWorker branch + probe rootPath 拿取
title_zh: 跨仓 client/probe 字段接通（external mode + branch 对齐 + rootPath 越界校验生效）
author: qinyi
created_at: 2026-08-08 17:39:23
priority: P0
depends_on: [task-04]
blocks: [task-13]
requirement_ids: [FR-04]
decision_ids: [D-006, D-009]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/sillyspec/src/sillyhub-mcp/client.js
  - C:/Users/qinyi/IdeaProjects/sillyspec/src/dispatch/probe.js
expects_from:
  task-04:
    - contract: mcp_gateway（链路B）create_mission 接受 orchestration_mode + dispatch_worker 接受 branch（snake_case）
      needs:
        - create_mission orchestration_mode 入参（external 跳 orchestrator spawn，FR-08）
        - dispatch_worker branch 入参（已对齐 client.js:253）
provides:
  - sillyspec client/probe 接通（createMission external + dispatchWorker branch + probe rootPath 越界校验实际触发）
goal: >
  接通跨仓字段：createMission 传 orchestration_mode="external"（跳 orchestrator spawn，FR-08）；dispatchWorker 确认 branch 字段名对齐（D-009，client.js:253 现传 branch 已对齐，仅加断言不动逻辑）；probe.js rootPath 从 daemon 拿取使 isWithinRoot 越界校验真生效（现仅 caller 显式传 rootPath 才校验，实际派发流程无人传）。
implementation:
  - client.js createMission 加 orchestrationMode 可选参：传入时 args.orchestration_mode = mode；SillySpec 派发流程传 "external"（跳 orchestrator，FR-08）；不传走默认 team 零回归（FR-05）
  - client.js dispatchWorker：核对 args.branch 透传（:253 现已传 branch，D-009 字段名对齐），加测试断言确认字段名，不动现有逻辑
  - probe.js：rootPath 未显式传入时，probe 内部 best-effort 从 daemon 拿取（复用 task-11 listTools / daemon 能力查询暴露的 root_path；spike-01 验证可达），拿不到则跳过越界校验（不因此判 unavailable，保持现 best-effort 语义）
  - isWithinRoot 越界校验逻辑已就绪（probe.js:71-77/129-133），本 task 仅补 rootPath 来源使其在真实派发流程触发
acceptance:
  - createMission 传 orchestrationMode="external" → args 含 orchestration_mode 字段（单测 mock 验）
  - dispatchWorker 传 branch → args.branch 透传（单测断言，D-009 字段名对齐）
  - probe rootPath 从 daemon 拿到 + worktree 越界 → {available:false, reason:'worktree-outside-root'}（单测）
  - daemon 未暴露 rootPath → 跳过越界校验不阻断（best-effort 语义不变）
verify:
  - cd C:/Users/qinyi/IdeaProjects/sillyspec && npm test（sillyhub-mcp/client createMission/dispatchWorker + dispatch/probe rootPath 单测）
  - npm run lint
constraints:
  - createMission orchestrationMode 默认不传 → team 零回归（FR-05）
  - probe rootPath 拿取 best-effort，拿不到不判 unavailable（保守 fallback 不硬试）
  - 不改 isWithinRoot 已有逻辑，只补 rootPath 来源
  - rootPath 拿取机制依赖 spike-01 / task-11 listTools 结论，不臆造 daemon 接口
  - 跨平台，URL 正斜杠
---
