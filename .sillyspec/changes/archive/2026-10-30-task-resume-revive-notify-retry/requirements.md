---
author: flow-machine-draft
created_at: 2026-10-29T23:20:12.378Z
---
# 需求规格（Requirements）— 2026-10-30-task-resume-revive-notify-retry

## 功能需求

### FR-01: daemon 对「已终态注销后再收到同 task_id 的 running 帧」打 resumed=true 标记上报

- daemon 会话任务注册表注销某 task_id（task_notification 终态处理）时，必须把该 task_id 登记进同生命周期的「已终态集合」；此后同会话再收到该 task_id 的 running 帧（task_started/task_progress 懒注册路径）时，必须在该次 emit 的 agent_task_status 事件 metadata 携带 `resumed: true` 并经既有 onSessionEvent 桥上报平台；打标为一次性（首帧带标后从集合移除，后续同任务 running 帧不带标），集合随 `_clearBackgroundTasks` 一并清空。

#### 场景：主路径（续唤重跑首帧打标）

- Given 任务 ad80ad96 已经 task_notification 终态注销并落入已终态集合
- When SDK 因主代理续唤重发该 task_id 的 running 帧（task_started 形态）
- Then daemon emit 的 agent_task_status 事件 metadata 含 `resumed: true`，且集合中移除该 task_id；紧随其后的第二帧 running 不再带标

#### 场景：注册表内普通 running 不打标

- Given 任务仍在注册表（未终态注销）
- When task_progress running 帧到达
- Then emit 事件不带 resumed 键（保持既有载荷形状）

#### 场景：会话清理不残留

- Given 会话后台任务注册表被清空（会话终态 `_clearBackgroundTasks`）
- Then 已终态集合同步清空，跨会话/新周期不误标

### FR-02: backend AgentTaskStatusEvent 增可选 resumed 字段；upsert 终态行仅 resumed=true 放行复活

- `AgentTaskStatusEvent`（backend/app/modules/daemon/schema.py）必须增可选字段 `resumed: bool | None = None`（alias 驱动透传进 SSE payload）；`upsert_agent_task`（agent_task_store.py）语义②扩展——终态行收 running 事件时，`event.resumed is True` 必须放行复活（status 回 running、finished_at 清 None、message 清 None，started_at 保持首插值），无标记必须维持整行吸收；既有清扫 stopped 行（message=RUN_CLOSE_SWEEP_REASON）复活分支行为必须零变化。DB 不加列（resumed 是瞬态复活信号，非存储态）。

#### 场景：completed 行 + resumed running → 复活

- Given agent_session_task 行 status=completed、finished_at 非空
- When 收到同 (session_id, task_id) 的 running 事件且 resumed=true
- Then 行翻 status=running、finished_at=None、message=None、updated_at 刷新；started_at 不变

#### 场景：completed 行 + 无标记 running → 吸收（迟到心跳防线保持）

- Given 同上行
- When 收到 running 事件且 resumed 缺省（None）
- Then 整行跳过（不写、不 commit、不刷新 updated_at）——语义②原行为

#### 场景：清扫 stopped 行复活分支零回归

- Given 行 status=stopped、message=RUN_CLOSE_SWEEP_REASON
- When 收到 running 事件（无论 resumed）
- Then 维持既有复活行为（复活自愈口径不变）

### FR-03: 前端 SSE 类型与归约放行 resumed 复活

- 前端 `AgentTaskStatusEvent`（frontend/src/lib/daemon/session-sse.ts）必须增 `resumed?: boolean | null`；`applyAgentTaskStatusEvent`（frontend/src/components/daemon/agent-task-store.ts）终态定格分支必须加 resumed 豁免——`resumed === true` 的 running 事件必须翻回运行中（status=running、terminalAt 清 null），无标记的 running 事件维持定格忽略；startedAt 保留旧值（同一任务实例跨续唤周期）。

