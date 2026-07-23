---
author: qinyi
created_at: 2026-07-07 13:35:00
goal: 端到端验证 daemon-client verify dispatch 全链路（claude 调 /sillyspec-verify + patch 无冲突 + 零回归）
implementation: 起 daemon-client workspace 触发 verify dispatch，验证 claude 启动调 /sillyspec-verify skill（skills 已同步）→ skill 读 specDir + stage_meta 跑 verify → complete_lease git_apply patch 时 worktree CLAUDE.md 不被覆盖、基准一致无 does not match index 冲突；回归 host-fs-delegate git_apply 链路 + server-local stage + 现有 complete_lease
acceptance: e2e verify dispatch claude 调 skill 跑通；patch apply 无冲突；host-fs-delegate/server-local/complete_lease 零回归；backend + daemon 全量测试绿
verify: 手动 e2e（daemon-client verify dispatch 观察 claude 调 skill + complete_lease patch apply 成功）+ uv run pytest -q（backend 全量）+ cd sillyhub-daemon && pnpm test（daemon 全量）+ pnpm test（frontend 若涉及）
constraints: 覆盖 design §10 验证策略全部四档（单测/集成/e2e/回归）；e2e 场景对齐 design §5.4；零回归条款对齐 plan 全局验收（host-fs-delegate git_apply / server-local stage / complete_lease 不受影响）；本 task 是验收门，依赖 task-01~09 全部完成
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09]
covers: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, NFR-04]
---

# task-10: e2e 集成验证（全链路 + 零回归）

## 验收标准

A. daemon-client workspace 触发 verify dispatch 后，claude 启动调 /sillyspec-verify skill（平台 skills 已由 task-03 同步、workspace 自定义由 task-04 同步），skill 读 specDir 文档 + STAGE_META 跑完整 verify 流程，backend 不再拼完整 stage prompt（task-01 改造生效）。
B. complete_lease 阶段 git_apply patch 时 worktree .claude/CLAUDE.md 未被覆盖（task-02 删除 task-runner:457-463 生效），patch 基准与 HEAD 一致，无 `does not match index` 冲突；MCP 配置（task-05）注入 claude 生效。
C. 回归零影响：host-fs-delegate git_apply 链路、server-local stage（task-07 容器 skills）、现有 complete_lease 流程均正常；backend `uv run pytest -q` + sillyhub-daemon `pnpm test` 全绿（满足 NFR-04 零回归）。
