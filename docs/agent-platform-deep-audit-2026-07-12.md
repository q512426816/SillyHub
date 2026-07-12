# Agent 平台能力深度审计与提升方案

> 生成日期：2026-07-12
> 作者：深度调研（3 轮：能力/编排/管理 + 可观测性/规划 + 链路核实）
> 目的：固化"如何更好驾驭 agent、提升能力、管理、团队协作"的调研成果，作为后续 SillySpec 变更立项的事实依据。
> 性质：**事实文档**，非变更规格。所有结论均带文件:行号依据。动手前请先核实行号是否漂移（代码仍在演进）。

---

## 0. 一句话结论

这个项目最大的提升空间**不是加新功能，而是接通已写好 90% 但没收尾的能力**。最该先做的两件事是修两个"界面骗人"级别的正确性 bug（各一个函数），然后打通已就绪的只读 team 模式，最后才是写代码 team 等大工程。

---

## 1. 现状总览（四维度成熟度）

| 能力面 | 真实状态 | 性质 |
|---|---|---|
| 单 agent 执行（scan/stage/对话/写代码） | 完整闭环，生产可用 | ✅ |
| 终止单个 agent | **batch 真 kill；interactive 假 kill（僵尸）** | 🔴 bug |
| 取消 mission | **造僵尸（worker 继续跑）** | 🔴 bug |
| 预算控制 | **只挡新派发，不杀在跑的** | 🟡 半成品 |
| 只读 team mission | 链路完整可用，就差入口 | 🟢 可打通 |
| 写代码 team mission | 断 2 处 + 共享 worktree 硬阻塞 | 🟠 大工程 |
| 断点续跑 | 后端全通（claude/codex），前端无按钮 | 🟡 可打通 |
| 多人多角色协作 | 成熟（per-member binding + 三人 e2e） | ✅ |
| 双层审批（工具级 + 阶段级） | 成熟，但审批卡"查看详情"点了没反应 | 🟢 微修 |
| agent 改动可视化（diff） | 字段早有，前端零展示 | 🟡 可打通 |

---

## 2. 四个反直觉发现（颠覆初判的关键事实）

### 发现 1：interactive session 的 kill 是假停（僵尸 bug）🔴

**现象**：用户点"终止"，界面立刻显示已停止，但 daemon 里的 claude/codex 进程其实还在跑、还在烧 token。

**证据链**：
- 前端 `frontend/src/lib/agent.ts:156` `killAgentRun` → POST `/workspaces/{wid}/agent/runs/{rid}/kill`
- `backend/app/modules/agent/router.py:346-371` `kill_agent_run`
- `backend/app/modules/agent/service.py:549-590` `kill_run` —— **唯一动作是 `cancel_lease(run_id)`，不改 AgentRun.status、不发 WS**
- `backend/app/modules/daemon/lease_service.py:281-340` `cancel_lease` —— 把 lease 置 cancelled + AgentRun 置 killed（给用户即时反馈），末尾调 `_ws_cancel_stub`
- `backend/app/modules/daemon/lease_service.py:435-448` `_ws_cancel_stub` —— **只打一行日志，什么都不发**。注释仍写"Wave 2 实现 WS Hub 后替换"（陈旧）
- daemon 端 interactive 路径 `sillyhub-daemon/src/daemon.ts:3234` `if (kind === 'interactive') { _startInteractiveSession(...); return; }` —— **直接 return，不进 TaskRunner，不启 lease 心跳循环**
- 心跳循环 `sillyhub-daemon/src/task-runner.ts:842-885` `_runLeaseHeartbeatLoop` 只在 batch `runLease`（task-runner.ts:523-533）内启动 → **interactive session 没有任何机制感知 backend 的 cancel**

**结果**：lease=cancelled + AgentRun=killed（DB 层"停了"），daemon 内存里 SDK 进程继续跑到自然结束 / idle expire。

### 发现 2：WS Hub 早就完整就绪，那个 stub 是陈旧注释 🟢

