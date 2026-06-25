---
author: qinyi
created_at: 2026-06-25T15:30:00
---

# 设计：interactive session idle timeout 误杀长 turn（scan 场景）

## 背景

scan 场景下，agent 在单个 `claude -p` 调用内用 Bash 反复跑 `sillyspec run scan --done` 推进 10 步，持续约 30 分钟不回 turn result。daemon 把这种"单次长 turn"误判为空闲 session，在 30 分钟 idle 阈值到期时 `_onIdleExpire` → interrupt + end，强制 kill claude 进程。前端表现为 `[Request interrupted by user]`，但用户并未中断。

实测案例：`agent-run-812ebea3.log`，scan 14:13:27（本地）开始，14:43:38（+30 分 11 秒）被杀，撞 `default idleTimeoutSec=1800`。scan 产出本身完整（step10 在 14:41:41 落盘），被砍的只是收尾汇报文字。

### 双层根因（诊断证据）

**根因 1（daemon 治标层）**：`session-manager.ts` 的 idle 回调用 `lastActiveAt` 判断空闲，但 `lastActiveAt` 只在 4 处更新：session 创建（544）、inject 新 turn（1092）、interrupt（1137）、`_onResult`（1590）。turn 进行中持续吐的 assistant message / tool_use / tool_result / thinking delta（走 `_onMessage` 回调，996）全部不更新 `lastActiveAt`。于是单 turn 跑 30 分钟的长任务，`lastActiveAt` 停在首条 inject 时刻，被 `_scanIdle`（1239）误判空闲。

**根因 2（backend 治本层，真正缺口）**：scan 完成时 `complete_lease`（`lease/service.py:278`）收尾链——标 lease completed → 更新 AgentRun → Redis 发布 → patch 应用 → stage 回调 → post_scan 校验——**唯独不调 `end_session`**。`run_sync/service.py:492/505` 注释明示 scan 的完成走 daemon `_onResult` → `notifyRunResult` → backend run_sync，但 backend 收到后无反向 `end_session`。`placement.py:505` / `lease/service.py:182` 注释也写明"interactive lease 永不过期，生命周期由 end_session 管"——但 `end_session` 当前只被 `router.py:1089` 用户手动 HTTP 端点调用，无自动完成路径。结果：scan 完成后 daemon session 残留 active，claude 进程常驻等 stdin（`--input-format stream-json` 模式不主动退出），最终撞 idle 回收。

## 设计目标

1. scan/stage 完成时主动关闭 daemon session，claude 进程及时退出，不撞任何超时
2. 移除 idle 自动回收对"工作中长 turn"的误杀风险
3. 多轮对话仍由用户手动结束（现有链路不变）
4. 不引入绝对上限 / 新增自动超时机制

## 非目标

- **不**实现前端"守护进程运行列表超时计时器单独配置"UI 入口（用户提到的关联需求）——idle 已默认禁用无配置需求，UI 配置单独立变更
- **不**保留 idle 活动判定修复（原治标方案三）——双修方案下 idle 整体禁用，活动判定无意义
- **不**处理"agent hang 死不完成 + 用户断网"的极端泄漏场景——容忍，靠用户下次手动清理
- **不**改 claude `-p` 的 stream-json 常驻语义（SillyHub 多轮复用的基础）

## 拆分判断

单一后端逻辑修复，涉及 daemon + backend 两端各 1 个核心文件 + 单测。无需拆分子变更，不走批量模式。两端改动通过现有 facade + FR-05 机制解耦，可独立实现与测试。

## 总体方案

### Phase 1（daemon 侧）：移除 idle 自动回收 — D-001@v1

**文件**：`sillyhub-daemon/src/interactive/session-manager.ts`

- `_idleTimer`（setInterval，1194）**默认不启动**。`startIdleMonitor()`（1188）增加守卫：仅当 `_idleTimeoutSec > 0` 才创建定时器。
- `_idleTimeoutSec` 默认值由 `1800`（DEFAULT_IDLE_TIMEOUT_SEC，182）改为 `0`（禁用）。env `SESSION_IDLE_TIMEOUT_SEC` 解析逻辑（259-265）保留：显式设正值仍可启用（逃生口，用于极端运维场景）；`0` / 负值 / 非法值 → 禁用。
- `_scanIdle()`（1239）保留逻辑但定时器不启动则永不触发；`_onIdleExpire()`（1268）逻辑保留（手动 end / interrupt 兜底仍复用 `end()`，只是不再被 idle 自动调用）。
- session 终态收敛完全靠：backend 主动 `session_end`（Phase 2）+ 用户手动 end（FR-05）+ interrupt（FR-04）。

**逃生口语义**：env `SESSION_IDLE_TIMEOUT_SEC=1800` 可恢复旧行为，便于线上回滚或特殊场景兜底。默认禁用对齐用户"不要自动超时"决策。

### Phase 2（backend 侧）：scan/stage 完成主动 end_session — D-002@v1

