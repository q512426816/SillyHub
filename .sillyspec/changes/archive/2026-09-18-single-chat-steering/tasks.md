---
author: qinyi
created_at: 2026-09-19 00:22:43
---
# 任务清单（Tasks）— 单聊引导（Steering）忙轮直注入

> 任务名唯一真相（plan.md Wave 段为纯 ID 引用）；target_files 明细见 plan.md 任务总表。

- [x] task-01: PROVIDER_CAPS 新增 steering 第 14 键（daemon providers.ts 单源 + gen-provider-caps.mjs 三端刷新 + alignment 测试）(depends_on: —)
- [x] task-02: codex `turn/steer` 实机探测（spike-01，本机 0.147.0 app-server 手工会话，参数结论落盘 spike-codex-turn-steer.md）(depends_on: —)
- [x] task-03: codex 驱动输入循环接 turn/steer 分支（turn 活跃直发，被拒回落轮边界；含单测）(depends_on: task-02)
- [x] task-04: claude SDK 队列 mid-turn 吸收 spike 实测（spike-02，queued_turn_count 断言，证据落盘 spike-claude-steering.md）(depends_on: —)
- [x] task-05: backend 单聊忙轮改 busy_strategy=inject + provider 能力门控（router/session_crud.py；SessionInjectResponse 加 steered 映射 mid_turn）(depends_on: task-01)
- [x] task-06: backend dispatch_now 引导式重构（queue.py 不再无条件 interrupt；QueueDispatchNowResponse.dispatch_mode 三态 + router 映射）(depends_on: task-01)
- [x] task-07: frontend 忙轮发送引导状态（steered 响应→引导中/已引导气泡；手写镜像 sessions.ts 补字段；page/dialog 双挂载）(depends_on: task-05)
- [x] task-08: frontend 队列条 ⚡ 引导语义 + 降级标注（消费 task-06 的 dispatch_mode 三态；message-queue-bar + provider-caps 数据源）(depends_on: task-06)
- [x] task-09: 三端测试收口 + api-types 重新生成（backend 忙轮三分支/dispatch_now 回归、daemon codex 单测、前端组件测试、群聊零回归用例）(depends_on: task-03, task-05, task-06, task-07, task-08)
- [x] task-10: 模块文档同步（daemon.md / backend session 模块）+ verify 对照验收 (depends_on: task-09)
- [x] ql-20260920-006-ca4a steering 修订——忙轮默认排队 + 引导消息轮内时间位置
