# docs/archive — 历史设计文档（已过时）

本目录存放项目早期（2026-05 ~ 06）的设计 / 规划文档。这些文档描述的架构、阶段模型、
状态机、Agent 假设**均已被后续大规模重构推翻**，仅作历史参考，**不代表当前架构**。

归档时间：2026-07-05。请勿据此做新决策。

## 当前权威文档在哪

| 想了解 | 去看 |
|---|---|
| 当前架构 / 模块边界 / 契约 | `.sillyspec/docs/<子项目>/modules/` |
| 当前流程（变更生命周期、scan、agent-run） | `.sillyspec/docs/multi-agent-platform/flows/` |
| 术语表 | `.sillyspec/docs/multi-agent-platform/glossary.md` |
| 当前阶段模型（5 段：brainstorm / plan / execute / verify / archive） | `backend/app/modules/change/model.py` `StageEnum` |
| 已知坑 / 约定 / 模式 | `.sillyspec/knowledge/` |
| worktree 使用坑（仍有效） | `docs/worktree-pitfalls.md` |

## 本目录文档清单

| 文件 | 主题 | 为什么过时 |
|---|---|---|
| `execution-plan-v2-v5.md` (2026-05-26) | V2→V5 早期路线图，task-11~16 规划 | task 编号体系、状态机（7 态）、Agent 假设（"首发只 Claude Code"）、`/loop` 工作方式全被 daemon 重写、SillySpec 流程、多 Agent 编排推翻 |
| `agent-sillyspec-stage-execution-analysis.md` (2026-06-01) | stage 调度执行链路整改清单 | 基于 8+3 阶段模型（含 scan/propose/quick）和直接子进程调度，现实已收敛为 5 阶段 + daemon / mission 模型 |
| `change-center-redesign.md` (2026-06-01) | 变更中心 Web 端发起设计初版 | 阶段含 scan、走 propose、用废弃的 `sillyspec_full/quick` 类型；同名活跃变更 `.sillyspec/changes/change-center-redesign/` 与后续 `changes-align-sillyspec` 才是现行方案 |
| `claude-loop-v1-p0.md` (2026-05-26) | V1 P0 收尾的 `/loop` 执行指令 | 一次性指令，引用的 task-01~10 已全部归档（`archive/2026-05-25-multi-agent-platform-bootstrap-v2/`），无长期参考价值 |
| `spec-alignment.md` (2026-06-01) | 平台原生 sillyspec 对齐提案 v2 | 部分落地（SQLite schema 设计有史价值），但 `changes` 表默认 stage 已从 `scan` 改为 `brainstorm`，平台同步策略改为 daemon spec sync，审批门禁被 HumanGate 删除 |

## 维护规则

- 本目录文档**不再更新**，只进不出（除非彻底删除）。
- 新的过时设计文档应继续归档到此目录，并在本 README 追加一行。
- 若某文档仍有部分有效内容（如 `spec-alignment.md` 的 schema 设计），考虑把有效部分提炼到 `.sillyspec/knowledge/` 或 `.sillyspec/docs/` 后再归档。