**事实**：`backend/app/modules/daemon/ws_hub.py:42` `DaemonWsHub` 完整，`send_session_control`（含 SESSION_INTERRUPT/END/INJECT/RESUME）现成可用。
- backend 接收端：daemon WS 握手 → `connect()`
- daemon 接收端：`sillyhub-daemon/src/daemon.ts:2439-2440` `case SESSION_INTERRUPT: _sessionManager.interrupt(sessionId)` → `session-manager.ts:1460` → `driver.interrupt` → `claude-sdk-driver.ts:367` `q.interrupt()`（turn 级 abort）
- **有测试覆盖**：`test_ws_hub_session_control.py`、`ws-client-session-control.test.ts`
- 现成模板：`backend/app/modules/daemon/session/service.py:707-784` `interrupt_session`（含 daemon_id 解析 `_resolve_daemon_id_for_runtime`）
- 端点：`POST /api/daemon/sessions/{id}/interrupt`（daemon/router.py:1781）—— **目前无人调用**

**含义**：修发现 1 的僵尸，**不需要补 WS Hub**，把 stub 换成已有 `send_session_control` 即可。

### 发现 3：team 模式不是"骨架在不能用"，而是"只读可用、写代码断了"

**只读 mission（bootstrap/分析类）：链路完整可用** ✅
- 创建：`backend/app/modules/agent/router.py:728-781` `create_mission` → GLM 规划 → 建 Worker Run → 治理门 → `dispatch_worker` 派发
- 派发：`backend/app/modules/agent/execution.py:88` `dispatch_worker` → `placement.py:149` `dispatch_to_daemon`（batch lease）
- 回灌：`backend/app/modules/daemon/lease/service.py:325` `complete_lease` 把 daemon 上报 output 写进 `AgentRun.output_redacted`
- 收敛入口：`lease/service.py:599-615` 调 `converge_mission_for_completed_run`（`finalizer.py:189`）
- artifact 回灌：`finalizer.py:216` 调 `collect_completed_artifacts`（`execution.py:168`）
- GLM 合并：全 worker 终态（`derive_status` 返回 done/degraded）时 `finalizer.py:224-226` 调 `finalize_bootstrap_mission` → `_glm_merge`，失败回退 `_concat_merge`
- 前端可读：`frontend/src/components/mission-console.tsx:261` 遍历 worker artifacts 渲染
- **断点（体验，非功能）**：合并 artifact 挂在 mission 第一个 worker（`finalizer.py:146` `_carrier_run`），用户认不出"这是最终结果"

**写代码 mission（impl worker）：断在 2 处** ❌
- 断点 A：`finalize_execute_mission`（`finalizer.py:167-186`）是 Wave 4 占位，**全代码无调用点**。grep 仅定义处 + dispatch.py:914 文档注释命中
- 断点 B：daemon batch 其实**已经上报 patch**（`task-runner.ts:691` `_finish` 调 `workspace.collectDiff`；`daemon.ts:3322-3331` completeLease body 含 patch/files_changed/insertions/deletions），backend `_apply_patch_to_worktree`（`lease/service.py:481-494`）也消费它（单 agent 写代码已是完整闭环）—— **但 collect_completed_artifacts 没把 patch 存成 `AgentArtifact(kind='patch')`**，所以 finalize_execute_mission 的 `select kind='patch'`（finalizer.py:174）查不到东西
- **硬阻塞 C**：`execution.py:104-130` `dispatch_worker` 给每个 worker 传**同一个 `root_path`**（workspace 根目录，无 per-worker 后缀）→ v1 共享 worktree。多个 impl worker 并行写会互相覆盖文件 + patch 基线漂移。`dispatch.py:808-817, 914-917` 注释明确："per-Worker 独立 worktree 隔离 = D-006 完整实现延后；v1 共享 worktree"

**daemon 端子代理可见性（独立维度，已落地）**：
- `sillyhub-daemon/src/interactive/claude-sdk-driver.ts:352` `forwardSubagentText=true`
- `session-manager.ts` partial 按 `parent_tool_use_id` 分桶 + depth 维护
- backend 落库三列 `parent_tool_use_id`/`subagent_type`/`depth`（migration `202606281237`）
- 这与"平台级 team 编排"是两条独立的"多 agent"维度

### 发现 4：预算从来不会真 kill 正在跑的 worker 🟡

