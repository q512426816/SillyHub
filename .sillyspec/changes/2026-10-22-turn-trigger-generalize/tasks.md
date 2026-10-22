---
author: flow-machine-draft
created_at: 2026-10-22T03:14:44.733Z
---
# 任务注册表（Tasks）— 2026-10-22-turn-trigger-generalize

- [x] task-01: TurnSegment 泛化：kind=turn_trigger 携带 trigger 字段（task_wakeup/auto_resume/shadow_chat/group_chat），task_wakeup 呈现行为与现状逐像素等价（折叠行文案/交互零变化）
- [x] task-02: 新源接入：影子直聊/群聊开轮出现「来自影子直聊/来自群聊」触发行且消息正文照常渲染（不吞进折叠行）；auto_resume 轮出现「断线自动续跑」触发行
- [x] task-03: 排队栏：触发源条目（origin=task_wakeup 或 auto_resume:*）走事件行分流、计数豁免口径与后端对齐
- [x] task-04: 前端 tsc 零错 + 受影响测试套件（assembler/views/helpers/message-queue-bar）全绿
