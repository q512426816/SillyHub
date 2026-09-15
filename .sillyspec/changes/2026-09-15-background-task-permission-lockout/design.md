---
author: qinyi
created_at: 2026-09-15 16:01:48
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-15-background-task-permission-lockout

## 背景

线上会话 6e213eb3-781e-414a-89c8-905c79c79d89（2026-09-15，奖惩功能开发）排查实锤四项缺陷，全部围绕「后台 Task 子代理存活期与轮次生命周期错位」：

1. **写通道守卫锁死后台任务（P0，真金白银损失）**。`onResult`（events.ts:55）在轮次正常收尾时清空 `currentRunId` 并翻 `status='active'`；而 Task 子代理在 SDK 侧继续运行、其工具调用仍进入会话级 `canUseTool` 回调。`writeChannelGuardDeny`（permission.ts:151）对 `status≠running` 一律 fail-closed deny（stale-flip 宽限窗要求 `currentRunId` 仍在，正常收尾不满足）。实证：后台任务 abe100c921a0a2c80 被拒后重试 **94.5 分钟 / 1030 次工具调用**，烧掉 ~87M cache-read token（~$46 按快照差分错记到两个无辜小 run：19 秒的「还在跑？」run 被记 $24.10）。

   会话侧 agent 故障报告（P0-1）补充的完整打击面——**本会话至少发生 5 次**：① brainstorm 复审子代理重试 10 次/约 4 分钟未自愈，核验完成但无法写结果文件；② TaskCard 子代理（a03293aee92466915）35 分钟全程被拒，三张卡内容只能整段文本回传；③ task-03 子代理（a8844f5450a92e9af）整轮 22 分钟写类全拒，441 行代码只能由主流程代为落盘；④ task-04 子代理（aa0f27b3a1a9ad47c）44 分钟运行，末段靠「结束本轮进入空闲」自愈；⑤ 主会话也被击中一次（Bash/Grep/Glob 全拒，只能挂 4 分钟 idle 定时器等新 turn）。特征：只读工具正常、仅 sleep 放行（读类不经 canUseTool）；同 run 内重试不可自愈、开新 turn 恢复——与「锚点脱落而非会话结束」的根因一致。故障报告的期望映射：期望1（根因修复绑定脱落）= 本变更 FR-01；期望2（自动重绑/透明重试）**被 FR-01 取代**（通道保持可用，根本无需重试，优于重试）；期望3（可区分「权限拒绝」vs「平台故障」的故障码）= FR-02 扩展（拒收 deny 与守卫 deny 的 message 均带稳定平台故障码前缀）。
2. **后端权限受理端 fail-soft 静默丢弃（含 dialog 无界挂起）**。`handle_permission_request`（permission_service.py:329）任一校验失败仅 warn + return False。backend 重启清理终态化在跑 run 后（02:12:50 failed），SDK 侧仍在执行的轮次于 02:18:13 发出的 AskUserQuestion 问答卡被 `permission_request_run_mismatch`（current_run_id=null）静默丢弃——用户永远看不到该卡；且 dialog 类请求 daemon 侧**不启 5 分钟兜底**（permission-resolver.ts:200-210，对齐 backend「dialog 无限期等待」语义）、backend 侧也未落行未 arm timer——SDK 侧该 canUseTool **无限期挂起**。
3. **重启终态化无错误码**。`_cleanup_stale_runs_impl`（agent/service.py:2396）标 failed 只写 `output_redacted` + `exit_code=-1`，`error_code`/`error_detail` 均空——线上出现无错误码的「无声失败」run，排障时无从分辨。
4. **用量差分记账归属误导（P2）**。SDK `modelUsage`/`total_cost_usd` 是会话级跨轮累计快照（含 Task 子代理全部调用），daemon 按相邻快照差分记到「下一个收口的 run」（daemon.ts:3912 `_deltaModelUsage`）。两次 run 收口之间的后台任务消耗全部错记给无辜 run。总量正确、归属误导。

## 设计目标

- FR-01：主轮收尾后，仍有存活后台任务的会话保持写/审批通道可用（守卫放行 + 权限请求可达后端并受理），后台任务终态后自动恢复 fail-closed。
- FR-02：权限/问答请求被后端拒收时，daemon 端在**有界时间内**收到带原因的明确 deny（普通请求即时推送、dialog 类请求兜底超时也覆盖），不再静默丢弃 + 无界挂起。**deny message 带稳定平台故障码前缀**（backend 拒收 `PLATFORM_PERMISSION_DROPPED:<原因>`、daemon 守卫残留 deny `PLATFORM_NO_RUNNING_TURN:<状态>`），让 agent 可程序化区分「用户权限拒绝」与「平台故障」（会话侧故障报告 P0-1 期望3）。
- FR-03：重启终态化的 run 补写结构化 `error_code`/`error_detail`。
- FR-04：run 用量上报在「本 run 收口时后台任务仍在跑」的场景追加 `[USAGE_NOTE]` 标注日志行，如实告知该数字含后台任务消耗。

