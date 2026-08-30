---
author: qinyi
created_at: 2026-06-20
status: brainstorm 决策草稿（基于 proposal §10 待定点 + 2026-06-20 评审 5 个坑）
---

# Brainstorm 决策：多 Agent 委派编排待定点拍板

> 本文对 proposal §10 的 D1–D7 与评审提出的 5 个设计空白给出**推荐决策 + 理由 + 待确认**。
> 标 ✅ = 已定；🎯 = 推荐（待 spike/用户确认后写入 design）；❓ = 需用户拍板。
> 前置不变：所有实现待 `delegate_task` 协议 spike（§7）通过后才立项。

## 坑 1 / D5：工具治理必须从「prompt 声明」升级到「CLI/SDK 强制」🎯

**现状（评审 D5 修正）**：`["sillyspec"]` 只是写进 CLAUDE.md 的 prompt 提示；daemon batch 走 `--permission-mode bypassPermissions` 全放行，interactive 走 SDK 默认不预禁工具——**Task/subagent 工具其实没被禁，全靠模型自觉**。

**推荐**：多 Agent 改造时，Worker/Coordinator 的工具白名单提升到 CLI/SDK 层强制：
- **batch Worker**：用 `--allowedTools` 显式白名单取代 `bypassPermissions` 全放行，每个 Worker 只暴露其角色所需工具子集。
- **Coordinator**：白名单只含 `delegate_task` + 只读工具，**不给写工具**（写入由 Worker 在独立 worktree 做 + 受控 apply-back）。
- 否则 proposal §13「Worker 工具调用经平台审批收口」不可能成立——这是 delegate_task 治理的前置，不是附属工作。

**❓ 待确认**：是否接受 batch 路径从 `bypassPermissions` 收紧为显式白名单。这会改变现有**单 Agent** 行为，可能 break 依赖全放行的存量流程——需先跑一轮现有 stage 流程的回归确认影响面。

## 坑 2：Coordinator 上下文管理（决定成败的细节）🎯

**问题**：Coordinator 要拆解+分派+收敛+验收+保留决策上下文，大型 change 下其上下文一样会膨胀，违背 §4「省上下文」初衷。

**推荐**：Coordinator 上下文是**结构化状态视图**，不是对话历史，固定四段：
1. **任务目标 + 约束**（常驻，来自 Mission）。
2. **执行图快照**——Worker 状态摘要表（每 Worker 一行：role/status/artifact_ref），用表格不用自然语言。
3. **Artifact 索引**——Worker 产出的结构化摘要带文件/补丁**引用**，不内联全文。
4. **决策日志**（append-only，只记决策不记推理过程）。

**关键约束**：Artifact 必须有**压缩契约**——Worker 输出强制走 schema（结构化），超长内容引用文件路径而非内联。原始日志永不入 Coordinator 上下文（UI 可查）。

## 坑 3 / D7：Mission 状态边界——承认它是「派生状态机」🎯

**问题**：proposal §3 说「Mission 不是另一套状态系统」，但 UI 树/取消/重试/部分失败（D6）必然让 Mission 有生命周期。

**推荐**：Mission 有**派生状态机（derived）**，严格规则保住「事实源仍是 AgentRun + Lease」：
- Mission.status **不独立持久化**，每次由子 AgentRun 状态**聚合计算**（running/all_workers_done/degraded/cancelled/failed）。
- 只持久化 Mission 的**意图元数据**：objective / constraints / budget / created_by / Worker DAG 定义。
- 取消 = 标 `Mission.cancelled` + 平台取消所有 active 子 Run。
- 这样 §3 的架构纪律成立——Mission 是视图，不是新真相源。

## 坑 4：成本机制（落地前必须填的空白）🎯 + ❓

**问题**：一次 bootstrap 从 1 Run 变 7–8 Run（Coordinator + N Worker + Reviewer + Finalizer），成本可能 5–10×，proposal 提了预算但无机制。