**证据**：
- `backend/app/modules/agent/control.py:76-80` `can_dispatch_worker` —— **pre-dispatch 门**：`cost_so_far(mission.id) >= mission.budget_usd` 时拒绝派发**新** worker（reason=`budget_exceeded`）
- 已派出去的 worker **不再检查**，烧穿预算继续跑
- `budget_tokens` 字段（model.py:541）**全代码无任何强制点**
- 单 run 级（AgentRun）**没有预算字段**，只在 Mission 维度
- 默认预算硬编码 `budget_usd=4.0`（`spec_workspace/bootstrap.py:257`、`change/dispatch.py:943`）

**关联 bug**：`MissionControl.cancel`（`control.py:83-99`）cancel mission 时**只改 AgentRun.status，不调 `cancel_lease`** → 又造僵尸（与发现 1 同病）。daemon 不会被通知，worker 继续跑。

---

## 3. 真实可行的提升方案（三层 + 体验层）

> 每项标注：依据（文件:行号）/ 改动量 / 依赖 / 风险。改动量分：小（<1 模块）/ 中（跨模块）/ 大（跨端 + 数据层）。

### 🔴 第一层：正确性修复（必须先做）

#### P0-1 修 interactive kill 僵尸
- **改动**：`backend/app/modules/daemon/lease_service.py:340` 把 `self._ws_cancel_stub(lease)` 替换为——当 `lease.kind == 'interactive'` 且 session 仍 active 时，调 `get_daemon_ws_hub().send_session_control(daemon_id, DAEMON_MSG_SESSION_INTERRUPT, {session_id, lease_id, runtime_id})`
- **依据**：现成模板 `session/service.py:707-784` `interrupt_session`（含 `_resolve_daemon_id_for_runtime`）；WS Hub + daemon 接收端 + 测试全就位（发现 2）
- **改动量**：小（一个分支调用 + helper 复用）
- **风险**：低。WS 发送失败 best-effort（不阻塞 cancel_lease 主流程，与 `end_session` 一致）
- **可选收尾**：把 `_ws_cancel_stub` 注释里"Wave 2"改掉（Hub 早已就位，注释误导）
- **要不要 SESSION_END 替代 INTERRUPT**：INTERRUPT 是 turn 级（session 存活），SESSION_END 才真杀进程（`codex-app-server-driver.ts:1480` close → SIGTERM）。用户语义"终止 run"建议 INTERRUPT 足够（保留 session 上下文）；若要"彻底停烧 token"则用 END——**需设计决策**

#### P0-2 修 MissionControl.cancel 造僵尸
- **改动**：`backend/app/modules/agent/control.py:83-99` 对每个 active worker，除改 status，补调 `DaemonLeaseService(session).cancel_lease(run.id)`
- **依据**：cancel_lease 本身能通知 batch daemon（心跳循环）；配合 P0-1 后 interactive 也能停
- **改动量**：小
- **依赖**：最好在 P0-1 之后（覆盖 batch + interactive）
- **风险**：低

---

### 🟢 第二层：打通已写好的能力（高杠杆、低投入）

#### P1-1 把只读 team mission 用起来（ROADMAP 既定下一步）
- **改动**：
  1. `backend/app/modules/spec_workspace/router.py:273` `bootstrap_spec_workspace` 透传 `mode` 参数（当前硬编码 single）
  2. 前端 missions 页或工作区初始化加"用团队模式分析"入口
  3. 端到端真跑一次验证（ROADMAP 列的"delegate_task spike 运行时验证"）
- **依据**：只读 mission 链路端到端打通（发现 3）；`route()` 三档 single/team/auto 已实现（`delegation.py:39-53`）；team 关键词触发（`_TEAM_HINT_KEYWORDS`：扫描/架构/多模块/重构/...）
- **改动量**：小（参数透传 + 前端一个按钮）
- **风险**：低
- **价值**：立刻让你"真正用上 agent 团队"做并行分析

#### P1-2 前端补 resume 按钮
- **改动**：`frontend/src/lib/agent.ts` 加 `resumeRun`（后端 `resume_agent_run` API 已有，api-types.ts:1589）；智能体控制台失败/中断 run 加"续跑"按钮
- **依据**：后端 `coordinator.py:236-311` `resume_run`（token + 重置 pending）；interactive SESSION_RESUME 续上下文（claude/codex，`session/service.py:1355-1414`）；token 预生成（`service.py:458-459`）
- **改动量**：小
- **注意**：batch 是整个重跑（retry_count+1），只有 interactive 真续上下文——UI 要标注
- **限制**：interactive resume 仅 claude/codex，其他 provider 抛 `DaemonSessionResumeUnsupported`（session/service.py:102-111）