## 非目标

- 按任务拆分用量：SDK 只给会话级累计快照，无 per-task 数据源，明确不做（记账归属维持现状 + 标注）。
- 上游 CLI `task_progress` 的 `total_tokens=0`：daemon 忠实透传上游值，不改（纯 cosmetic）。
- 真实计费价目表（`llm_providers` 无 pricing 列，`total_cost_usd` 是 SDK 估价——如实呈现，不引入价格配置）。
- 前端 UI 任何改动；问答卡「复活/补发」机制（本变更只保证不再静默丢 + 有界拒收）。
- daemon 自更新在后台任务存活期的重启策略（现状照常放行重启、后台任务随进程消亡——非回归，入风险登记 R-06）。
- 会话侧故障报告的 **P1-1（后台任务完成通知截断 + TaskOutput 输出文件 0 字节空壳）与 P1-2（通知风暴/滞后回执）**：属后台任务通知投递子系统，与本变更（权限通道）正交，另立变更 `2026-09-15-background-task-notification-delivery` 承接，不混入本变更。

## 拆分判断

四项缺陷同根同源（后台任务存活期 × 轮次/权限生命周期错位），拆开修会造成协议字段与守卫条件互相依赖、多次部署窗口；合并为单变更一次收口。不走批量模式（单仓两组件，无跨仓）。

## 总体方案

**Wave 1（daemon 侧，FR-01/02/04）**

- `onResult`（events.ts）：收尾时若该会话后台任务注册表（`mgr._backgroundTasks`）非空，**保留 `currentRunId` 作后台锚点**（status 仍翻 active）。锚点语义：仅代表「后台任务群的派发轮次仍需通道」。已知行为变化：provider/config switch 的空闲判定（session-manager.ts:1553/1671 读 currentRunId）会推迟到下一轮边界才认为空闲——方向保守（切配置等待更久），可接受，不改。
- 任务终态注销点（background-tasks.ts `handleTaskNotificationEvent` 的 `tasks.delete(taskId)` 之后）：若注册表清空且 `state.status==='active' && state.currentRunId`，清掉锚点（新一轮在跑时 status=running，不误清）。会话终态清理 `clearBackgroundTasks` 同步清锚点。
- SessionManager 门面新增只读公共访问器 `hasLiveBackgroundTasks(sessionId): boolean`（session-manager.ts；注册表 `_backgroundTasks` 为私有，daemon.ts 等外部消费者不可直达；同族 permission.ts 经 core 直接读注册表）。
- `writeChannelGuardDeny`（permission.ts）：新增放行条件 `hasBackgroundTaskGrace`——`status==='active' && currentRunId 仍在 && 注册表非空`。与 `withinStaleFlipGrace` 并列为第二宽限源（设计哲学同源：注册表是「后台工作确定存活」的权威信号，比时间窗猜测强）。
- **`backgroundTask` 标记统一注入（Grill 阻断项①修正）**：新增辅助函数 `backgroundTaskFlag(state, hasLive): boolean`（= `state.status!=='running' && hasLive`），注入点按 guard 可达性枚举（Grill 复核修正：**4 处可达** + 2 处不可达说明）：
  1. `buildCanUseToolCallback` 默认普通审批 register（permission.ts:524，Claude 后台子代理 Write/Bash 的**实际主路径**——P0 场景）；
  2. AskUserQuestion 拦截 register（permission.ts:362）；
  3. ExitPlanMode register（permission.ts:441）；
  4. `requestPermissionImpl` register（permission.ts:209，codex/pi sessionPermission 路径）。

  不可达说明：`requestUserDialogImpl`（permission.ts:261）与 `buildOnUserDialogCallback`（permission.ts:612）有前置硬检查 `status!=='running' → cancelled`（permission.ts:251/:597-603），后台锚点态（status=active）根本到不了 register——注入为死代码，**不注入**；该语义在 Wave 3 测试中标注断言（锚点态 onUserDialog 路径维持 cancelled，与现状一致、无挂起）。
  主轮进行中（status=running）恒 false——标记只在「轮次已收尾但后台任务存活」的后台锚点态置位。
