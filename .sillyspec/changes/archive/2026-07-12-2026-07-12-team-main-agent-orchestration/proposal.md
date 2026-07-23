---
author: qinyi
created_at: 2026-07-12 12:38:20
---

# 提案书（Proposal）— team 主 agent 动态编排（v2）

## 动机
v1 team（GLM Coordinator 一次性拆解 + worker 并行 + GLM Finalizer 合并）达不到用户愿景：主 agent 像项目经理全程动态指挥（读 worker 实际产出再决策）+ 每个 worker 自由组合 agent 类型（claude code/codex/cursor）和模型（glm/gpt/claude/deepseek）。

## 关键问题（v1 痛点）
1. **GLM 硬依赖**：Coordinator/Finalizer 固定 GLM，无 GLM 配置 team 不可用（v1 design §10 风险）。
2. **静态拆解**：GLM 一次性拆 worker（plan 阶段定型），不读 worker 实际产出动态调整。
3. **worker 固定 provider**：所有 worker 用 workspace 默认 provider/model，不能 per-worker 指定（execution.py:114）。
4. **无主 agent**：缺"协调者"角色读 worker 产出再决策（Coordinator/Finalizer 都是批处理，非迭代编排）。

## 变更范围
- 主 agent（真 agent，daemon lease + MCP tool，能读码决策）
- 用户预设 worker 列表（UI 指定 agent 类型/模型/任务）
- per-worker 独立 git worktree（D-006 完整实现）
- MCP tool 反向调用（daemon→backend 派 worker/读产出/收敛）
- 三重收敛（worker 全完 / 主 agent 判断 / 预算超时硬截断）
- 主 agent + worker 自由组合 agent 类型/模型
- v1 演进（GLM fallback）
- 三入口（mission / execute·verify stage / 会话）

## 不在范围内（显式清单）
- worker 自动拆解（用户预设）
- driver 层原生多 agent 轮转（主 agent 是 mission AgentRun，不在 driver 加协调原语）
- worker DAG 依赖图
- 预算硬门 kill 全实现（P2-1 独立任务）
- brainstorm/plan stage team（沿用 v1 D-002）

## 价值
真 multi-agent orchestration：主 agent 看实际产出决策（非静态拆），worker 自由组合 agent/模型（非固定），贴合"项目经理指挥团队"比喻。底座（daemon 多 provider adapter）已就绪，本变更接通编排层。
