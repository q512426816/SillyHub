---
author: qinyi
created_at: 2026-06-19T12:54:37
---

# Proposal: 多 Agent 委派编排（平台托管的分层编排）

> **状态：探索（explore）阶段产出草稿，未立项。** 本文合并两轮分析（初始探索 + 同行评审）后修订，作为后续 brainstorm 的起点。**§6 的重复 Run bug 已于 `612e71a`（ql-20260619-001）修复；2026-06-20 评审另发现残留缺口并补通用 stale-pending 兜底 `cleanup_stale_pending_runs` + `AgentRun.created_at` 字段（ql-20260620-001，已落地 + 53 测试 + mypy 全过）。** 文中行号基于 `612e71a` 前快照、已漂移，以函数名为准。其余若干**待 spike/brainstorm 决策**，所有方案待 `delegate_task` 协议 spike（§7）通过后才能正式立项。

## 1. 动机与定位

平台当前的 agent 调用是**单 Agent 串行 + 零委派**模型，名字虽叫 multi-agent，实则更接近"多种 Agent Runtime 管理平台"，还不是"Agent 团队协作平台"。

目标定位（经评审修正）——不是"主 Agent 完全不干活"，而是三方分工：

> **主 Agent（Coordinator）**：拆解、分派、收敛、验收，**保留决策上下文**（否则退化成传话筒）。
> **Worker**：执行具体子任务。
> **平台**：治理——权限、租约、并发、日志、成本、取消、重试。

两个具体痛点：
- **上下文爆掉**：bootstrap 单 Agent 扛 scan 全流程、change 单 Agent 串行扛大改，上下文塞满，后期质量下降。
- **质量/可控性不够**：复杂任务单 Agent 产出不可靠，缺分工与独立验证。

## 2. 现状诊断（已验证）

`一次业务动作 → 一个 AgentRun → 一个 DaemonLease → 一个 CLI 子进程`。

```
┌─────────────────────────────────────────────────────────┐
│  Backend (Python) —— 真正的"指挥官"                       │
│  change/dispatch.py 硬编码串行：                          │
│     brainstorm → propose → plan → execute → verify       │
│  ⚠ 是代码决定下一步，不是 agent 决定                      │
│  ⚠ has_active_run 禁止同一 change 并发 run                │
└──────────────┬──────────────────────────────────────────┘
               │ 每步建 1 个 AgentRun + 发 1 段 prompt
               ▼
┌─────────────────────────────────────────────────────────┐
│  Daemon task-runner —— 批处理执行器（被动消费 lease）      │
│  1 lease = spawn 1 个 claude 进程 = 跑 1 段 prompt        │
│  跑完即销毁，进程之间互不感知、不通信                      │
└──────────────┬──────────────────────────────────────────┘
               │ ⚠ "可用工具" 仅 prompt 声明 sillyspec（写进 CLAUDE.md），
               │    CLI/SDK 层并未收口：batch 走 bypassPermissions 全放行、
               │    interactive 走 SDK 默认，Task/subagent 未显式禁用（评审 D5 修正）
               ▼
┌─────────────────────────────────────────────────────────┐
│  Claude 进程 —— 单 agent，跑完这段 prompt 就 exit         │
└─────────────────────────────────────────────────────────┘
```

关键证据：
- `AgentRun` 是单次执行实体，无 `parent_run_id` / 团队 / 角色 / 依赖关系。
- Claude Agent SDK **有原生 subagent 能力**（`sdk.d.ts`: `agents?: Record<string, AgentDefinition>` 可编程定义子 agent + Agent tool + `SubagentStart/Stop` hooks + `parent_tool_use_id`）。spike-02 只验了多 turn/interrupt/canUseTool/resume，**未验 `agents` 配置**。平台选自托管 `delegate_task` 的理由是**治理与可观察性**，非 SDK 能力缺失（见 §3、§8）。
- daemon 是**被动 lease 消费者**（lease 完全由 backend dispatch）——这点决定编排智能应放平台层，而非 daemon 内部。
- 业务代码 grep `subagent / delegate / orchestrat / swarm / fan-out / Task tool` 零真实命中。

## 3. 目标架构：平台托管的分层编排