- **后台 dialog 请求有界兜底（Grill 阻断项②修正）**：`permission-resolver.ts` register 中，`backgroundTask===true` 的请求**即使带 dialogKind 也启用** 5 分钟 fallback timer（现状 dialog 一律不启，permission-resolver.ts:200-210）。理由：后台锚点态的 dialog 已是降级路径，无界挂起（新 daemon+旧 backend 组合下被拒收）比 5 分钟后 deny + agent 走推荐项更糟；主轮进行中的 dialog 维持现状不设超时（用户决策必须等待的语义不破坏）。
- `daemon.ts` run 结果上报处（`_modelUsageBaselineBySession` 差分同一路径）：若 `hasLiveBackgroundTasks(sessionId)`，向**正在收口的 runId** 追加一条 stdout 日志行 `[USAGE_NOTE] 本轮上报用量含仍在运行的后台任务消耗（SDK 为会话级累计快照，无法按任务拆分）`（复用既有 `[TASK_*]` 行写入通道——已有向终态 run 写行先例）。

**Wave 2（backend 侧，FR-01/02/03）**

- `PermissionRequestPayload`（protocol.py）加 `background_task: bool | None = None`。
- `handle_permission_request`（permission_service.py）：`payload.background_task is True` 时，**整个 current_run 校验块**（run 匹配 permission_service.py:423 + active-turn :432 两分支）替换为「按 `payload.run_id` 直查 AgentRun + 校验 `run.agent_session_id == session_id`」（派发轮次归属完整性）；其余校验（session 存在/runtime 归属/session active/manual_approval）不变、顺序不变。
- 同函数**所有**校验失败分支：return False 前经 `self._hub.send_permission_response(daemon_id, {...})` 推即时 deny（best-effort，发送失败仅 warn 不抛——daemon 侧仍有第 1 项的 5 分钟兜底覆盖所有请求形态）。deny payload 对齐既有下行先例**必带 `runtime_id` ack 键**（permission_service.py:1503-1510）+ `session_id`/`request_id`/`decision='deny'`/`message`；message 格式 `PLATFORM_PERMISSION_DROPPED: <具体拒收原因> — retry in a new turn`（稳定故障码前缀，P0-1 期望3）。daemon resolver `resolve()` 对 unknown/迟到响应已安全忽略（返回 `'unknown_request'` 不抛）。
- daemon 守卫残留 deny 路径（`writeChannelGuardDeny` 两处 message，permission.ts:169/191/327）同步加 `PLATFORM_NO_RUNNING_TURN:` 码前缀（存量文案信息保留），主轮进行中的普通人审 deny 文案**不改**（那是用户决策、非平台故障）。
- `_cleanup_stale_runs_impl`（agent/service.py）：failed 分支补 `error_code='SERVICE_RESTART_INTERRUPTED'` + `error_detail={"reason": "backend service restarted while run was active", "finished_by": "startup_cleanup"}`；completed 恢复分支不写 error_code。

**Wave 3（测试）**

- daemon 单测：守卫三态新分支（注册表空 deny / 非空放行 / currentRunId 无 deny）、锚点保留与终态清除、**4 处可达 register 调用点逐一断言 `background_task` 透传**（尤其默认普通审批路径）+ 2 处不可达路径断言锚点态维持 cancelled、后台 dialog 的 5 分钟兜底启用、USAGE_NOTE 日志行触发条件。
- backend 单测：`background_task=True` 受理（run 已 completed 仍受理 + 归属不匹配仍拒收并推 deny）、全部校验失败路径推送即时 deny（mock hub 断言 payload 含 runtime_id/request_id/message）、cleanup 写 error_code 断言。
- 既有相关测试保持绿：permission_service 既有 fail-soft 测试同步改断言（现在会推 deny）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/interactive/session-manager/events.ts | `onResult` 注册表非空时保留 currentRunId（后台锚点，含注释） |
| 修改 | sillyhub-daemon/src/interactive/session-manager/background-tasks.ts | `handleTaskNotificationEvent` 注销后注册表清空时清锚点；`clearBackgroundTasks` 同步清 |
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts | 新增只读公共访问器 `hasLiveBackgroundTasks(sessionId)`（`_backgroundTasks` 私有，daemon.ts 外部消费需门面） |
| 修改 | sillyhub-daemon/src/interactive/session-manager/permission.ts | `writeChannelGuardDeny` 新增 `hasBackgroundTaskGrace` 放行；新增 `backgroundTaskFlag` 辅助；**4 处可达** register 调用点统一注入 `backgroundTask` |
| 修改 | sillyhub-daemon/src/interactive/permission-resolver.ts | `PermissionRegisterInput.backgroundTask?: boolean` → payload `background_task`；`backgroundTask===true` 时 dialog 也启用 5min fallback。数据流：producer=permission.ts 4 处可达 register → resolver payload 组装（snake_case `background_task`）→ WS → consumer=backend `PermissionRequestPayload` |
| 修改 | sillyhub-daemon/src/daemon.ts | run 结果上报时 `hasLiveBackgroundTasks` 为真追加 `[USAGE_NOTE]` 日志行（挂正在收口的 runId） |
| 修改 | backend/app/modules/daemon/protocol.py | `PermissionRequestPayload.background_task: bool \| None = None`（缺省 None 兼容旧 daemon） |
| 修改 | backend/app/modules/daemon/permission_service.py | 受理放宽（background_task=True 时整个 current_run 校验块替换为 run 直查+归属校验）；全部校验失败分支推即时 deny（payload 对齐 :1503-1510 先例带 runtime_id；数据流：permission_service → `ws_hub.send_permission_response` → daemon WS → resolver.resolve 按 request_id settle deny） |
| 修改 | backend/app/modules/agent/service.py | `_cleanup_stale_runs_impl` failed 分支补 error_code/error_detail |