#### 场景：已定格卡片 + resumed running → 翻回运行中

- Given 前端任务卡片 status=completed（terminalAt 已记）
- When 收到 running 事件且 resumed=true
- Then 卡片 status=running、terminalAt=null、lastActivityAt 推进

#### 场景：已定格卡片 + 无标记 running → 维持定格

- Given 同上卡片
- When 收到 running 事件且 resumed 缺省
- Then 归约原样退回旧行（列表不动）——既有语义

### FR-04: daemon agent-task-status 上报失败有限重试

- cli.ts onSessionEvent 桥的 `agent_task_status` 分支必须对上报失败加有限重试：仅 5xx（HubHttpError statusCode ≥ 500，含实测 502）与网络错误触发，最多 3 次额外尝试、退避间隔 1s/4s/16s；4xx 与其它错误不得重试（语义错误重试无益）；重试耗尽仍失败维持既有 console.error 落日志（不阻塞不抛出）。重试安全性依据 upsert 幂等（running latest-wins / 终态重放刷 finished_at 均无害）。重试逻辑必须可单测（纯判定/调度函数或可注入 clock）。

#### 场景：502 三连后成功

- Given notifyAgentTaskStatus 前两次抛 HubHttpError(502)、第三次成功
- Then 共调用 3 次、无 console.error、事件最终落库

#### 场景：4xx 不重试

- Given 首次抛 HubHttpError(422)
- Then 仅调用 1 次、直接走 console.error 落日志

#### 场景：重试耗尽

- Given 4 次尝试全部抛网络错误
- Then console.error 一次（含最后一次错误）、事件丢弃不阻塞主链路

### FR-05: schema 改动双端 gen:types 同步

- backend schema 加字段后，必须在同一变更内跑 `pnpm gen:types`（frontend）与 `pnpm -C sillyhub-daemon gen:types` 并提交 `frontend/src/lib/api-types.ts` + `sillyhub-daemon/src/api-types.ts` + `backend/openapi.json`（CLAUDE.md 规则 21 / 断言面闸门⑨）。

#### 场景：三产物同步提交

- Given AgentTaskStatusEvent 加 resumed 字段落码
- Then openapi.json、frontend api-types.ts、daemon api-types.ts 三产物 diff 均含该字段且与本变更代码同 commit 族提交

### FR-06: 三侧新增单测通过且既有相关测试零回归

- daemon/backend/frontend 三侧新增用例必须通过；触及文件的既有相关测试（task-lifecycle / test_agent_session_tasks / agent-task-store 族）必须零回归；禁止跑全量测试（仅跑相关，全量留给 CI）。

#### 场景：验收口径

- Given 三侧实现落码
- Then daemon task-lifecycle 相关用例绿、backend test_agent_session_tasks.py 绿、frontend agent-task-store 相关测试绿

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「续唤复活打标（2026-10-30-task-resume-revive-notify-retry）——重开首帧打标/一次性/二周期循环/updated 轻量路径」
FR-02: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_resumed_running_revives_terminal_row / test_resumed_false_explicit_still_absorbed + 既有吸收与清扫复活零回归」；backend/app/modules/daemon/tests/test_agent_task_status_payload.py「test_resumed_flag_published_true + 键集含 resumed」
FR-03: frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx「续唤复活：resumed running 翻回运行中（terminalAt 清空、startedAt 保留）/ 续唤复活防线：缺省与 false 维持定格」
FR-04: sillyhub-daemon/tests/agent-task-notify-retry.test.ts「isRetryable 判定（5xx 可重试/4xx 不可）/ 502 两连后成功退避序列 / 4xx 单次即抛 / 重试耗尽抛最后一次 / 首次成功零退避」
FR-05: 不适用：生成物同步义务，由 daemon-ci 断言面闸门⑨与 CI 兜底（非测试用例覆盖面）
FR-06: 不适用：验收汇总条——三侧用例即 FR-01~04 绑定文件的执行结果