#### P1-3 前端展示 diff_summary
- **改动**：智能体控制台活跃卡/历史行加"改动"展开，渲染 `run.diff_summary`（最好 +/- 着色 diff 视图）
- **依据**：字段早有（`frontend/src/lib/agent.ts:24`），后端 `diff_collector.py` 产出；全前端零展示（仅 `tasks/[tid]/page.tsx:749-753` 一行纯文本）
- **改动量**：小

#### P1-4 审批卡"查看详情"补 onClick
- **改动**：`frontend/src/app/(dashboard)/workspaces/[id]/approvals/page.tsx:345-347` 占位 button 接详情抽屉
- **改动量**：小

#### P1-5 mission 最终结果独立展示
- **改动**：`frontend/src/components/mission-console.tsx` 加"最终合并结果"独立区（现在合并 artifact 混在第一个 worker 里，`_carrier_run` finalizer.py:77-85）
- **改动量**：小

---

### 🟠 第三层：能力跃升（中等投入，有依赖）

#### P2-1 预算变硬门（超预算真 kill 在跑的 worker）
- **改动**：
  1. 新增 backend 周期巡检任务（成本归集在 backend，daemon 拿不到），定期 `cost_so_far` → 超阈值对每个 running worker 调 `kill_run`
  2. 可挂 `cleanup_stale_runs`（service.py:980 / 1753）同类后台任务附近
  3. 复用 P0-1/P0-2 修好的 kill 链路
- **依据**：现"周期检查成本然后 kill"机制**不存在**（`leaseHeartbeat` 是 daemon 拉状态，不查成本）
- **依赖**：**必须 P0-1 + P0-2 先修好**，否则 kill 也是僵尸
- **改动量**：中
- **风险**：中（巡检周期 / 阈值 / 并发竞态需设计）

#### P2-2 写代码 team mission 真正落地
- **改动（4 处）**：
  1. **per-worker worktree 隔离（硬阻塞，最关键）**：`execution.py:88-130` `dispatch_worker` 给每个写 worker 起 `git worktree add` 临时分支目录，不再共享 `ws.root_path`
  2. `collect_completed_artifacts`（execution.py:168）把 daemon 上报的 `result["patch"]` 存成 `AgentArtifact(kind="patch")`
  3. `converge_mission_for_completed_run`（finalizer.py:224）按 mission 类型分流，execute 走 `finalize_execute_mission`
  4. `finalize_execute_mission`（finalizer.py:167）实现真正的 patch 合并（顺序 apply + 冲突裁决，复用 `_apply_patch_to_worktree` 引擎 lease/service.py:481）
- **依据**：采集（`task-runner.ts:691`）/ 上报（`daemon.ts:3322`）/ 单 agent apply（`lease/service.py:481`）全已就位，缺的就是隔离 + 合并
- **改动量**：大（per-worker worktree 是 D-006 已知延后项）
- **风险**：patch 顺序 / 冲突 / 基线漂移——建议设计成"人审 apply-back"（design D-006 原意）
- **设计决策**：patch 合并失败时 GLM 裁决 vs 人工 vs 失败整个 mission？需 brainstorm

#### P2-3 Coordinator 模型可配置
- **改动**：`backend/app/modules/agent/delegation.py:84-99` `GLMConfig`，默认 `glm-5.2`（:98）写死 → 改成 env / workspace 配置
- **改动量**：小
- **关联**：Finalizer 同样走 GLM（`finalizer.py:94-120`），一起配置化

---

### ⚪ 第四层：体验增强（按需）