## 接口定义

```typescript
// sillyhub-daemon/src/interactive/session-manager.ts（门面）
/** 会话是否有存活后台任务（只读，不建 map）。 */
hasLiveBackgroundTasks(sessionId: string): boolean;

// sillyhub-daemon/src/interactive/session-manager/permission.ts
/** 后台任务宽限判定（注册表=权威存活信号，任务终态注销兜底收敛）。 */
export function hasBackgroundTaskGrace(mgr, state): boolean;
// = state.status==='active' && !!state.currentRunId && 注册表.size>0

/** background_task 标记：仅后台锚点态（轮次已收尾但后台任务存活）为 true。 */
export function backgroundTaskFlag(state, hasLive): boolean;
// = state.status!=='running' && hasLive

// sillyhub-daemon/src/interactive/permission-resolver.ts
export interface PermissionRegisterInput {
  // ...既有字段不变...
  /** 后台锚点态标记：写入 payload 的 background_task；true 时 dialog 也启 5min fallback。 */
  backgroundTask?: boolean;
}
```

```python
# backend/app/modules/daemon/protocol.py
class PermissionRequestPayload(BaseModel):
    # ...既有字段不变...
    background_task: bool | None = None  # daemon 主轮收尾后后台任务存活的权限请求标记

# backend/app/modules/daemon/permission_service.py
async def _deny_respond(
    self, daemon_id: uuid.UUID, payload: PermissionRequestPayload, reason: str
) -> None:
    """校验失败即时 deny 下行（best-effort，失败仅 warn）。
    payload 对齐既有 deny 下行先例（:1503-1510）：runtime_id ack 键 + session_id +
    request_id + decision='deny' + message=f"PLATFORM_PERMISSION_DROPPED: {reason}
    — retry in a new turn"（稳定平台故障码，agent 可区分用户拒绝/平台故障）。"""
```

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| PERMISSION_REQUEST（后台宽限） | daemon canUseTool（后台任务） | backend permission_service | session_id, run_id, request_id, tool_name, input, background_task=true | 无 run 状态变化；dialog 时落 session_dialog_requests(pending) |
| PERMISSION_RESPONSE（拒收即时 deny） | backend permission_service | daemon resolver | runtime_id, session_id, request_id, decision=deny, message | daemon resolver pending → settled(deny) |
| turn result（带后台锚点） | daemon SDK | daemon session-manager | runId, result | status running→active；currentRunId 保留（注册表非空时）；注册表清空时清锚点 |
| startup cleanup | backend | agent_runs 行 | error_code=SERVICE_RESTART_INTERRUPTED, error_detail | running→failed（含结构化错误码） |

## 数据模型

无表结构变更。`PermissionRequestPayload` 为 WS 协议字段扩展（向后兼容，见下）。

## 兼容策略（brownfield 必填）

