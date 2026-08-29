---
author: qinyi
created_at: 2026-08-29 21:05:00
---
# 任务清单（Tasks）

- [ ] task-01: backend 分流挂起（suspend+offline sweep 按 parent_session_id：worker failed(daemon_interrupted)+重派种子/主会话 suspended 不变）
- [ ] task-02: backend worker 自动重派（prepare_interactive_dispatch 复用原会话+双表上下文重建+prompt 重渲染+resume 注入+attempt>=3 节流+三互斥守卫）（depends_on: task-01）
- [ ] task-03: backend claim interactive 分支 resume_session_id 白名单补透传
- [ ] task-04: daemon resume 接线（payload 归一化→CreateSessionInput.resume→SessionManager.create）（depends_on: task-03）
- [ ] task-05: daemon SessionManager.create 损伤自动降级 fresh+resume_downgraded 事件（depends_on: task-04）
- [ ] task-06: 集成回归（worker 掉线→重派→resume 续会话全链+主会话零破坏+三守卫+节流+降级）（depends_on: task-01, task-02, task-03, task-04, task-05）
