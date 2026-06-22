---
author: qinyi
created_at: 2026-06-22T15:35:00
change: 2026-06-22-agent-run-pipeline-fix
---

# Proposal: agent-run 调度链路修复 + 前端日志展示优化

## 动机
SillyHub 平台调度 agent 执行 `sillyspec scan` 的运行日志（agent-run-7142b6cb.log，8588 行）暴露了调度链路、sillyspec CLI、日志记录器三层问题：Windows 下 `/data/` 路径 EPERM 崩溃、post-check 路径错乱误报、门控失效、子项目探测脏数据、doctor 幽灵命令、日志碎片化+重复、前端展示可读性差。导致 scan 带病推进、被用户手动打断、文档写入位置与检查位置完全脱节。

## 方案概述
跨 SillyHub（本仓库）+ sillyspec（外部仓库）两仓库，按 P0/P1 分层修复：
- **P0 打通 scan 主链路**：A1 路径（bind mount + daemon 翻译）、B1 post-check 路径、B4 门控、C1 init 残留
- **P1 体验与正确性**：B2 脏数据、B3 doctor 别名、D1/D2/D3 日志去重、前端 timeline 重设计

详细设计见 `design.md`，决策见 `decisions.md`，前端展示原型见 `prototype-agent-log-viewer.html`。

## 影响范围
- **SillyHub**：`deploy/docker-compose.yml`、`deploy/.env.example`、`backend/app/modules/{agent,spec_workspace,daemon}`、`backend/app/core/config.py`、`sillyhub-daemon/src/{daemon.ts,config.ts,interactive/session-manager.ts,task-runner.ts,adapters/stream-json.ts}`、`frontend/src/components/agent-log*/agent-log-viewer.tsx`、`frontend/src/lib/agent*.ts`
- **sillyspec**（`C:\Users\qinyi\IdeaProjects\sillyspec`）：`src/run.js`、`src/workflow.js`、`src/index.js`、`src/stage-contract.js`、`src/scan-postcheck.js`、`templates/workflows/scan-docs.yaml`

## 非目标
- 不重写 daemon interactive session 生命周期
- 不统一 sillyspec 两套 post-check 为一套
- 不改日志传输协议（仍 SSE + Redis + DB）
- 不处理 macOS/Linux 宿主（仅 Windows）