- **旧 daemon + 新 backend**：`background_task` 缺省 None，backend 走原 active-turn 校验——行为与现状完全一致（多出的即时 deny 推送对旧 daemon 无害：resolver 按 request_id settle，unknown 安全忽略）。
- **新 daemon + 旧 backend**：daemon 多发 `background_task` 字段，旧 backend pydantic 忽略未知字段；守卫放行后请求仍被旧 backend 拒收——普通请求落 daemon 侧 5 分钟 fallback deny，**后台 dialog 请求因本变更也启用了 5 分钟 fallback**（修正前是无界挂起，本变更后任何组合下最坏 5 分钟有界 deny，均不劣于现状）。
- **部署顺序：backend 先行或同时**（新 backend 对旧 daemon 零影响；新 daemon 的完整收益需新 backend 配合）。
- 不改变的 API/表结构：REST 端点、`session_dialog_requests`、`agent_runs` 列均不变。
- 既有 fail-soft 测试：拒收路径现在多一步 deny 下行（best-effort），相关测试 mock hub 后改断言。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 注册表泄漏（task_notification 永不到达）→ 锚点永不清 → 守卫放行窗变长 | P1 | 放行的只是「通道存在性」，写策略（allowed_roots/policyEngine）与人审链路全程生效；下一次 inject 正常切新 run；会话终态 `clearBackgroundTasks` 兜底清锚点。现状（stale-flip 60min 宽限窗）已有同类时间界更宽的先例 |
| R-02 | 即时 deny 推送与用户真实答题竞态（deny 后用户又答了） | P2 | deny 只 settle daemon 侧 pending；backend dialog 行此时不存在（校验失败根本没落行），无竞态面。已落行后的人工答题路径不变 |
| R-03 | `background_task` 标记被滥用（daemon 侧误标）扩大受理面 | P2 | 受理放宽仅绕过「active-turn + run 匹配」一项，run 归属校验仍在；标记只在 `status≠running && 注册表非空` 时置位，主轮进行中恒 false；4 处注入点共用单一 `backgroundTaskFlag` 辅助防漂移 |
| R-04 | USAGE_NOTE 日志行混入日志流干扰前端渲染/解析 | P2 | 复用既有 `[TASK_PROGRESS]`/`[TASK_NOTIFICATION]` 同款 stdout 行协议，前端按既有文本行渲染，无需适配 |
| R-05 | 既有 permission fail-soft 测试语义变化 | P1 | Wave 3 同步改断言（拒收时断言 hub 收到 deny payload），行为变化是设计目标本身 |
| R-06 | daemon 自更新在后台任务存活期照常放行重启（`hasRunningTurn` 忙屏障不查注册表，lifecycle.ts:375-381）→ 重启杀后台任务 | P2 | 现状既有行为、非本变更回归；锚点态 `status=active` 本就不算「running turn」，忙屏障语义未变。留待后续变更评估「注册表非空时推迟自更新」 |
| R-07 | 锚点使 provider/config switch 空闲判定（session-manager.ts:1553/1671）推迟到下轮边界 | P2 | 方向保守（切换等待更久不误切）；turn 边界可达（下轮 inject/收尾即消；注册表泄漏时由 R-01 兜底路径收敛） |
| R-08 | 后台 dialog 受理后（落 pending 行且 backend 不 arm timer）daemon 5min fallback 单方 settle 不通知 backend → 用户 5min 后作答被 `unknown_request` 静默丢 + 问答卡成僵尸（dialog 无 permission_resolved 撤卡链路） | P2 | Grill 复核提出、非阻断：该竞态需「后台 dialog 受理 + 用户恰好 5min 后作答」双条件，窗口窄且本变更前同类 dialog 根本到不了用户；修法（daemon fallback settle 时同步上行 cancel/timeout 事件）留后续变更，先在 backend dialog 应答路径对已 unknown 的作答返回明确 409 文案（复用既有先到先得 409） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 总体方案 Wave 1/2 全部（FR-01~FR-04）；锚点机制=events.ts+background-tasks.ts；协议标记=permission.ts 4 处可达注入+permission-resolver.ts+protocol.py | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale）
- [x] 引用所有当前版本 D-xxx@vN（D-001@v1，无遗留）
- [x] 生命周期关键词触发→含「生命周期契约表」（4 事件，均有对应代码/测试任务）
- [x] UI 原型分级：跳过（纯 daemon/backend 逻辑，无界面变化）——依据 brainstorm Step 5 已向用户声明并确认
- [x] Design Grill 独立审查（agent-tool 通道）两个阻断项已修正：①`backgroundTask` 注入点从 2 处扩为**全部 5 处 register 调用点**（默认普通审批路径是 Claude 后台子代理实际主路径）；②后台 dialog 请求启用 5 分钟有界兜底（修正「不劣于现状」论证——原设计在新 daemon+旧 backend 组合下会无界挂起）。5 项非阻断意见全部吸收（session-manager.ts 访问器入清单、current_run 校验块整体替换、switch 空闲判定入风险 R-07、自更新留 R-06、deny payload 带 runtime_id）
