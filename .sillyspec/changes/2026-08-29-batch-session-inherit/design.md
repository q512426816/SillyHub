---
author: qinyi
created_at: 2026-08-29 20:35:00
scale: large
tier: independent
---

# worker 会话中断重派继承 — 设计文档

## 背景

源自 multica `RecoverOrphanedTasks`/`PinTaskSession`/`gateResumeToReusedWorkdir` 调研的三缺口。**原始方向（batch lease 过期重派）经 Design Grill P0 证伪**：生产全部派发入口（quick-chat/orchestrator/patrol/worker）经 `dispatch_to_daemon` 创建 `kind='interactive'` 永不过期的 lease（placement.py:535-553），`handle_lease_expiry` 对真实任务不可达。**方向重定位（D-005）**：interactive worker 会话 daemon 掉线后的恢复缺口。

### 现状与缺口（源码实证）

- **worker 会话模型**：AgentSession 有 `role`（worker/orchestrator，model.py:386-390）与 `parent_session_id`（自引用 FK，:786-790，worker 子会话挂主会话下）；mission worker 由 orchestrator 经 `dispatch_worker` MCP 工具/`RunPlacementService` 派发，kind='interactive'。
- **daemon 掉线现状（daemon-platform-resilience 交付后）**：suspend_sessions_for_daemon（session/service.py:4680-4740）把该 daemon 全部 active 会话一视同仁标 suspended——**worker 子会话也被挂起**，但 worker 是临时会话无用户手恢复，只能等 24h SUSPENDED_MAX_AGE_SEC GC 标 failed（sweep.py），期间 mission 卡住等子会话。
- **offline sweep 同款**：session_offline_sweep_once 对 active 也一视同仁→suspended（sweep.py:248）。
- **resume 能力已有**：interactive 恢复链（sessions.json 快照→recover→restoreAndReconnect→confirm→active）+ AgentSession.agent_session_id 存 SDK resume id（model.py 注释）+ quick-chat 的 resume_session_id 白名单下发链（context.py:795→daemon.ts:6243→stream-json --resume）。
- **缺口**：worker 会话被挂起后无人触发恢复——mission orchestrator 只能等 GC 或用户手动 intervene。

## 设计目标

1. daemon 掉线（优雅停止或强杀）后，**worker 子会话自动重派继承原会话**（--resume 原 SDK session_id 续上下文继续干活），不挂起不 GC 等 24h
2. **主会话（orchestrator/用户 chat）语义不变**：suspended→daemon 回来自动恢复（daemon-platform-resilience 交付）
3. 重派不续错会话：work_dir（worktree_branch/worktree 路径）一致性由既有 worktree 机制保证（worker 的 cwd=per-worker worktree，branch 名已持久化 AgentSession.worktree_branch，重派经 dispatch 上下文重建同 worktree）

## 非目标（Non-Goals）

- 不改主会话（orchestrator/用户 chat）挂起/恢复语义
- 不做 poison 黑名单体系（infra 中断场景=可续；内容失败本就不在恢复面——suspend/re-sweep 只碰 active 会话）
- 不做前端展示变更（重派行为透明，mission 列表/会话面板已有数据）
- 不做 lease 过期 GC 路径（batch 死路径不动）
- 不做 mission converge/patrol 改动（worker 重派后 mission 收敛走既有链）

## 决策/方案选择（D-xxx）

详见 decisions.md：D-001 仅 infra 中断继承、D-002 resume 失败自动降级、D-003 最小闭环、D-004 设计确认（原方向）、**D-005 P0 方向重定位 worker 重派继承（supersedes 原设计的触发路径，保留 resume/降级/守卫语义）**。

## 总体方案（S1-S4）

### S1 — backend：worker/主会话分流挂起（session/service.py + sweep.py）

`suspend_sessions_for_daemon` 与 `session_offline_sweep_once` 两处挂起路径均按**子会话身份**分流：

- **识别口径**：`AgentSession.parent_session_id IS NOT NULL`（子会话=worker，比 role 词表稳——orchestrator 主会话无 parent；兼容 role=NULL 老 worker 行）
- **worker 子会话**：`status → failed`（error_code=`daemon_interrupted` 新错误码，与主会话的 daemon_stopped 区分来源）+ 中断 run → failed + lease → cancelled + **写重派种子**（见 S2）
- **主会话**（parent_session_id IS NULL）：suspended（现状语义逐字不变）

### S2 — backend：worker 自动重派（prepare_interactive_dispatch 复用原会话行）

worker failed 后自动重派（plan 调研定论：**必须走 `prepare_interactive_dispatch`**，不走 `dispatch_to_daemon`——后者会造裸 AgentSession 脱离 mission_worker_sessions 树致 list_workers/patrol 全瞎）：

