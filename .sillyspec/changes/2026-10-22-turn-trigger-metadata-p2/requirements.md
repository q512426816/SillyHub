---
author: flow-machine-draft
created_at: 2026-10-22T04:34:10.397Z
---
# 需求规格（Requirements）— 2026-10-22-turn-trigger-metadata-p2

## 功能需求

### FR-01: 派发溯源盖戳（user_input 日志 metadata_.turn_trigger）

- 注入链必须在派发轮的 user_input 日志行 metadata_ 列盖 `turn_trigger` 戳：task_wakeup（router task_wakeup=True 的直注入路径 + 队列行 origin='task_wakeup' 的回放路径）必须盖 'task_wakeup'；auto_resume（auto_resume_of 参数路径 + 队列行 origin='auto_resume:<uuid>' 回放）必须盖 'auto_resume'；schedule（scheduled_send 直注 + 忙轮排队行 origin='schedule' 回放）必须盖 'schedule'；群聊 chain_metadata 与 turn_trigger 戳必须合并不互吞（chain_metadata 既有键保留）；忙轮排队行 origin 必须新增 'schedule' 值（与 TASK_WAKEUP_QUEUE_ORIGIN/auto_resume 前缀空间不相交）。

#### 场景：三源盖戳

- Given task_wakeup 直注入、auto_resume 队列回放、schedule 直注入各派发一轮
- When 各轮 user_input 行落库
- Then metadata_.turn_trigger 分别为 task_wakeup/auto_resume/schedule

#### 场景：群聊合并

- Given 群聊链路 turn_metadata（source_group_id 等）与 turn_trigger 戳并存
- When user_input 行落库
- Then 既有群聊键保留、turn_trigger 键新增

### FR-02: 定时消息全链溯源

- scheduled_send 派发必须双路径溯源：空闲直注经 inject_session_as_service 新增 turn_trigger='schedule'；忙轮经排队行 origin='schedule' 回放盖戳；排队栏中 schedule 条目必须保持用户消息 chip 渲染（用户亲笔内容，不入触发源事件行分流）。

#### 场景：忙轮定时消息

- Given 会话忙轮时定时消息到点入队（origin='schedule'）
- When 本轮结束派发回放
- Then user_input 行 metadata_.turn_trigger='schedule'

### FR-03: 前端 metadata 优先分类 + schedule 触发行

- classifyTurnTrigger 必须改为 metadata 优先：log 行 metadata.turn_trigger 为有效 TurnTriggerKind 值时直接采信（服务端戳，不可伪造）；metadata 缺失或值无效时回退内容前缀检测（存量行/未盖戳路径零回归）；TurnTriggerKind 必须新增 'schedule'（META：⏰/「定时消息到点」/正文可见——纯来源标注行）；时间线装配（回放+live 两路径）分类调用必须透传日志行 metadata。

#### 场景：metadata 优先

- Given 用户手打「[系统续跑]」开头但 metadata.turn_trigger 缺失的 user_input
- When 分类
- Then 回退内容前缀判定 auto_resume（既有口径）；若 metadata.turn_trigger='schedule' 则采信 schedule（前缀不参与）

### FR-04: 回归与类型门

- 后端相关面 pytest（session_queue/auto_resume_integration/inject_origin_guard 等）必须全绿 + ruff/mypy 零错；前端受影响套件（helpers/views/queue-bar 等）全绿 + tsc 零错；metadata 缺失的存量日志行行为必须与 Phase 1 完全一致（前缀兜底零回归）。

#### 场景：全量回归

- When 后端 pytest+ruff+mypy 与前端 vitest+tsc 执行
- Then 全绿零错

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/daemon/tests/test_inject_origin_guard.py「turn_trigger 盖戳三源」+ backend/app/modules/daemon/tests/test_session_queue.py「队列回放 turn_metadata 盖戳」
FR-02: backend/app/modules/daemon/tests/test_session_queue.py「scheduled 忙轮排队行 origin='schedule' 与回放盖戳」
FR-03: frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「metadata 优先分类与 schedule 触发行」
FR-04: backend pytest+ruff+mypy 与 frontend vitest+tsc（套件级门，无单用例）