> **⚠️ 架构修正（spike 04，2026-06-20）**：图中「Coordinator AgentRun」需修正——Coordinator 的**分派阶段**经实测必须用 backend **直接 messages API** 调用，**不是** daemon-spawned claude run：claude CLI 的 agentic system prompt 会让 GLM 拒绝纯输出委派 JSON（`awaiting_task` / 直接执行 / 请求澄清）。故 Coordinator 的「拆解 / 分派 / 收敛」= backend 内嵌 GLM 调用；只有 **Worker** 是 daemon-spawned AgentRun。AgentMission 聚合根仍成立，Coordinator 本身默认不占 daemon lease（仅当收敛/验收需实际执行工具时才 spawn 一个普通 Worker Run）。

```
   AgentMission (聚合根: 一次业务目标)
        │
        ▼
   Coordinator AgentRun ──delegate_task──┐
        │                                │ 平台层创建可观察的子 Run + 派 lease
        ├──────────┬──────────┐          │ (daemon 仍只被动执行)
        ▼          ▼          ▼          ▼
   Worker Run  Worker Run  Worker Run  → 各自独立 CLI 进程
   (架构分析)  (代码规范)  (测试集成)     只回结构化 Artifact
        │          │          │
        └──────────┴──────────┘
                   ▼
              Reviewer / Verifier Run  (检查冲突/缺口/复审)
                   ▼
              Finalizer Run  (单点生成统一产出)
                   
   平台控制面 ── 治理所有 Run：权限 / 租约 / 并发 / 日志 / 成本 / 取消 / 重试
```

引入的领域模型（**不是另一套运行状态系统**，Mission 状态由子 AgentRun 聚合，事实源仍是 AgentRun + Lease）：

| 模型 | 角色 |
|---|---|
| `AgentMission` / `AgentTeamRun` | 一次业务目标的聚合根 |
| `AgentRun` | **保持现状**——一个真实 CLI 进程，事实源 |
| `AgentRunDependency` | **DAG 依赖**（不止父子树，支持 Worker 间依赖） |
| `AgentArtifact` | Worker 的结构化摘要 / 证据 / 补丁 / 测试结果 |
| `AgentRunLog` | **保持现状**——每个 Worker 完整日志 |

新增字段：`mission_id`、`parent_run_id`、`role`、`objective`、`attempt`。

**架构纪律**：
- 子 AgentRun 必须是平台一等公民（可观察/可治理/可取消），**不靠 provider 进程内部隐式 subagent**——那样平台看不到子任务状态、日志、成本、取消边界。
- `delegate_task` 是**平台协议**：Coordinator 调它 → 平台建子 Run + 派 lease → 结果回灌。坚持平台托管的理由是**治理与可观察性**（非 SDK 能力缺失——SDK 有 `agents`/Agent tool/SubagentStop 事件）。
- **实现路径**：`delegate_task` 底层可复用 SDK `agents` 配置（让 Coordinator 的 claude 进程内置子 agent），把 SDK 的 `SubagentStart/Stop` 事件 + `parent_tool_use_id` **映射成平台子 AgentRun**——SDK 已提供映射所需的全部信号。第一版也可走"平台独立建子 lease"的纯平台路径，两者择一由 §7 spike 决定。

## 4. 主 Agent 上下文策略

Coordinator **不接收 Worker 原始日志**，只接收：任务目标与约束 / 当前执行图状态 / Worker 的结构化摘要 / 文件·补丁·测试等证据引用 / 失败原因与需决策的问题。

原始日志全部存平台、UI 可查，但**不自动塞回 Coordinator 上下文**。这比"主 Agent 什么都不做"更有效：省上下文，同时保留判断能力。

## 5. 团队粒度与第一版硬约束

提供三档：`single`（quick/小改/问答）、`team`（bootstrap/大型 scan/多模块 execute/复杂 verify）、`auto`（按任务数、模块跨度、风险、预计上下文自动选）。

**第一版硬约束**（防过度工程化 + 成本失控）：
- 只支持**一层 Coordinator + Workers**，**不支持 Worker 递归委派**。
- 最大 **3–5 个 Worker**。
- 明确 **token/成本预算**与**并发上限**。

## 6. ✅ Wave 0：重复 Run bug —— 已修复（612e71a）+ 通用兜底已补（ql-20260620-001）

与多 Agent 无关，但破坏"一次进程执行 = 一个 AgentRun"不变量，是多 Agent 改造（靠 AgentRun 做事实源/DAG）的前置。

调用链实锤：
```
dispatch_next_step (change/dispatch.py:648)
  ├─ Step5 :709  建 Run A  ← lease_id=None, provider=None, model=None, pending
  ├─ Step8 :752  调 start_stage_dispatch(...)   ⚠ 未传 Run A 的 id
  └─ Step9 :775  return agent_run_id = Run A     ⚠ 返回的不是执行的那个

start_stage_dispatch (agent/service.py:878)
  └─ :974  建 Run B  ← lease_id=lease.id, provider, model（完整）
     :1021 dispatch_to_daemon(run.id)            ⚠ 真正执行的是 Run B
```