- **重派原语**：`prepare_interactive_dispatch(agent_session_id=原子会话, ...)` 签名第一参就是 agent_session_id（placement.py:645-688）——天然「复用原 sub_session 行 + 新 interactive lease + 新首 run 挂原会话」；重派前把 session 从 failed 翻回 active + 清 ended_at + turn_count 归位
- **重派上下文**（AgentSession 行 + 首 AgentRun 行双表即可，不读原 lease metadata）：
  - AgentSession 行：provider / workspace_id / cwd（worktree 路径已持久化）/ tree_depth / agent_profile_id / runtime_id / agent_session_id（SDK resume id；NULL 时回退该会话最新 AgentRun.session_id，_heal_agent_session_id_from_runs 同源逻辑）
  - 首 AgentRun 行：model / objective / role / read_only / target_workspace_id / mission_id / worktree_branch / agent_profile_snapshot（**worktree_branch 在 AgentRun 不在 AgentSession——design 原文有误已修正**）
  - **prompt 重渲染**：按 first_run.objective + role 重渲染 build_worker_briefing（objective 在 run 行不丢；重派语义是「继续任务」非复刻首轮简报）
  - tool_config 由 worker_tool_config(first_run.read_only) 重算
- **resume_session_id 注入**：prepare_interactive_dispatch 需加 resume_session_id 形参（或经 _merge_lease_metadata 补键）写入 lease metadata
- **互斥守卫（plan 调研新增）**：①重派前置检查 mission.converged_at/cancelled_at（防已收敛 mission 又派活，对齐 patrol.py:750-751 守卫）；②patrol 职责④ worker_recovery 候选排除 error_code=daemon_interrupted（防旧 run 被翻回 pending 与新 run 双跑+日志噪音）；③重派须在 patrol 职责⑦ 30min worker_force_end 宽限内完成（标记为 mission 级单向置位无清除——超窗后 mission 被 derive 映 failed，重派成功也救不回，故须在窗内完成）
- 重派节流：attempt>=3 不再重派，session 终态 failed 留 mission converge/patrol 收敛
- 触发时机：suspend/sweep 写 failed 的同一事务后异步 fire（不阻塞挂起主路径；失败记日志下轮 offline sweep 重试——sweep 60s 周期自愈）

### S3 — daemon：worker claim 消费 resume（三处接线，plan 调研修正）

resume 链路在 interactive 路径当前**未接线**（与 batch 共用白名单但 interactive 分支不透传），需三处补齐：

- **backend ①**：`build_claim_payload` interactive 分支补 resume_session_id 透传（context.py:447-494 当前无此键；:795-796 只在 batch 分支）
- **daemon ②**：`_startInteractiveSession` 的 create 调用传 resume（daemon.ts:5784-5837 当前 CreateSessionInput 无 resume 字段；SessionManager 已支持 spec.resume → driverOpts.resume session-manager.ts:1588-1629——只需接线）
- **daemon ③**：归一化 execPayload.resumeSessionId → CreateSessionInput.resume（daemon.ts payload 归一化区）
- **work_dir 一致性**：worker 的 cwd=per-worker worktree 已持久化 AgentSession.cwd（plan 调研修正：非 worktree_branch 列）——重派 prepare_interactive_dispatch 复用原 cwd；worktree 不在则按 AgentRun.worktree_branch 重建（git worktree add）
- **首轮驱动（plan 调研定论：不需要 orchestrator re-inject）**：与首轮派发同构——lease metadata.prompt 经 claim → SessionManager.create({firstPrompt, resume}) → 10s deferred fallback 自动提交首轮（session-manager.ts:713-731 pendingFirstPrompt 机制）；orchestrator 侧零协议变更，新 run 出现在 list_workers 即可

### S4 — daemon：resume 失败自动降级（task-runner/session-manager）

- SessionManager.create 带 resume key 后若 SDK 启动即报 session 损伤（`session not found|no conversation found|unable to resume` 类）→ 清 resume key 重建**新会话**（fresh）+ 事件上报 `resume_downgraded`（agent 侧日志+终态 metadata 备查）
- 降级一次不循环（再失败按普通 create 失败走 worker failed 路径）

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| daemon 停止/掉线（有 worker 子会话 active） | suspend/sweep | session/run/lease | parent_session_id 非空识别 | worker: session failed(daemon_interrupted)+run failed+lease cancelled；主会话: suspended 不变 |
| worker 重派 | backend 异步 dispatch | 新 lease+新 AgentRun | resume_session_id=agent_session_id | 新 pending lease；daemon claim→SessionManager.create(resume) |
| worker claim（带 resume） | daemon | SessionManager | payload.resume_session_id | SDK resume 续会话（等 inject 跑新 turn） |
| worker resume 失败降级 | daemon SessionManager | — | 损伤模式命中 | 清 resume 新会话+resume_downgraded 披露；再失败→worker failed |
| worker 重派耗尽（attempt>=3） | backend | — | — | session failed 终态；mission converge/patrol 既有兜底 |
| 主会话挂起/恢复 | suspend/sweep/recover | — | parent IS NULL | suspended→recover→active（daemon-platform-resilience 语义，零改动） |

