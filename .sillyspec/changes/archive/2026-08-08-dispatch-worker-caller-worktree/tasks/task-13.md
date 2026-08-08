---
id: task-13
title: 跨仓契约 sillyhub-path-a-contract.md 更新 + 端到端 smoke
title_zh: 路径A 跨仓契约打勾 + 端到端 smoke 验收（worker 终态不污染主仓）
author: qinyi
created_at: 2026-08-08 17:39:23
priority: P0
depends_on: [task-11, task-12]
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-004, D-006]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/sillyspec/docs/sillyspec/sillyhub-path-a-contract.md
expects_from:
  task-01:
    - contract: create_mission external mode 跳 orchestrator spawn + constraints 存 mode
      needs: [orchestration_mode 入参, external 短路]
  task-02:
    - contract: dispatch_worker 路径A 核心（worktree_path/branch/worker_prompt + 跳自建 + 不写 worktree_branch）
      needs: [worktree_path 跳 git_worktree_add, worker_prompt 覆写, 不写 run.worktree_branch]
  task-03:
    - contract: converge external 跳过 finalize/cleanup（不 merge 不污染 caller 主仓）
      needs: [external 短路]
  task-04:
    - contract: mcp_gateway create_mission/dispatch_worker 入参透传（链路B，SillySpec 走这条）
      needs: [orchestration_mode, worktree_path, branch, worker_prompt]
  task-11:
    - contract: isPathASupported 探测翻真
      needs: [schema 探测 或 env 标记 SILLYHUB_PATH_A]
  task-12:
    - contract: sillyspec client/probe 接通
      needs: [createMission external, dispatchWorker branch, probe rootPath 拿取]
provides:
  - 跨仓契约文档与实际落地一致（字段名 branch + external mode + 校验清单打勾）
  - 端到端 smoke 证据（路径A 真实可用，worker 终态不污染主仓）
goal: >
  收尾跨仓接通：更新 docs/sillyspec/sillyhub-path-a-contract.md（字段名 branch 统一 + external mode 段 + 校验清单全打勾），并跑端到端 smoke——某仓 SillySpec execute 一波 → create_mission(external) → dispatch_worker → worker 在 SillySpec worktree 写码（不 commit）→ SillySpec 回收 review.json + apply，实测 worker 终态不污染主仓（R-01 三重防御）。
implementation:
  - 更新 sillyhub-path-a-contract.md：§路径A 三处 + daemon root_path 校验清单全打勾；字段名 worktree_branch→branch 统一（D-009）；补 mission external 模式段（跳 orchestrator spawn + converge external 跳过 finalize）；updated_at 时间戳
  - 端到端 smoke（隔离临时仓 + 本地源码入口 node C:/Users/qinyi/IdeaProjects/sillyspec/bin/sillyspec.js）：配 SILLYHUB_MCP_URL/TOKEN + allowed_roots 含仓根 → execute 一波派 worker 到 .sillyspec/.runtime/worktrees/<change>/ → worker 写码不 commit → SillySpec git diff 写 review.json → apply 回主干
  - 实测三重防御：worker 终态后 SillyHub 不 merge（external converge 跳过 + 不写 worktree_branch + worker_prompt 不 commit），smoke 后主仓 git log 无 SillyHub 污染提交
acceptance:
  - 契约文档校验清单全打勾 + 字段名 branch + external mode 段就位
  - 端到端 smoke：worker 在 caller worktree 写码、不 commit、SillySpec 回收 review.json + apply 成功（AC-08）
  - smoke 后主仓 git log 无 SillyHub merge 污染提交（R-01 三重防御实测，P0-1 关键验收）
verify:
  - 人工核对 sillyhub-path-a-contract.md 校验清单打勾 + 字段名一致
  - 端到端 smoke 脚本/记录（隔离临时仓跑，不污染主仓、不用全局发布版 sillyspec）
  - cd C:/Users/qinyi/IdeaProjects/sillyspec && npm test（契约文档变更无源码，跑全量确认零回归）
constraints:
  - smoke 必须隔离临时仓 + 本地源码入口（不污染主仓、不用全局发布版 sillyspec）
  - worker 终态不污染主仓是 P0-1 关键验收（R-01），失败即阻断整个变更
  - 契约文档是落地镜像，字段名/external mode 同步 design §7.3/§7.1
  - daemon allowed_roots 含仓根是 smoke 前置（task-10），不满足先补
  - 跨平台（Win/Linux/macOS），路径正斜杠
---