根因（经评审修正）：**`dispatch_next_step` 与 `start_stage_dispatch` 两层都拥有 AgentRun 创建权**——上层预创建 Run A（`change/dispatch.py:709`，`lease_id=None`/`provider=None`/`model=None`/`pending`），下层 `start_stage_dispatch`（`agent/service.py:974`）又创建完整 Run B 并 dispatch，上层返回的却是 Run A。可参考的正确模式是同文件 `dispatch()`（`dispatch.py:544-559`）：不预创建，直接 `run = await start_stage_dispatch(...)` 用返回的真实 Run。

影响面（经评审精确化）：**仅 `/execute` 路径的 `dispatch_next_step`**。普通 stage transition 走 `dispatch()`（`change/service.py:456`），不重复创建。

后果（比初判更严重）：
1. 每次执行 DB 留两个 Run；Run A 永远 `pending`、无 lease、孤儿。
2. 返回 Run A id 写入 `last_dispatch.run_id`，前端据它订阅 SSE（`changes/[cid]/page.tsx:572`），日志却 publish 在 `agent_run:{Run_B}`——**前端收不到日志**。
3. **Run A 永久阻塞**：`has_active_run`（`dispatch.py:405`）把 `pending` 算作 active，而 `reconcile_stale_runs`（`dispatch.py:431`）与 `_cleanup_stale_runs_impl`（`service.py:1306`）**都只清理 `running`**——Run A 既不被 reconcile 也不被 cleanup，该 change 的后续 dispatch 永久返回 `active_run_exists`。

修复方向（低风险）：删除 `dispatch_next_step` 上层预创建 Run A 及其 workspace 关联，改用 `run = await start_stage_dispatch(...)` 返回值回填 `last_dispatch.run_id` 与返回前端（对齐 `dispatch()` 模式）。**不给 `start_stage_dispatch` 加"创建或复用"双模式**（避免重复 workspace 关联、字段回填、异常状态处理）。Wave 0 还需含**历史孤儿 pending Run 的定向清理**。

Wave 0 验收清单：
- 一次 execute 只产生一个 AgentRun。
- 返回 ID == `last_dispatch.run_id` == daemon lease 的 `agent_run_id`。
- 只有一条 workspace 关联；SSE 与历史日志用同一 Run ID。
- 启动失败不遗留永久 pending Run。
- 已存在的 Run A 能被安全清理。

**落地状态（2026-06-20 评审核实 + 补强）**：
- **重复创建**已于 `612e71a`（ql-20260619-001）修复：`dispatch_next_step` 不再预创建 Run A，改用 `start_stage_dispatch` 返回的真实 Run，并加 `cleanup_orphan_dispatch_runs` 精准指纹清历史孤儿。
- **残留缺口（本次发现并修复）**：`start_stage_dispatch` 在 `commit` Run（service.py:1014）后、`dispatch_to_daemon`（:1050）前若抛异常（workspace 关联失败 / placement 非 NoOnlineDaemon 异常 / dispatch 异常），Run 永久停在 `pending`，且 `spec_strategy=NULL` 不命中 sillyspec 指纹 → 既不被 `reconcile_stale_runs`（只清 running）也不被 orphan 清理抓到 → `has_active_run` 永久 True → change 卡死。现有 wave0 测试 mock 的是**整个** `start_stage_dispatch` 抛异常（Run 未创建），未覆盖此 commit-后-抛异常路径。
- **ql-20260620-001 补强**：① 给 `AgentRun` 加 `created_at` 字段（migration `202607050900`，NOT NULL server_default now()）；② 新增 `cleanup_stale_pending_runs`（10min 时间窗，清**任何来源**的超龄 pending 孤儿，与 `cleanup_orphan_dispatch_runs` 互补——后者无时间窗专清 sillyspec 指纹）；③ 抽 `_cleanup_before_dispatch` helper，`dispatch()` 与 `dispatch_next_step()` 统一调用（顺带修 `dispatch()` 此前从不调 orphan 清理的不一致）。
- **验证**：53 测试全过（含 5 个新测试：超龄清理/新鲜不误杀/非 pending 不动/跨 change 隔离/dispatch 端到端 unblock）+ mypy 全量 285 文件无 issue。

**独立于多 Agent，已完成。**

