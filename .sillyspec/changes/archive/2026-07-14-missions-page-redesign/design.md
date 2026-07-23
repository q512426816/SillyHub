---
author: qinyi
created_at: 2026-07-14 10:16:00
scale: large
---
# 设计文档 — Agent 团队（Mission）页面重设计

配套原型：`prototype-2026-07-14-missions-page-redesign.html`。决策台账：`decisions.md`（D-001~D-008@v1）。

## 1. 背景与目标

Agent 团队页（`/workspaces/<id>/missions`）让用户派多 AI 团队并行干活。当前 `mission-console.tsx`（885 行单巨型组件）交互反人类：满屏内部黑话（Coordinator/Worker/role/orchestrator/daemon）、状态全英文（degraded/failed）、长文本不折叠（worker 几百字指令原文糊出）、历史列表一行塞整段描述+Windows 绝对路径、详情无"任务最终成败/结论"总览。

目标：让**非开发者用户**只看到「描述任务 → 看进度 → 看结果」，全程不见内部概念。用户已确认硬约束：重做操作流程（非只换皮）、砍 single 只留 team、藏黑话、状态全中文、长文本折叠、详情加成败总览。

## 2. 现状问题（诊断基线）

**创建态（`!mission`）**：①双标题冗余（h1「Agent 团队」+ h2「🤝 Agent 团队（Mission）」）；②历史 details 默认 `open` 抢焦点，创建表单被挤到下方要滚动；③textarea placeholder 用代码路径示例；④默认 single 却显"启动团队"按钮；⑤描述满屏英文黑话；⑥状态徽标 `STATUS_BADGE` 只配色不翻译。

**详情态（`mission`）**：⑦历史条目一行塞状态+整段描述(含 `C:\Users\...` 绝对路径)+时间+人数，撑爆难读；⑧`WorkerRow.objective` 几百字指令原文不折叠；⑨角色标签中英重复且露代号（`架构分析 [arch]`、`orchestrator [orchestrator]`）；⑩多 worker 成败散落（3 failed 1 completed）无总览。

## 3. 方案概述

**方案 A 单栏流式**（D-004）：进页面直奔输入框，历史收进顶部下拉按钮，点历史/启动后整块换成详情。**固定 team 模式**（D-001）：前端不再有 single/team 切换，`createMission` 固定传 `mode="team"`，走 `OrchestratorService`（主 agent 真 agent + MCP tool 动态编排 worker）。**默认主 agent 自动拆分身**（D-002），"高级：手动配分身"折叠区可手动预设。

## 4. 创建态设计

- **删双标题**：`page.tsx` 的 PageHeader h1「Agent 团队」保留；删 `mission-console.tsx:696` 的 h2「🤝 Agent 团队（Mission）」及冗余描述段，改为一句话副标题（人话）。
- **历史收顶部按钮**（D-007）：历史 `<details open>` 改为收起，置入顶部「历史(N)▾」下拉（Dropdown/Popover），点开浮层列表。
- **输入框顶置**：大 textarea 居顶，placeholder 换人话（如「描述你要 AI 团队做什么…」），删代码路径示例。
- **删 mode 选择**（D-001）：移除 `ModeCard` 组件 + `mode` state + `mode === "team"` 条件分支。固定 team。
- **高级折叠**（D-002）：`TeamConfigPanel` 包进 `<details>` 默认 `close`，summary 文案「高级：手动配分身（默认不用动）」。`workers` state 初始为空数组（默认自动拆）；展开后可添加/编辑 worker。
- **启动按钮**：文案改「启动」（不再"启动团队"，team 已固定无需强调）。
- **费用上限**：保留，与启动按钮同行。

## 5. 详情态设计

- **顶部总览卡 `MissionSummaryCard`**（D-003）：一行展示——中文状态徽标 + 成败统计 + 累计成本（`mission.cost_so_far` / `budget_usd`）；下方紫底「🤖 AI 最终结论」块，取 `mission.workers[].artifacts` 中 `kind==="summary"` 的 `content_ref` 展示。
  - **成败统计口径**（G1 修正）：「N 分身」只算真 worker（`role !== "orchestrator"`），主 agent（主控）单独区块展示，**不计入分身的成功/失败数**。沿用现有 `mission.workers.filter(w => w.role !== "orchestrator")` 模式（mission-console.tsx:145 CoordinatorPanel 同款）。例：1 主控(completed) + 3 真 worker(全 failed) → 统计显示「3 分身 · 0 成功 3 失败」，mission 整体状态派生为 failed。
