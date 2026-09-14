---
author: qinyi
created_at: 2026-09-15 00:40:00
---
# 任务清单（Tasks）

- [ ] task-01: caps 第 13 键 thinking_level 三端贯通+codex thinking 翻值（八步样板）
- [ ] task-02: daemon 共享词表 thinking-levels.ts+映射矩阵+单测 (depends_on: task-01)
- [ ] task-03: driver 契约（可选两方法+StartOptions.thinkingLevel）+session-manager 子模块+两 RPC handler+CreateSessionInput 全链透传+测试 (depends_on: task-02)
- [ ] task-04: 三 driver 实现（getThinkingLevels/setThinkingLevel/启动设置）+测试 (depends_on: task-03)
- [ ] task-05: backend 全链（schema 三 DTO+create 形参+placement+lease+归一化对端）+GET/POST 两端点+_ENDPOINT_ORDER+测试 (depends_on: task-01)
- [ ] task-06: 前端（两 API+创建下拉静态镜像+会话切换控件+caps/空闲门控）+vitest (depends_on: task-05)
- [ ] task-07: onboarding 指引+真机三引擎验证（spike-01 codex 形状/spike-02 claude applyFlagSettings/pi 双命令） (depends_on: task-04, task-05, task-06)