## 7. ✅ delegate_task 协议 spike —— 路径 B 通过（spike 04，2026-06-20）

> **结论：路径 B（输出解析）明确通过。** N=10 实测 H1 可解析率 100%、H2 合法率 100%、零失败（详见 `spikes/04-delegate-task/`）。委派内容质量高（扫描仓库→backend/frontend/integration/doc_compiler；加字段→arch/impl(.diff)/integration，read_only 标注正确）。
>
> **关键架构发现**：Coordinator 的分派阶段**必须用直接 messages API 调用，不能跑在 claude CLI/daemon agentic 框架里**——实测 claude CLI 的 agentic system prompt 会让 GLM 拒绝纯输出委派 JSON（`awaiting_task` / 直接执行任务 / 请求澄清），改直接 API 后 100% 通过。故 Coordinator ≠ daemon-spawned run，而是 backend 内嵌的 GLM 规划调用；Worker 才走 daemon。这条直接进 design。
>
> 以下为立项前的 spike 设计（已执行，路径 B 主门通过；路径 A/C 未单独验证——路径 B 已达标且规避 GLM 工具风险）。

主 Agent 如何触发 `delegate_task` 是可行性命门，取决于物理实现：
- **路径 A（工具调用）**：Coordinator 调 MCP/工具 `delegate({subtasks})` → 平台建子 Run。依赖 Agent 发起 tool use → **GLM 风险**（spike-02 D2 已证 GLM 工具调用部分可用、不稳定，Write 失败）。
- **路径 B（输出解析）**：Coordinator 输出结构化委派清单 → 平台解析建子 Run。**绕开 tool use，规避 GLM 工具风险**，但约束 Coordinator 输出格式。
- **路径 C（SDK 原生 subagent 映射）**：用 SDK `agents` 配置让 Coordinator 进程内置子 agent，daemon 把 `SubagentStart/Stop` + `parent_tool_use_id` 映射成平台子 AgentRun。复用 SDK 能力，但子 agent 同进程、独立 worktree/独立审批需额外设计。

spike 验证目标：

| 门 | 内容 | 判定 |
|---|---|---|
| **H1** | GLM 下 Coordinator 能否可靠触发委派（路径 A 工具调用 vs 路径 B 输出解析，各跑 N=10） | 成功率 ≥ 80% |
| **H2** | 委派参数/清单结构是否合法可解析 | 合格率 ≥ 80% |
| **H3** | **Coordinator 分阶段 batch 可行性**：拆任务(batch) → Worker 并行(batch) → 收敛(batch) 三次独立 batch Run，靠 Artifact + Mission 状态串联 | 闭环成功 |
| **D1** | 记录失败模式 | 供 delegate 物理实现选型 |

- **H3 通过 → 可绕开 interactive-session 硬依赖**（见 §8 D2 修正）。
- 路径 A 不达线 → 选路径 B；两者都不达 → Coordinator 单独配官方 Anthropic 凭证（Worker 仍走 GLM 省钱）。

## 8. 两个命门（含评审后修正）

**D2 时序约束 —— 修正：未必硬依赖 interactive-session。**
原判断"主 Agent 必须长生命周期 → 硬依赖 interactive-session"。**修正**：若 Coordinator 不需实时介入 Worker 执行，可建模为**多次 batch Run**（拆任务 → Worker 并行 → 收敛），每次都是现有批处理模型，**不必等 interactive**。只有"Worker 失败当场重派"等实时介入才需长生命周期——第一版 YAGNI 不做。**依赖 interactive 与否，由 spike H3 决定。**

**D1 委派入口 —— 平台层 delegate_task 协议，物理实现待 spike。**
SDK **具备**原生 subagent 能力（`agents`/Agent tool/SubagentStop），平台选自托管是为治理与可观察性（子 Run 是平台一等公民）。Coordinator 通过 delegate_task 协议触发，平台建可观察子 Run。物理实现（工具调用 A / 输出解析 B / SDK 映射 C）由 §7 spike 选型；GLM 风险是路径 A 的特定风险，路径 B/C 可规避，不是整体命门。

## 9. 场景落地

**Bootstrap / Scan（只读为主）—— "并行读、集中写"**：
1. 平台先做确定性扫描（目录/语言/模块清单）。
2. Coordinator 据清单拆任务。
3. 多个只读 Worker 并行分析（架构/规范/测试/集成/风险）。
4. Worker 只提交结构化 Artifact，**不并发写最终文档**。
5. Reviewer 查冲突与缺口。
6. **Finalizer 单点**生成 `.sillyspec/docs`（避免多 Agent 同时改文档的大量冲突）。

