---
author: flow-machine-draft
created_at: 2026-10-13T16:27:30.288Z
---
# 设计记录（Design Record）— 2026-10-14-ci-red-batch-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

main 最新 push（4347239）后三流水线共 5 处红，逐一考古后确认全部是测试债/类型债而非生产 bug，故本变更零生产代码改动，四处分别对齐既有契约：

1. `test_mission_session_id.py::test_agent_sessions_model_fields_unchanged` 字段钉子停在 `engine_fork_anchor`（35 字段），漏同步 2026-10-12-run-level-change-attribution 有意新增的 `current_change_id`（姊妹守卫已由 11c4a5d51 同步，本守卫漏更）——expected 补列并同步 docstring 口径。
2. daemon 两个用例（gate_failover / session_events_cross）的 seed 仍把 change_id 只落在 `AgentRun` 上构造"单轮任务"，而 2fe772561（2026-10-13-multiturn-changeid-misjudge，生产会话 47e2ff1a 三次误关事故驱动）已把多轮/单轮判定锚换成会话级 `session.change_id`——seed 对齐新契约：gate helper 在 change_id 非 None 时同落 session；cross helper 增可选参 `session_change_id`（默认 None，现有调用零影响）。实现侧 `_apply_session_terminal_status` 是正确契约，一行不动（规则 9：非测试逻辑无误，禁止改实现迁就测试）。
3. `sillyhub-daemon/src/api-types.ts` 落后后端 OpenAPI（daemon-log-config-view 机器日志/配置端点已合入后端）——`pnpm gen:types` 重生成。
4. `agent-replay-body.test.tsx` 首用例 waitFor 只等 mock 被调用，CI 慢机并行下 React 渲染滞后一拍即挂——mock 调用等待后追加渲染完成锚 waitFor（`turn-timeline-scroll` 挂载 ⇔ messages 渲染完成，"累计 in…" 同源数据必然就位）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

生产接口/端点/命令/文件格式：无变化。

测试内部辅助函数（对外不可见）：
- `test_run_sync_session_gate_failover.py::_seed_gate_shape`：签名不变，行为增强——`change_id` 非 None 时同步写入 `session.change_id`（缺省 None 用例零影响）。
- `test_session_events_cross.py::_seed_interactive_run`：新增可选关键字参数 `session_change_id: uuid.UUID | None = None`，写入 `AgentSession.change_id`；现有调用点零影响。
- `sillyhub-daemon/src/api-types.ts`：生成物重生成，内容随 gen-api-types.mjs 从后端 OpenAPI 产出。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：正是 FR-03 的病灶——mock resolve 与 React 提交渲染可跨拍（CI 359 文件并行慢机放大窗口）。修法用渲染锚 waitFor 轮询至 `turn-timeline-scroll` 出现，迟到渲染不再击穿断言；pytest 侧 seed 在 `db_session.commit()` 后才返回，无乱序面。
2. 并发写：两个测试文件改动互不相交（gate_failover / session_events_cross / mission_session_id 各自独立）；api-types.ts 单写者（gen 脚本）单次重生成，无并发面。
3. 切换/生命周期：daemon 两用例仍完整覆盖"单轮 completed → ended + status_changed"生命周期断言（ended_at、发布恰好一条）；同文件多轮 keep-active 用例走缺省参数，判定锚行为不变，覆盖面不缩。
4. 作用域：api-types.ts 属 sillyhub-daemon 仓内生成物；frontend 的 `src/lib/api-types.ts` 不在本次面（frontend-ci typecheck 已绿，前端类型未过期），两仓类型互不串台。测试 seed 改动限定单会话单 run 形态，无跨工作区数据。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：seed 把 change_id 落 session 后误伤同文件其他用例。已核对调用面——gate_failover 仅一处调用传 `change_id=uuid.uuid4()`（即本次修复对象），其余缺省 None；cross 文件新参默认 None，多轮用例（run.change_id=None）判定路径不变；修复后已跑全文件用例验证。

试过但放弃的方案：
- 放宽 `_apply_session_terminal_status` 兼容 run 级锚——否决：会复活 2fe772561 修复的生产误关会话事故（聊天轮被打轮级归因锚后每轮 completed 即误置 ended），方向性错误。
- CI 侧给 frontend vitest 加重试——否决：掩盖时序缺陷而非修复，且 CI 改动属生产配置，违背本变更零生产改动约束。
- 守卫测试直接删除字段集断言——否决：钉子测试的价值就在逐字段显式清单，补列即可。
