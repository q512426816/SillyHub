---
author: qinyi
created_at: 2026-07-07 13:35:00
goal: 扩展 daemon skill-manager 实现 workspace 自定义 skills 从 specDir 同步到 worktree
implementation: 在 sillyhub-daemon/src/skill-manager.ts（task-03 建的框架）加 workspace 自定义 skills 同步路径；workspace 绑定/lease 时从 specDir 拉 workspace skills/ 到 worktree .claude/skills/（与平台 sillyspec skills 共存，不互相覆盖）；复用 daemon-client spec sync 的拉取/同步框架（D-004 不重复造）
acceptance: workspace 有自定义 skills 时同步到 worktree .claude/skills/；平台 sillyspec skills 与 workspace 自定义 skills 共存；workspace 无自定义 skills 时不报错
verify: cd sillyhub-daemon && pnpm test（workspace 自定义 skills 同步 mock，含"有自定义""无自定义"两路径）
constraints: 复用 daemon-client spec sync 框架（D-004）；workspace 自定义 skills 不能覆盖/同名冲突平台 sillyspec skills（命名隔离或 workspace 前缀）；建立在 task-03 skill-manager 框架之上（不另起新模块）
depends_on: [task-03]
covers: [FR-04, D-002@V1, D-004@V1]
---

# task-04: daemon workspace 自定义 skills 同步

## 验收标准

A. skill-manager 在 workspace 绑定/lease 时机从 specDir 拉 workspace 自定义 skills 到 worktree .claude/skills/，与 task-03 同步的平台 sillyspec skills 共存（同名冲突时平台 skills 不被 workspace 覆盖，或采用命名隔离策略并在单测中固化该策略）。
B. workspace 无自定义 skills（specDir 无 skills/）时同步路径静默跳过、不报错；workspace 有自定义 skills 时 worktree .claude/skills/ 可见且 claude 启动可调。
C. sillyhub-daemon `pnpm test` 全绿，单测 mock spec sync 覆盖"有自定义 skills 同步""无自定义 skills 跳过""与平台 skills 共存不冲突"三条路径，且不破坏 task-03 既有平台同步测试。