| # | 动作 | 依据 | 改动量 |
|---|---|---|---|
| P3-1 | 失败 run 自动建 incident 工单 | incident 模块（incident/service.py:47-77）纯手工 CRUD，与 agent 失败零联动 | 中 |
| P3-2 | tool 失败率前端可见 | 后端算了（service.py:64-223），注释明说 non-blocking/no alert/no display | 中 |
| P3-3 | agent 团队拓扑图 | mission-console 纯列表（mission-console.tsx:401），看不出 worker 依赖/时序 | 中 |
| P3-4 | 更多 interactive driver | 探测 12 provider（agent-detector.ts:104），driver 仅 claude+codex（cli.ts:603） | 大 |
| P3-5 | 启用 reviewer/qa/component_lead 系统角色 | auth 种子 7 角色，工作区成员 API 只让授 owner/developer/viewer（members_service.py:41） | 小 |

---

## 4. 推荐执行顺序（依赖关系）

```
P0-1 修 interactive kill ──┐
P0-2 修 cancel 僵尸 ───────┤
                          ├──→ P2-1 预算硬门（依赖 kill 真能停）
P1-1 只读 team ────────────┤
P1-2 resume 按钮 ──────────┤   这些都独立，可并行做
P1-3 diff 展示 ────────────┤
P1-4/5 审批/final 展示 ────┘

P2-2 写代码 team ──→ 独立大工程，per-worker worktree 是硬门槛（D-006 延后项）
P2-3 Coordinator 模型配置 ──→ 独立小改
```

**最高 ROI 路径**：P0-1 + P0-2（各一个函数，修"界面骗人"级正确性）→ P1-1（ROADMAP 既定，立刻能用上 team）→ P1-2/3（前端补全）→ P2-1（预算硬门）→ P2-2（写代码 team）。

---

## 5. 配套核实到的事实（备查，动手时参考）

### 5.1 Agent 能力边界
- **provider 探测 12 个**：claude/codex/copilot/opencode/openclaw/hermes/gemini/pi/cursor/kimi/kiro/antigravity（`sillyhub-daemon/src/agent-detector.ts:104-180`）
- **interactive driver 仅 2 个**：claude（`claude-sdk-driver.ts`）+ codex（`codex-app-server-driver.ts`），注册于 `cli.ts:603`
- **6 种协议适配器**：stream_json/json_rpc/jsonl/ndjson/pi_json/text（`sillyhub-daemon/src/adapters/`）
- **batch 能跑任何探测到的 provider；interactive/scan 只能 claude/codex**
- 命名归一化：backend 用 `agent_type='claude_code'`，daemon detector 用 `'claude'`，必须 `normalizeProvider()`（agent-detector.ts:202-207）

### 5.2 任务类型（dispatch 入口 × lease kind）
| 类型 | 入口 | lease kind |
|---|---|---|
| 扫描 scan | `service.py:1246` `start_scan_dispatch` | interactive（manual_approval+ask_user_only，placement.py:259-260） |
| 变更流程 stage | `service.py:992` `start_stage_dispatch` | interactive |
| 任务执行 task | `service.py:361` `start_run` | batch（task_id+lease_id） |
| 对话 dialog | `daemon/session/service.py` `create_session` | interactive（长生命周期） |
| 初始化 init | `service.py:1511` `start_init_dispatch` | batch（mode='init'，不走 agent 进程） |
| 多 agent mission | `router.py:728` `create_mission` | batch（dispatch_to_daemon） |

### 5.3 核心数据模型
- `AgentRun`（model.py:26-296）：状态 pending/running/completed/failed/killed；含 idempotency_key/resume_token/checkpoint/usage（cost/tokens，claude 有 cache 列 codex 无）/gate_result/mission_id/parent_run_id/role
- `AgentRunLog`（model.py:299-384）：channel + dedup_key + 子代理归属三列 + tool_kind（14 枚举）
- `AgentSession`（model.py:387-500）：跨多 turn，agent_session_id ≠ AgentRun.session_id（刻意区分，前者 SDK 返回用于 resume）
- `AgentMission`（model.py:503-568）：**status 不持久化**，由 derive_status 派生（mission.py:29-54）；无 final/merged 字段
- `AgentArtifact`（model.py:606）：kind ∈ summary/patch/test_result/evidence；content_ref 截断
- `AgentRunDependency`（model.py:571）：DAG 边（v1 flat，无独立 wiring）

