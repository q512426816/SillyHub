---
author: qinyi
created_at: 2026-10-26 03:30:00
---

# 任务清单（Tasks）— 会话阶段化进度

> plan 阶段展开（实现+单测同卡粒度，D-006 拆分纪律）；详细实现见 tasks/task-NN.md 卡片。

- [ ] task-01: backend 协议与发布全集（DTO+helper+端点+状态机发布+测试+openapi）(depends_on: —)
- [ ] task-02: daemon 信号源全集（notifyTurnPhase+五冷启动+轮内两阶段+测试+gen:types）(depends_on: task-01)
- [ ] task-03: frontend 数据层与接线（sse 信封+stream 分发+turn-state 终态清理+双面板+timeline 透传+测试+gen:types）(depends_on: task-01, task-04)
- [ ] task-04: frontend 状态条展示（PHASE_LABEL+超时警示+退位+零回归+测试）(depends_on: task-01)
- [ ] task-05: 收尾验收与文档同步（design 成功标准+模块文档+原型同源提交）(depends_on: task-02, task-03, task-04)