**文件**：`backend/app/modules/daemon/lease/service.py`（`complete_lease`，278）

在 `complete_lease` 收尾链末尾（post_scan 校验之后，`daemon_lease_completed` 日志之前），增加完成收尾钩子：

- 判定需主动 end 的 lease：
  - **scan run**：`agent_run.change_id is None` 且 `agent_run.spec_strategy == "platform-managed"`
  - **stage run**：`agent_run.change_id is not None`（stage dispatch 完成后 session 无后续用途）
  - 排除多轮对话（非 platform-managed 的 interactive session）——留给用户手动
- 取 lease 关联 agent_run 的 `agent_session_id`（`AgentRun.agent_session_id` 字段，`model.py:195`，interactive lease 完成时已由 run_sync 写入）。注：lease metadata 里的是 `session_id`（interactive dispatch 写入，`context.py:64`），与 agent_run.agent_session_id 同源；complete_lease 阶段 agent_run 已加载，直接读字段更可靠。
- 若存在 → 经 facade 反向委托调 `DaemonService.end_session(agent_session_id, reason="task_completed")`。
- 失败不阻塞 lease 完成（try/except + warn log，对齐现有 stage_callback / post_scan 容错）。

`end_session` 内部链路（已有，不改）：`ws_hub.send_session_control(session_end)` → daemon 收 `DAEMON_MSG_SESSION_END`（FR-05）→ `SessionManager.end()` → close InputQueue → claude 进程退出。

### Phase 3：跨域调用路径 — D-002@v1 落地

`complete_lease` 在 lease 子域，`end_session` 在 daemon session 子域（`session/service.py`）。跨域走现有 D-006@v1 facade 反向委托模式（与 `_run_post_scan_validation` / `_trigger_stage_completion_callback` 同模式）：lease 子域经 `self._facade._end_session_for_completed_lease(...)` 调用 session 子域的 end 逻辑。

### Phase 4：边界与不做 — D-003@v1

- 不引入绝对上限 / 新超时机制。
- 断网 + hang 极端泄漏容忍：claude 进程可能常驻到用户下次手动清理。
- 前端 UI 配置入口拆出（本变更不做）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/interactive/session-manager.ts` | `_idleTimer` 默认不启动；`DEFAULT_IDLE_TIMEOUT_SEC` 改 0；`startIdleMonitor` 增 `>0` 守卫 |
| 修改 | `backend/app/modules/daemon/lease/service.py` | `complete_lease` 收尾链末尾增 scan/stage 完成主动 end_session 钩子 |
| 新增 | `sillyhub-daemon/src/interactive/__tests__/session-manager-idle-disabled.test.ts` | idle 定时器默认不启动 + env 逃生口 + 长 turn 不杀 |
| 修改 | `backend/app/modules/daemon/tests/test_lease_service.py` | scan/stage 完成 → end_session 调用断言；多轮对话不自动 end |
| 修改 | `.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md` | idle 回收默认禁用 + 完成驱动 end 契约更新（scan 同步模块文档） |

## 接口定义

### daemon 侧（session-manager.ts）

```typescript
// DEFAULT_IDLE_TIMEOUT_SEC：1800 → 0（禁用）
const DEFAULT_IDLE_TIMEOUT_SEC = 0;

// startIdleMonitor 增守卫
private startIdleMonitor(): void {
  if (this._idleTimer) return;
  if (this._idleTimeoutSec <= 0) return;  // 新增：禁用守卫
  this._idleTimer = setInterval(() => { void this._scanIdle(); }, this._idleScanMs);
  // ...
}
```

### backend 侧（lease/service.py）

```python
# complete_lease 收尾链末尾（post_scan 校验后）
if lease.agent_run_id is not None:
    try:
        agent_run = await self._session.get(AgentRun, lease.agent_run_id)
        # scan run（change_id=None + platform-managed）或 stage run（change_id 非空）
        # 主动 end daemon interactive session
        should_end = (
            agent_run is not None
            and (
                agent_run.change_id is not None  # stage
                or getattr(agent_run, "spec_strategy", None) == "platform-managed"  # scan
            )
        )
        if should_end:
            agent_session_id = agent_run.agent_session_id if agent_run else None
            if agent_session_id:
                await self._facade._end_session_for_completed_lease(
                    agent_session_id=str(agent_session_id),
                    reason="task_completed",
                )
    except Exception as exc:
        log.warning(
            "complete_lease_end_session_failed",
            lease_id=str(lease_id),
            agent_run_id=str(lease.agent_run_id),
            error=str(exc),
        )