## 文件变更清单（File Changes）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/session/service.py | suspend_sessions_for_daemon 分流：worker 子会话 failed+重派种子 |
| 修改 | backend/app/modules/daemon/sweep.py | session_offline_sweep_once 同款分流 |
| 修改 | backend/app/modules/agent/worker_redispatch.py | worker 重派函数（prepare_interactive_dispatch 复用原会话行+双表上下文重建+resume 注入+互斥守卫；独立新文件防 mcp_tools.py 2600 行膨胀） |
| 修改 | backend/app/modules/agent/placement.py | prepare_interactive_dispatch 加 resume_session_id 形参 |
| 修改 | backend/app/modules/agent/patrol.py | 职责④候选排除 daemon_interrupted（互斥守卫②） |
| 修改 | backend/app/modules/daemon/lease/context.py | interactive 分支补 resume_session_id 白名单透传 |
| 修改 | sillyhub-daemon/src/daemon.ts | _startInteractiveSession 消费 resume_session_id 传 SessionManager.create |
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts | create 支持 resume key+损伤降级重建+resume_downgraded 事件 |
| 新增 | backend/app/modules/daemon/tests/test_worker_redispatch.py | S1/S2 backend 用例 |
| 修改 | backend/app/modules/daemon/tests/test_build_claim_payload.py | S3 claim 透传用例（扩展现有，不新建防 W1 冲突） |
| 新增 | sillyhub-daemon/tests/integration/worker-resume.test.ts | S3/S4 daemon 集成用例 |

## 接口定义

**claim payload interactive 分支扩展**（context.py interactive 分支）：
```
payload.resume_session_id?: string   # 白名单已有键，interactive 分支补透传
```

**SessionManager.create 扩展**（daemon 内部接口）：
```
create(options: { ..., resumeKey?: string })   // SDK 续会话；损伤时降级 fresh+事件
```

**新错误码**：`daemon_interrupted`（worker 子会话被 daemon 掉线中断，区别于主会话 `daemon_stopped`）。

## 风险登记（Risk Register）

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | worker 重派风暴（daemon 反复掉线→批量重派循环） | 高 | attempt>=3 上限；重派节流（异步 fire+下轮 sweep 自愈不即时风暴）；mission patrol 兜底收敛 |
| R2 | 主会话/worker 识别误判（老数据 role=NULL 且 parent 也 NULL 的 worker） | 中 | parent_session_id 为唯一口径（model 注释：NULL=非分身会话=主会话语义兼容存量）；灰度=先只对 mission worker（parent+mission_id 非空）生效，再扩大 |
| R3 | resume 后 SDK 会话历史与平台 DB 已落库轮次重复展示 | 低 | 新 run 独立流（run 分桶展示现状）；worker 会话前端入口为 mission 视图按 run 展示，不合并 |
| R4 | interactive 分支 claim payload 加字段打破既有测试 | 低 | 可选字段；daemon 端归一化缺省不传（旧 backend 兼容） |
| R5 | worker worktree 在 daemon 长时间离线后被 GC（worktree 租约过期） | 中 | 重派时 dispatch_worker 上下文重建 worktree（branch 名已持久化；worktree 不在则 git worktree add 重建） |
| R6 | 与并行变更 lease/session 文件冲突 | 中 | execute 前 worktree 基线检查；session/service.py 与 sweep.py 均为 resilience 变更刚交付文件，无其他活跃变更声明占用 |

## 自审（Self-Review）

- 章节完整 ✓；决策 D-001~005 全引用（D-005 supersede 关系明确）✓
- 契约表 6 行覆盖全部新增状态转移 ✓
- 原型：无 UI 变化跳过（继承原设计 D-004）✓
- ~~自审存疑 1~~ **已解决（plan 调研）**：AgentSession+首 AgentRun 双表够重建；prompt 按 objective 重渲染非复制原文；worktree_branch 在 AgentRun（原 design 有误已修正 S2）
- ~~自审存疑 2~~ **已解决（plan 调研）**：worker 首轮由 10s deferred fallback 驱动（非 orchestrator inject），重派同构零协议变更；新增三个互斥守卫（mission converged 检查/patrol ④排除/⑦30min 窗口对齐）入 S2
- 规模：跨 backend+daemon、session 状态机分流+重派编排——scale=large ✓