- **分身列表**：保留主 agent 区块 + worker 列表结构；角色徽标只用中文（`ROLE_LABEL[role]`，如「架构分析」「验证」「主控」），**删 `[role]` 方括号英文代号**（mission-console.tsx:299）；状态徽标用中文 `STATUS_LABEL`。
- **分工目标折叠**（D-006）：`WorkerRow.objective`（几百字指令）默认折叠，点「▸ 分工目标」展开看完整。
- **历史条目 truncate**（D-006）：下拉列表每条 `objective` 加 `truncate` + `title` 属性 hover 全文，不再撑爆。

## 6. 中文化与黑话隐藏（D-005）

**状态映射** `STATUS_LABEL`：
| 内部 status | 中文 |
|---|---|
| planning | 规划中 |
| running | 运行中 |
| done | 已完成 |
| degraded | 部分完成 |
| failed | 失败 |
| cancelled | 已取消 |

（worker 级 AgentRunStatus：pending→排队中 / running→运行中 / completed→已完成 / failed→失败 / killed→已终止）

**角色** `ROLE_LABEL`（保留，去方括号）：arch→架构分析 / code_style→代码规范 / test→测试 / integration→集成 / risk→风险 / impl→实现 / verify→验证 / orchestrator→主控。

**黑话替换**（UI 文案）：Coordinator→主控 / Worker→分身 / daemon→后台 / Mission→任务 / Orchestrator→主控 / Finalizer→（合并，不露术语）。

**三层标识隐藏**：workspace_id / mission_id / run_id 完全不出现在用户可见 UI（仅主 agent 内部 prompt 用，前端不展示）。

## 7. 数据契约

前端类型（`lib/agent.ts`）**不变**：`Mission` / `MissionWorkerRun` / `MissionArtifact` / `CreateMissionInput` / `WorkerPresetItem` / `MainAgentConfig` 均保留。

- `createMission`：**无条件**传 `mode: "team"` + `main_agent_config`（始终用默认值或高级配置，即使用户不展开高级折叠，G2）+ `worker_preset`（默认空数组 → 主 agent 自动拆；仅高级展开手动填时才非空）。`onCreate` 删除 `if (mode === "team")` 条件分支（mode 已固定，G3）。
- AI 结论：`mission.workers.flatMap(w => w.artifacts).find(a => a.kind === "summary")?.content_ref`。
- **后端无改动**：`mode` 字段保留（single 分支零回归）；summary artifact 已由 `FinalizerService.finalize_bootstrap_mission`（finalizer.py:183-190）落库。

## 8. 文件变更清单

**新增文件**：
- `frontend/src/components/mission-summary-card.tsx` — 详情顶部总览卡（状态+成败统计+成本+AI 结论）。

**改动文件**：
- `frontend/src/components/mission-console.tsx` — 主重构：删 `ModeCard`/`mode` state；`MissionConsole` 重排（输入顶置、历史移顶部下拉、删 h2）；`TeamConfigPanel` 包 details 折叠；`WorkerRow` 删 `[role]` 方括号、objective 折叠；新增 `STATUS_LABEL`；接入 `MissionSummaryCard`。
- `frontend/src/app/(dashboard)/workspaces/[id]/missions/page.tsx` — 标题区与 mission-console 统一。
- `frontend/src/components/__tests__/mission-console.test.tsx` — 测试断言重写。

**删除**：`ModeCard` 组件、`mode` 相关分支。

**后端**：无改动。

## 9. 决策索引

D-001@v1 固定 team · D-002@v1 分身默认自动 · D-003@v1 总览卡+AI结论 · D-004@v1 单栏流式 · D-005@v1 中文化藏黑话 · D-006@v1 长文本折叠 · D-007@v1 历史收起 · D-008@v1 范围限定 Mission 页面。详见 `decisions.md`。

## 10. 验收标准