```

## 生命周期契约表

本次变更涉及 session / lease / agent_run / daemon / lifecycle / complete / end / claim 关键词，契约表如下：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| claim lease | daemon | backend | leaseId, claimToken, agentRunId | lease pending → claimed |
| create session | backend | daemon | sessionId, leaseId, claimToken, kind=interactive | session active |
| inject message | backend → daemon | claude | sessionId, runId, prompt | session active → running |
| turn result | claude → daemon | backend（notifyRunResult） | runId, status, output | session running → active；AgentRun → completed |
| **complete_lease（lease 收尾）** | daemon | backend | leaseId, claimToken, result | lease claimed → completed；AgentRun → completed |
| **session end（完成驱动，新增）** | backend（complete_lease 钩子） | daemon | agent_session_id（取自 AgentRun.agent_session_id）, reason=task_completed | daemon session active → ended；claude 进程退出 |
| session end（用户手动，现有） | frontend → backend | daemon | sessionId, reason=manual | session active → ended |
| session interrupt（现有） | frontend → backend | daemon | sessionId | turn 中断，session 保持 |

**本次新增事件**：`session end（完成驱动）`——backend 在 `complete_lease` 收尾时主动发起，区别于现有用户手动 end。两条路径在 daemon 侧收敛到同一 `SessionManager.end()`。

**关键契约**：
- `complete_lease` 必须能取到 `agent_session_id`（`AgentRun.agent_session_id` 字段），否则跳过主动 end（warn log，不阻塞）
- daemon 侧 `end()` 幂等（已 ended/failed 直接返回），完成驱动 end 与用户手动 end 竞态安全

## 数据模型

无表结构变更。`agent_session_id` 已存在于 lease metadata（interactive lease 创建时写入）和 `AgentRun.session_id` 字段。

## 兼容策略（brownfield）

1. **未配置 env 时行为**：idle 定时器默认不启动（新默认值 0）。旧行为可通过 `SESSION_IDLE_TIMEOUT_SEC=1800` 恢复。
2. **回退路径**：
   - daemon 侧：env `SESSION_IDLE_TIMEOUT_SEC>0` 即恢复 idle 自动回收
   - backend 侧：完成驱动 end 失败仅 warn log，不影响 lease 完成语义（与现有容错一致）
3. **不变的 API / 表结构**：`end_session` HTTP 端点、FR-05 `session_end` 协议消息、SessionManager.end 签名均不变。
4. **存量 session**：升级时正在跑的 session 不受影响（idle 定时器下次启动周期才检查；完成驱动 end 只对新完成的 lease 生效）。
5. **幂等保证**：daemon `end()` 对已终态 session no-op；backend 重复调 end_session 由 daemon 侧幂等兜底。

## 风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| idle 禁用后，断网 + agent hang 的 session 永不回收 | 中 | 容忍（用户决策 D-003）；env 逃生口可针对性启用 |
| `complete_lease` 取不到 `agent_session_id` → 主动 end 跳过 | 低 | warn log 留痕；该 session 退化为手动 end（不阻塞 lease 完成） |
| 完成驱动 end 与用户手动 end 竞态 | 低 | daemon `end()` 幂等（已 ended no-op） |
| stage run 主动 end 误伤"多 stage 复用同一 session"场景 | 已消除 | 代码确认 stage 每步独立 session（`change/service.py:1358` 注释 "independent session"），不存在复用，stage 完成主动 end 安全 |
| idle 定时器禁用后，遗漏的 session leak 检测能力下降 | 低 | daemon 日志保留 session 创建/结束记录，可运维排查 |

## 自审

### 章节完整性
- ✅ 背景（含双层根因诊断证据）
- ✅ 设计目标 / 非目标
- ✅ 拆分判断
- ✅ 总体方案（4 Phase，覆盖 D-001@v1 / D-002@v1 / D-003@v1）
- ✅ 文件变更清单（2 改 + 1 新增测试 + 1 改测试 + 1 文档）
- ✅ 接口定义（daemon TS + backend Python 签名）
- ✅ 生命周期契约表（7 事件，含新增"完成驱动 session end"）
- ✅ 数据模型（无变更）
- ✅ 兼容策略（env 逃生口 + 幂等 + 回退路径）
- ✅ 风险登记（含 stage 复用 session 风险消除）

### 一致性检查
- D-001@v1（idle 禁用）→ FR-1/FR-2 → task-daemon-idle-disable/test ✓
- D-002@v1（完成主动 end）→ FR-3/FR-4/FR-5/FR-6 → task-backend-complete-lease-end/facade-end/test ✓
- D-003@v1（不加绝对上限）→ FR-7 手动链路不变 + 非目标 ✓
- `agent_session_id` 取值源统一为 `AgentRun.agent_session_id` 字段（接口定义 / 契约表 / 兼容策略三处一致）✓

### 可行性检查
- daemon `end()` 幂等：已存在（`session-manager.ts:1289` 已 ended/failed no-op）✓
- FR-05 `session_end` 链路：已存在（`session/service.py:765` send_session_control）✓
- D-006 facade 跨域委托模式：已存在（`_run_post_scan_validation` / `_trigger_stage_completion_callback` 同模式）✓
- stage 独立 session：代码确认（`change/service.py:1358` independent session）✓

