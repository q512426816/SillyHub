---
author: qinyi
created_at: 2026-09-12T11:05:30
---

# 任务分解（Tasks）— 2026-09-12-chat-turn-auto-recovery

> 注册表唯一真相（execute 从本文件解析任务清单）；实现细节见 tasks/task-NN.md（TaskCard，plan 阶段生成）。

- [x] task-01: daemon 错误归类泛化 + resetAt（classifier 门控移除/断流关键词/中文格式解析 + ModelError 类型 + wire 映射 + 测试） (depends_on: —)
- [x] task-02: daemon pi 静默中断检测（message_end 边粒度 hasText 收口 + settle 收敛合成 error result + driver 测试） (depends_on: —)
- [x] task-03: backend 协议与数据层（ModelErrorDTO.reset_at + scheduled_messages.origin 列 + migration + 两个列表 DTO origin 透传 + gen:types） (depends_on: —)
- [x] task-04: backend 三分支自动恢复（maybe_auto_recover_failed_turn 判定序 G0/G5/G6 + nudge 常量 + auth 并入 + close 钩子接线 + 测试） (depends_on: task-03)
- [x] task-05: 定时派发补 auto_resume 语义（scheduled_send origin 解析/G10 超越守卫/auto_resume_of 透传 + inject 加参转发 + _handle_busy_turn origin + 测试） (depends_on: task-03, task-04)
- [x] task-06: frontend 双信号提示与徽标（定时数据上提两挂载点 + run-error-item 三分支 + turn-timeline 下发 + scheduled-messages-bar 徽标 + 测试） (depends_on: task-03)
- [x] task-07: 集成验证（三类中断端到端：瞬时重放/工具活动 nudge/quota 定时续跑 + 链上限 + G10 + 开关关闭回归 + 模块文档同步） (depends_on: task-01, task-02, task-04, task-05, task-06)