**Execute（代码执行）—— 独立 worktree + patch + 受控 apply-back**：
每个 Worker 在独立临时 worktree 返回 patch，Reviewer/Coordinator 验证后**受控 apply-back，不自动提交**。

## 10. 设计决策点（待 brainstorm 逐个拍板）

- **D1 委派入口物理实现**：工具调用 A / 输出解析 B（spike 选型）。
- **D2 主 Agent 生命周期**：分阶段 batch（默认）/ interactive 实时介入（按需，spike H3 决定）。
- **D3 编排智能**：✅ 已定 = 混合（平台骨架 + Coordinator 填细节）。
- **D4 结果回灌形态**：✅ 已定 = 只回结构化 Artifact，不回原始日志。
- **D5 审批粒度**：子 Run 工具审批各自独立走 canUseTool vs Coordinator 统一代办。
- **D6 部分失败**：N 个 Worker 挂 1 个 → 重试 / 降级 / 整体失败。
- **D7 关系模型**：DAG（AgentRunDependency）边界与 Mission 聚合规则。

## 11. 推进顺序（合并版）

1. **Wave 0** ✅ 已完成：修复重复 Run bug（§6）—— `612e71a` 修重复创建 + ql-20260620-001 补通用 stale-pending 兜底。
2. 设计 `AgentMission + AgentRun DAG + AgentArtifact`（领域模型 + 迁移）。
3. ✅ **delegate_task 协议 spike**（§7）—— 路径 B 通过（spike 04，H1/H2=100%）；关键发现：Coordinator 分派用直接 API、非 agentic 框架。
4. 改造日志页为 Mission 树（合并时间线 + Worker 独立日志）。
5. **Bootstrap Team MVP**（§9 上半，只读、并行读集中写，风险最低）。
6. 多 worktree 的 Execute 团队（§9 下半，patch + 受控 apply-back）。
7. 自动路由（single/team/auto）、成本策略、动态重派。

## 12. 不在范围内

- ❌ 不替换 `task-runner`（批处理路径零改动）。
- ❌ 第一版不支持 Worker 递归委派（一层 Coordinator + Workers）。
- ❌ 不让 provider 进程内部隐式 subagent 作为基础（必须映射成平台 Run）。
- ❌ 不做多 provider 团队（聚焦 claude；codex 后续）。
- ❌ Worker 不回灌原始日志（只回 Artifact）。

## 13. 成功标准（初步，brainstorm 细化）

- 一次进程执行严格对应一个 AgentRun（Wave 0 修复后不变量成立）。
- Coordinator 能在骨架内 `delegate_task` 出多个 Worker 并行执行，Worker 上下文独立、只回 Artifact。
- 平台前端以 Mission 树展示，Worker 日志分层可回看，Coordinator 不吞原始日志。
- Worker 工具调用经平台审批收口（复用 canUseTool 远程人审）。
- single/team/auto 三档可按任务特征自动或手动选择，第一版受硬约束（一层、≤5 Worker、预算/并发上限）。
- 现有批处理 lease（workspace agent run）行为零变化。

## 14. 关键文件索引（调研依据）

- `backend/app/modules/agent/model.py` — AgentRun 单次执行实体（无 parent_run_id）
- `backend/app/modules/agent/coordinator.py` — 单 run 可靠性服务（非多 agent）
- `backend/app/modules/agent/service.py:878` — `start_stage_dispatch`（重复 Run bug 的下层，:974 建第二个 Run）
- `backend/app/modules/change/dispatch.py:648` — `dispatch_next_step`（重复 Run bug 的上层，:709 建 Run A，:775 返回错 id）
- `backend/app/modules/spec_workspace/bootstrap.py` — bootstrap：1 run + 单 prompt
- `sillyhub-daemon/src/task-runner.ts` — 1 lease = 1 进程，跑完销毁；daemon 被动消费 lease
- `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx` — 扁平 AgentRun 列表
- `.sillyspec/changes/2026-06-18-daemon-interactive-session/spike-02-architecture-validation.md` — SDK 多 turn/interrupt/canUseTool/resume 实测（**未验 `agents` subagent**）+ GLM 工具调用 D2 caveat
- `sillyhub-daemon/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.3.181/.../sdk.d.ts` — SDK 实有 `agents?: Record<string, AgentDefinition>`(:1279) + SubagentStart/Stop hooks + `parent_tool_use_id`(:2650)
