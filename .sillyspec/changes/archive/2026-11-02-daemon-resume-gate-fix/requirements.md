---
author: flow-machine-draft
created_at: 2026-11-02T02:07:22.613Z
---
# 需求规格（Requirements）— 2026-11-02-daemon-resume-gate-fix

## 功能需求

### FR-01: daemon reopen/恢复路径不再把 lastActiveAt 刷新为当下：存在本地持久化记录时保留原值；恢复风暴后 30 分钟内新建会话不再被会话闸拒绝

- daemon 收 backend SESSION_RESUME（reopen）构造恢复记录时，`lastActiveAt` **必须**按「payload 显式值 → 本地 sessions.json 持久化记录原值 → Date.now() 兜底」三级取值，**禁止**无条件写 `Date.now()`；恢复行为本身**不得**被视为「用户活动」去续命会话闸的 30 分钟活跃窗口与 7 天超龄判定。
- 会话闸计数（session-manager create 前置闸）对仅被恢复、未发生真实轮活动的会话**不得**计入「30 分钟内活跃」；断网恢复风暴（全量 SESSION_RESUME）后 30 分钟内的新建会话**必须**正常创建，不被 `SESSION_LIMIT_REACHED` 拒绝。
- 为保 idled 回收（`SESSION_IDLE_TIMEOUT_SEC>0` 部署形态）不因保留旧时间戳而把恢复会话误判「立即超时」，恢复路径**必须**记录恢复时刻（`restoredAt`，仅内存态），idle 扫描的空闲时长**必须**从「恢复时刻与 lastActiveAt 的较大者」起算。

#### 场景：恢复风暴不占闸额度

Given daemon 本地 sessions.json 有 46 条非终态恢复记录（lastActiveAt 为各自真实历史值），backend 一拍全量下发 SESSION_RESUME
When daemon 逐条完成 reopen 恢复后，用户立即新建会话
Then 每条恢复记录的 lastActiveAt 保留其持久化原值（不等于恢复时刻），会话闸活跃计数 < 上限，新会话正常创建

#### 场景：无本地记录时维持现状兜底

Given daemon 本地无该会话的持久化记录（跨机移交 / 记录超龄清除）且 payload 未带 last_active_at
When SESSION_RESUME 到达
Then record.lastActiveAt 取 Date.now()（维持现行兜底行为，单点 reopen 不足以顶满闸）

#### 场景：idle 扫描不从历史时间戳起算误杀

Given SESSION_IDLE_TIMEOUT_SEC>0 且某会话经 reopen 恢复（保留的 lastActiveAt 为 8 天前）
When idle 扫描在恢复后立即运行
Then 空闲时长自 restoredAt（恢复时刻）起算，该会话不被立即回收

### FR-02: SESSION_SWITCH_CONFIG 到达但目标会话不在 daemon store 且 payload 带 run_id 时，回报该 run 失败（对齐 INJECT 丢弃回报语义），run 秒级收敛而非等 300 秒清扫

- daemon `_routeSessionSwitchConfig` 在目标会话不存在（store 未命中）或 `markPendingConfigSwitch` 抛 SessionNotFoundError 时，若 payload 可解析出 run_id/lease_id/claim_token 三要素，**必须**调 `notifyRunResult(status=error_during_execution, is_error=true)` 回报该 run 失败并附可读原因（对齐 `_reportInjectDropped` 先例）；回报失败仅 warn 不阻塞。三要素不全（旧 backend payload）**可以**维持仅 warn 现状。
- backend 切换轮下发 payload **必须**携带 `leaseId`（会话当前 lease），使 daemon 回报具备寻址要素；未带 leaseId 的旧 payload 走降级路径不报错。

#### 场景：会话不存在秒级收敛

Given daemon store 无目标会话（创建阶段已失败，本机 11-02 09:08 实证形态）
When SESSION_SWITCH_CONFIG（含 run_id/lease_id/claim_token）到达
Then daemon 回报该 run 失败，后端 run 终态在秒级落库（error_code=interactive_interrupted），不再等待 300 秒 pending 清扫

#### 场景：旧 payload 降级不报错

Given SESSION_SWITCH_CONFIG payload 缺 lease_id（旧 backend）
When 目标会话不存在
Then 维持仅 warn 丢弃现状，不调用回报（要素不全无法寻址），无异常抛出

### FR-03: 两处行为均有自动化测试覆盖

- FR-01 与 FR-02 的行为**必须**各有 vitest 自动化用例覆盖（恢复保留时间戳 + 丢弃回报调用），并纳入既有测试文件或就近新建；daemon typecheck **必须**零错误，相关测试文件全绿。

#### 场景：主路径

Given 本变更触达的 sillyhub-daemon 源码与 backend control.py
When 运行 daemon vitest 全量与 backend 触达面 pytest
Then 新增用例通过、存量用例零回归、typecheck 零错误

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/daemon-session-resume-route.test.ts「本地持久化记录存在 → record.lastActiveAt 保留原值（恢复不续命）」
FR-02: sillyhub-daemon/tests/daemon-session-switch-config.test.ts「store 无目标会话且三要素齐全 → notifyRunResult 回报 run 失败」
FR-03: 不适用：单一 it 用例——本条为过程性回归验收，由 ledger 收口实测（daemon vitest 5220 过/tsc 零错/backend 28 过/ruff 零告警）与评审变更面复跑兑现
