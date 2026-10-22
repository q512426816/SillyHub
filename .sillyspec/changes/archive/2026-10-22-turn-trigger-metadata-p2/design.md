---
author: flow-machine-draft
created_at: 2026-10-22T04:34:10.397Z
---
# 设计记录（Design Record）— 2026-10-22-turn-trigger-metadata-p2

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：沿用平台既有溯源管道（群聊 turn_metadata → user_input 日志 metadata_ 列的 2026-09-01 先例），把轮触发溯源从前端内容前缀升级为服务端盖戳。后端四处：①inject.py `_inject_into_session` 新增 `turn_trigger: str | None = None` 参数并在 user_input 落库处合并盖戳（task_wakeup=True → 'task_wakeup'、auto_resume_of → 'auto_resume'、显式 turn_trigger 参数直通；合并序 = 群聊 chain_metadata 打底、trigger 键覆盖，单键不冲突）；②queue.py `_handle_busy_turn` 新增 turn_trigger 参数落排队行 origin='schedule'（task_wakeup/auto_resume 既有 origin 优先级不变）；③queue.py `dispatch_queued_messages` 回放处经新 helper `queue_origin_to_trigger`（helpers.py，task_wakeup/schedule 精确匹配 + auto_resume: 前缀）把行 origin 翻译为 turn_trigger 合入回放 turn_metadata；④scheduled_send.py 直注调用带 turn_trigger='schedule'。前端两处：TurnTriggerKind 增 'schedule'（META ⏰/定时消息到点/正文可见标注行）；classifyTurnTrigger 签名扩展 `(content, metadata?)`——metadata.turn_trigger 有效值直接采信，缺失/无效回退内容前缀（存量零回归）；回放/live 两装配点透传日志行 metadata。

选日志行 metadata 而非 run metadata：turn 与 user_input 行一一对应且前端时间线装配以日志行为输入（run metadata 需跨 API 关联），日志行 metadata_ 列已贯通前端（群聊发言者还原在用）；选排队行 origin 复用而非新列：origin 列已有三值语义（task_wakeup/auto_resume:/NULL），'schedule' 为同族服务凭证标记，/router 门控沿 task_wakeup 先例仅服务凭证可写（Phase 2 内 scheduled_send 即服务身份，浏览器不可达）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：
- backend `_inject_into_session`/`inject_session`/`inject_session_as_service`（inject.py）：新增可选尾参 `turn_trigger: str | None = None`（缺省 None 零回归）；user_input 行 metadata_ 在 turn_metadata 基础上合并 `{"turn_trigger": <值>}`。
- backend `_handle_busy_turn`（queue.py）：新增可选参数 `turn_trigger`，排队行 origin 派生序 = task_wakeup 参数 > auto_resume_of > turn_trigger > None。
- backend `dispatch_queued_messages`（queue.py）：回放 turn_metadata 合并 `queue_origin_to_trigger(entry.origin)` 戳。
- backend `helpers.py`：新增导出 `SCHEDULE_QUEUE_ORIGIN = "schedule"` 与 `queue_origin_to_trigger(origin)`。
- backend `scheduled_send.py`：inject_session_as_service 调用加 `turn_trigger="schedule"`。
- frontend `session-log-assembler.ts`：`TurnTriggerKind` 增 "schedule"；`TURN_TRIGGER_META.schedule = {glyph:"⏰", label:"定时消息到点", contentHidden:false}`；`classifyTurnTrigger(content, metadata?)` 签名扩展（第二参可选，缺省行为同 Phase 1）。
- API/DB schema：零迁移（复用 AgentRunLog.metadata_ JSON 列与 AgentSessionQueuedMessage.origin 列既有面）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。盖戳发生在派发事务内（行锁持有点），回放盖戳从排队行 origin 推导（行数据随条目持久化，无乱序面）；前端 metadata 优先判定是渲染期纯函数，戳与前缀同时存在时戳胜出（确定性序）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：无新并发面——盖戳复用既有派发事务写入点（群聊 turn_metadata 同点位先例）；排队行 origin 写入在 _handle_busy_turn 既有 INSERT 内；前端纯展示。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。纯切换轮（silent_config_switch）不落 user_input 行（既有跳过），无戳可盖；排队条目 failed 留队重试时回放盖戳幂等（重派重盖同值）；前端对无效戳值（未来未知 kind）回退前缀+不产段（防御性）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。戳来源为服务端派发链自身参数（daemon 服务凭证/后端内部调用），浏览器 Bearer 用户不可达（schedule 无 HTTP 注入端点入口；task_wakeup origin 门控既有）；多 daemon 实例各自盖自己派发的轮，无共享写。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是盖戳覆盖群聊键的理论冲突——群聊链路未来若也需 turn_trigger 语义（群聊来源标注），合并序（trigger 覆盖 chain）会吞掉；现状群聊 turn_metadata 不含 turn_trigger 键（键空间不相交），风险登记不设防。次要风险：'schedule' 排队行 origin 若被用户伪造——busy 路径入队的 origin 由 _handle_busy_turn 参数派生（HTTP 注入端点不透传 turn_trigger），浏览器不可达，伪造面不存在。死路：①「run metadata 盖戳」（metadata_.auto_resume_of 同族）——放弃，前端时间线装配以日志行为输入、run metadata 需跨 API 关联穿透装配签名（Phase 1 已评估放弃）；②「前端按内容前缀识别 schedule」——定时消息派发是裸 user prompt 无标记，前缀方案要求派发侧改 prompt 内容（污染正文），metadata 盖戳零污染；③「排队行加新列」——origin 列同族语义复用即可，零迁移。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 改 | backend/app/modules/daemon/session/service/helpers.py | SCHEDULE_QUEUE_ORIGIN + queue_origin_to_trigger |
| 改 | backend/app/modules/daemon/session/service/inject.py | _inject_into_session turn_trigger 参数 + 盖戳合并 |
| 改 | backend/app/modules/daemon/session/service/queue.py | _handle_busy_turn turn_trigger 参数/origin 派生 + 回放盖戳 |
| 改 | backend/app/modules/daemon/scheduled_send.py | 直注 turn_trigger="schedule" |
| 改 | backend/app/modules/daemon/session/service/__init__.py | SessionService 三个 facade（inject_session/inject_session_as_service/_inject_into_session）turn_trigger 透传（实施期发现的双层 facade 链） |
| 改 | backend/app/modules/daemon/tests/test_inject_origin_guard.py | 盖戳三源用例 |
| 改 | backend/app/modules/daemon/tests/test_session_queue.py | 回放盖戳 + schedule origin 用例 |
| 改 | frontend/src/components/daemon/session-log-assembler.ts | TurnTriggerKind+META.schedule + classifyTurnTrigger metadata 优先 |
| 改 | frontend/src/components/daemon/runtime-session-helpers.tsx | 回放分类透传 entry.metadata |
| 改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | live 分类透传 env.metadata |
| 改 | frontend/src/lib/daemon/session-sse.ts | SessionStreamEnvelope 增可选 metadata 字段（inject 直落行 log 事件透传） |
| 改 | backend/app/modules/daemon/session/service/inject.py（发布段） | user_input 实时事件 payload 增 metadata 透传 |
| 改 | frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx | metadata 优先 + schedule 用例 |
