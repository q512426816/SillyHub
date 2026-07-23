---
author: qinyi
created_at: 2026-07-12 12:38:20
---

# 决策记录（Decisions）— team 主 agent 动态编排（v2）

## D-001@v2 — team = 主 agent 动态编排（推翻 v1 D-001）
**决策**：team = 主 agent（真 agent）全程动态指挥。推翻 v1 D-001（会话不做多 agent 轮转）。
**理由**：用户要项目经理式动态指挥。主 agent 走 mission 特殊 AgentRun + daemon lease（不在 driver 层加协调原语，控制成本）。
**影响**：新增 OrchestratorService + AgentRun role='orchestrator'。

## D-002@v2 — worker 用户预设（非自动拆）
**决策**：worker 列表由用户 UI 预设（agent 类型/模型/任务），主 agent 不自动拆解。
**理由**：用户控制强 + 可预期；主 agent 按列表派 + 动态调度（补/调整/收敛）。
**影响**：UI worker 配置面板 + AgentMission.worker_preset。

## D-003@v2 — 主 agent + worker 都自由组合（推翻 v1 design §3 非目标）
**决策**：主 agent + worker 都可独立选 agent 类型 + 模型。GLM 不再特殊。
**理由**：用户要自由组合；v1「Coordinator/Finalizer 模型不可配置」非目标推翻。
**影响**：per-run provider/model 全链路（UI → schema → lease metadata → daemon）。

## D-004@v2 — v2 演进 v1（GLM fallback）
**决策**：mode=team 走主 agent；mode=single 走 v1；GLM Coordinator/Finalizer 保留作 fallback。
**理由**：v1 Wave 1+2 mode UI/透传统用；GLM fallback 明确降级路径（主 agent 不可用 / 用户选 GLM 时退化）。
**影响**：mode 分流 + GLM 链路保留。

## D-005@v2 — per-worker 独立 worktree（v1 D-006 完整实现）
**决策**：每个写代码 worker 独立 git worktree（临时分支）。
**理由**：并发写必须隔离（v1 D-006 延后项的完整实现）。
**影响**：execution.py per-worker worktree + converge 合并 patch。

## D-006@v2 — 三重收敛
**决策**：worker 全完 / 主 agent 判断目标达成 / 预算超时 三重 OR 收敛。
**理由**：覆盖正常完成 + 智能收敛 + 成本兜底。
**影响**：OrchestratorService 收敛逻辑 + budget 硬截断。

## D-007@v2 — MCP tool 反向调用
**决策**：主 agent 通过 MCP tool 调 backend 派 worker/读产出/收敛（daemon→backend）。
**理由**：主 agent 是真 agent，tool 调 backend 比后台主动规划更贴"主 agent 指挥"。比方案 A（backend GLM 决策循环）多工具能力。
**影响**：daemon→backend 反向通道（HTTP + auth）+ MCP endpoint。
