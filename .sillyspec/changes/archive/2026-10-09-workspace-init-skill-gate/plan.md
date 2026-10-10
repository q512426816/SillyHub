---
plan_level: full
author: qinyi
created_at: 2026-10-09 10:20:00
---

# 实现计划（Plan）— 2026-10-09-workspace-init-skill-gate

> 依据：design.md（3 Wave 方案 / 10 文件清单 / D-001~D-006）、requirements.md（FR-01~FR-05）。
> 拆分纪律：实现+单测同卡（无独立测试卡）；每卡=一个可独立验收的能力边界。
> plan_level=full：跨 backend/daemon/frontend 三模块含 UI 流程与 lease 语义修复，execute 审查走 independent 独立审查。

## Wave 1 · daemon 端 + 后端成败门 + 详情页引导（FR-01 / FR-02 / FR-03 / FR-04前置 / FR-05；D-001@v1 / D-002@v1 / D-004@v1 / D-005@v1 / D-006@v1）

四卡文件正交（spec-sync.ts / runner-types.ts / lease/service.py / config-card.tsx 互不相交），无相互依赖，顺序执行。

- task-01

- task-02

- task-03

- task-05

## Wave 2 · 前端创建即初始化（FR-04；D-003@v1 / D-005@v1）

依赖 Wave 1 的 task-03 成败门语义（失败不回写 init_synced_at）保证轮询失败态可达。

- task-04

## 验收（全 Wave 后）

- 聚焦测试：daemon `pnpm test`（run-sillyspec-init / sillyspec-tool-mapping）、backend `uv run pytest`（lease tests）、frontend `pnpm test`（scan-dialog / config-card）全绿
- 类型与 lint：daemon `pnpm typecheck`、frontend `pnpm lint`、backend `ruff + mypy` 零错
- 对照 requirements.md FR-01~FR-05 逐条核验（FR-01 多端写入语义靠 task-01+02，FR-02 门控靠 task-01，FR-03 引导靠 task-05，FR-04 创建即初始化靠 task-04，FR-05 成败门靠 task-03）