**推荐**：
- 每个 Mission 设 **token + USD 双预算**（auto 档按任务规模/模块跨度估算，team 档可手填）。
- 平台在**每次 Worker dispatch 前**检查 Mission 累计成本，超预算 → 拒绝新 Worker + 通知 Coordinator 收敛。
- 预算耗尽**不是错误，是收敛信号**：Coordinator 用已有 Artifact 出最终结果（哪怕不完整），而非报错回滚。
- UI 显示 Mission 预算/已用/趋势。

**❓ 待确认**：默认预算值。需要 baseline 数据——建议先观测当前单 Agent 各 stage 的成本分布，再定 team 档倍数（第一版可保守设 single 档成本的 4×）。

## 坑 5：spike 路径务实化——主走「输出解析」 ✅ 已验证通过（spike 04）

> **2026-06-20 验证结果**：路径 B 实测 N=10，H1 可解析率 100%、H2 合法率 100%、零失败（`spikes/04-delegate-task/`）。**关键发现**：Coordinator 分派必须用直接 messages API，不能跑在 claude CLI agentic 框架里（实测后者让 GLM 拒绝纯输出委派 JSON）。此结论已回灌 proposal §7 并锁定 design 方向。

**问题**：proposal §7 H1 要路径 A（工具调用）vs 路径 B（输出解析）各跑 N=10 比成功率，但 spike-02 已证 GLM Write 工具调用不稳定——路径 A 大概率不达线，不值得花主验预算。

**推荐**：spike 以**路径 B（输出解析）为主验证路径**：
- Coordinator 输出**结构化委派清单**（JSON/YAML），平台解析后建子 Run，**绕开 GLM 工具调用风险**，把委派从「模型能力」降为「输出格式约束」，更可控。
- 路径 A / 路径 C（SDK 原生 `agents` 映射）作**对照**（各跑少量样本记录，不作主门）。
- **H1 主门改为**：路径 B 清单解析成功率 ≥ 80%；H2（参数合法率）≥ 80%；H3（拆→并行→收敛三段 batch 闭环）成功。
- 若路径 B 不达线 → Coordinator 单独配官方 Anthropic 凭证（Worker 仍走 GLM 省钱）。

## §10 D1–D7 汇总

| 点 | 决策 |
|---|---|
| D1 委派入口 | ✅ 路径 B（输出解析），spike 04 验证通过（H1/H2=100%）；Coordinator 用直接 API 非 agentic |
| D2 主 Agent 生命周期 | 🎯 分阶段 batch（H3 验证），实时介入第一版 YAGNI |
| D3 编排智能 | ✅ 混合（平台骨架 + Coordinator 填细节） |
| D4 结果回灌 | ✅ 只回结构化 Artifact，不回原始日志 |
| D5 审批粒度 | 🎯 子 Run 工具审批**各自独立**走 canUseTool（复用 spike-02 D2 远程人审）；**只读 Worker 默认 bypass**，仅写类 Worker（execute）人审——平衡安全与审批疲劳 |
| D6 部分失败 | 🎯 降级不阻断：挂的 Worker 标 failed，Coordinator 据 Artifact 完整度决定重派/降级/继续；第一版默认 1/N 失败不影响收敛目标则继续 |
| D7 关系模型 | 🎯 DAG（AgentRunDependency）；Mission 派生状态（见坑 3） |

## 下一步（推进顺序）

1. ✅ Wave 0（重复 Run bug + stale-pending 兜底）—— 已完成（612e71a + ql-20260620-001）。
2. **❓ 用户确认上述 ❓ 项**（工具白名单收紧回归 / 默认成本预算）。
3. ✅ **delegate_task spike（路径 B 为主）**—— 已完成（spike 04，H1/H2=100%）。关键发现：Coordinator 分派用直接 API、非 agentic 框架。
4. spike 通过 → 写 design.md（固化本文决策）→ plan.md（Wave/Task 拆解）。
5. Bootstrap Team MVP（只读、并行读集中写，风险最低）先行。