### 5.4 管理与协作能力（成熟，列出备查）
- **双层审批**：
  - 工具级：`permission_service.py` canUseTool（5min 超时 deny）+ AskUserQuestion（持久化 session_dialog_requests，不超时）
  - 阶段级：PendingReview 四面板（proposal/plan/human_test/archive，change/service.py:1199/1257/1329/1584）
- **Gate 三态决策**（change/dispatch.py:312-443，P3 driver-gate）：exit 0 推进 / exit 1 重跑（连续 ≥3 次升级 exit 2）/ exit 2 fail-loud 卡住
- **权限**：7 角色（platform_admin/workspace_owner/component_lead/developer/reviewer/qa/viewer）+ ~40 权限点（permissions.py:34-144），成员 API 仅授 owner/developer/viewer
- **daemon 路由**：per-member binding（WorkspaceMemberRuntime，member_runtimes/model.py:21），无 binding 即 `NoOnlineDaemonError`（placement.py:691-808）
- **Coordinator 用 GLM**：直接 messages API 不走 CLI（delegation.py:150-202，spike 04 结论：CLI 的 agentic system prompt 让 GLM 拒绝输出纯委派 JSON）

### 5.5 已知技术债（来自 ROADMAP，与本文交叉）
- 🔴 scan 文档全量结构性过期（停在 source_commit ba87eec）
- 🔴 sillyspec.db changes 表为空（进度跟踪失效）
- 🟠 待部署验证的 migration（daemon-entity-binding 等）

---

## 6. 待用户拍板的切入点（4 个互斥方向）

1. **先修两个僵尸 bug**（P0-1 + P0-2）—— 最危险、改动最小、是预算硬门前置
2. **打通只读 team**（P1-1）—— ROADMAP 既定，低投入高可见
3. **做写代码 team**（P2-2）—— 投入大、价值大、per-worker worktree 硬阻塞
4. **补前端可视化**（P1-2/3/4/5）—— 用户体验提升，不碰后端

> 用户当前指示：先生成本文档固化为先，下一步再定。

---

## 附录 A：核实程度说明

| 核实程度 | 含义 | 本文标注方式 |
|---|---|---|
| 亲自读代码确认 | 直接 Read 过该文件该行 | 带"亲自核实"或直接引用 |
| 子代理调研 + 行号 | Explore agent 返回，未逐一回读 | 带文件:行号 |
| 注释声明但行为已验证 | 注释与实际不符（如 mission.py:6-7 旧注释 vs execution.py 已实现） | 标注"注释过时" |
| 注释声明未验证 | 仅注释/文档声明，未读代码 | 标注"待验证" |

## 附录 B：关键文件索引（按模块）

**Agent 编排核心**：
- `backend/app/modules/agent/{model,service,router,placement,coordinator,mission,execution,control,finalizer,delegation,diff_collector,post_scan_validator}.py`
- `backend/app/modules/spec_workspace/{bootstrap,router}.py`
- `backend/app/modules/change/dispatch.py`

**Daemon lease / kill 链路**：
- `backend/app/modules/daemon/lease/service.py`（complete_lease / cancel_lease / _apply_patch_to_worktree / converge 钩子）
- `backend/app/modules/daemon/lease_service.py`（cancel_lease / _ws_cancel_stub）
- `backend/app/modules/daemon/ws_hub.py`（DaemonWsHub / send_session_control）
- `backend/app/modules/daemon/session/service.py`（interrupt_session / reopen_session_for_resume）

**Daemon 端**：
- `sillyhub-daemon/src/{daemon,task-runner,workspace,ws-client}.ts`
- `sillyhub-daemon/src/interactive/{driver,claude-sdk-driver,codex-app-server-driver,session-manager,types}.ts`
- `sillyhub-daemon/src/adapters/`（6 协议适配器）

**前端**：
- `frontend/src/app/(dashboard)/workspaces/[id]/{agent,missions,approvals,runtime,incidents}/page.tsx`
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`
- `frontend/src/components/{mission-console,agent-run-panel,agent-log-viewer,session-permission-panel,ask-user-dialog-card,permission-approval-card}.tsx`
- `frontend/src/lib/agent.ts`

**权限/协作**：
- `backend/app/modules/auth/{permissions,model}.py`
- `backend/app/modules/workspace/{members_service,members_router,member_runtimes/}.py`
