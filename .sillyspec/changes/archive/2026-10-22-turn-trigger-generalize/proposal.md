---
author: flow-machine-draft
created_at: 2026-10-22T03:14:44.733Z
---
# 提案书（Proposal）— 2026-10-22-turn-trigger-generalize

## 动机

任务原话转写：轮触发溯源泛化为统一事件呈现
动机与背景：2026-10-21-task-wakeup-event-queue 落地了 task_wakeup 单源的「收到任务消息」事件呈现（时间线 task_wakeup 段+折叠行、排队栏事件行）；用户裁定按 deepseek-harness turn-trigger.ts 分类学泛化为通用轮触发溯源——单一 turn_trigger 段 + 配置驱动视图，新源接入=配置表加一行。Phase 1 纯前端接入 4 源：task_wakeup（内容前缀，正文折叠不变）、auto_resume（run metadata auto_resume_of 已透传前端）、影子直聊/群聊（【影子直聊】/【群聊上下文】前导头，正文照常显示仅标来源）；定时消息打戳留 Phase 2。文案用平台措辞（收到任务消息/断线自动续跑/来自影子直聊/来自群聊）。

成功标准：
- TurnSegment 泛化：kind=turn_trigger 携带 trigger 字段（task_wakeup/auto_resume/shadow_chat/group_chat），task_wakeup 呈现行为与现状逐像素等价（折叠行文案/交互零变化）
- 新源接入：影子直聊/群聊开轮出现「来自影子直聊/来自群聊」触发行且消息正文照常渲染（不吞进折叠行）；auto_resume 轮出现「断线自动续跑」触发行
- 排队栏：触发源条目（origin=task_wakeup 或 auto_resume:*）走事件行分流、计数豁免口径与后端对齐
- 前端 tsc 零错 + 受影响测试套件（assembler/views/helpers/message-queue-bar）全绿

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. TurnSegment 泛化：kind=turn_trigger 携带 trigger 字段（task_wakeup/auto_resume/shadow_chat/group_chat），task_wakeup 呈现行为与现状逐像素等价（折叠行文案/交互零变化）
2. 新源接入：影子直聊/群聊开轮出现「来自影子直聊/来自群聊」触发行且消息正文照常渲染（不吞进折叠行）；auto_resume 轮出现「断线自动续跑」触发行
3. 排队栏：触发源条目（origin=task_wakeup 或 auto_resume:*）走事件行分流、计数豁免口径与后端对齐
4. 前端 tsc 零错 + 受影响测试套件（assembler/views/helpers/message-queue-bar）全绿

## 成功标准（可验证）

1. TurnSegment 泛化：kind=turn_trigger 携带 trigger 字段（task_wakeup/auto_resume/shadow_chat/group_chat），task_wakeup 呈现行为与现状逐像素等价（折叠行文案/交互零变化）
2. 新源接入：影子直聊/群聊开轮出现「来自影子直聊/来自群聊」触发行且消息正文照常渲染（不吞进折叠行）；auto_resume 轮出现「断线自动续跑」触发行
3. 排队栏：触发源条目（origin=task_wakeup 或 auto_resume:*）走事件行分流、计数豁免口径与后端对齐
4. 前端 tsc 零错 + 受影响测试套件（assembler/views/helpers/message-queue-bar）全绿