- AC-1：创建态无 single/team 切换；输入框顶置；placeholder 为人话（无代码路径）。
- AC-2：「高级：手动配分身」默认折叠；默认不填 worker，启动后主 agent 自动拆。
- AC-3：详情态顶部 `MissionSummaryCard` 显示中文状态 + 成败统计 + 成本 + AI 最终结论（summary）。
- AC-4：分身角色只显中文，无 `[arch]`/`[orchestrator]` 方括号代号。
- AC-5：分身分工目标默认折叠，点开看完整。
- AC-6：所有状态词中文（无 degraded/failed/planning 等英文露出）。
- AC-7：历史列表默认收起，点顶部「历史(N)」下拉展开。
- AC-8：历史条目长描述 truncate，不撑爆布局。
- AC-9：UI 全程不出现 Coordinator/Worker/daemon/role/orchestrator/Mission 等黑话（用户可见处）。
- AC-10：`mission-console.test.tsx` 更新通过（删 mode 断言，加中文状态/折叠/总览断言）；前端全量测试零回归。

## 11. 非目标

- 不改后端（mode 字段、编排链路、Finalizer 均不动）。
- 不改 execute/verify/会话入口的 single/team（D-008，留独立变更）。
- 不碰 `/agent` 智能体控制台（单 agent 对话，与 mission 并存）。
- 不做 Coordinator/Finalizer 模型可配置、不做预算硬门 kill（team-mode-platform-wise 非目标同样适用）。
- 不做 mission→worker→finalizer 编排逻辑改动（已就绪）。

## 12. 兼容策略（brownfield）

- 前端固定 `mode="team"`，后端 single 分支保留（零回归）。
- 老 mission 数据：`derive_status`（mission.py:29）不变，前端只读展示。
- **summary 降级**：summary artifact 仅 mission∈{done,degraded} 时产出（finalizer.py）。`planning`/`running` → 总览卡显「进行中，暂无结论」；`failed`/`cancelled` 且无 summary → 显「失败，无最终结论」。
- `worker_preset` 老数据兼容：老 mission 可能无该字段（nullable），前端读取已防御。

## 13. 风险与对策

- **R-01 summary 仅终态产出**：见 §12 降级策略。
- **R-02 主 agent 自动拆依赖在线 daemon**：worker_preset 空 + 无在线 daemon → 主 agent run 留 `pending` + `error_code="no_online_daemon"`（orchestrator.py:189-200 复用），前端按现有 run 状态展示，不额外处理。
- **R-03 team-mode-platform-wide 方向张力**：该变更 Phase 1"mission 加 mode 选择"被本次 D-001 作废；其主战场（其他入口）不受影响。archive 本次时在模块文档/frontend.md 变更索引标注该关系。
- **R-04 mission-console.test.tsx 大改**：现有测试围绕 mode 切换/TeamConfigPanel 默认展开，需重写断言（mode 删除、高级默认折叠、总览卡、中文状态）。execute 阶段逐条更新。

## 14. 生命周期契约

本变更是**前端展示层重设计**，不改 session / lease / agent_run / daemon / mission 的生命周期逻辑。mission 状态仍由后端 `derive_status`（mission.py:29）从子 AgentRun 派生，前端只读展示；worker 派发/收敛/Finalizer 触发均不变。不涉及生命周期契约变更，无需新增契约表。

## 15. 自审

- **需求覆盖**：6 硬约束（重做流程 / 砍 single / 藏黑话 / 中文化 / 折叠 / 总览）+ 3 对话决策（分身默认自动高级 / 范围只 Mission / 总览+AI 结论）全覆盖。
- **Grill 覆盖**：§9 引用 D-001~008@v1 全当前版本。
- **真实性**：代码引用 mission-console.tsx:696/299、router.py:783、orchestrator.py:69-76/189-200、finalizer.py:183-190、mission.py:29、mission_schema.py:17 均实测。
- **YAGNI**：无不必要功能。
- **验收**：AC-1~10 具体可测。
- **非目标**：§11 清晰。
- **兼容**：§12 brownfield + summary 降级。
- **风险**：§13 R-01~04。
- **Design Grill 修正**：G1 成败统计口径（§5）、G2 main_agent_config 始终传（§7）、G3 删 onCreate 分支（§7）已纳入。
