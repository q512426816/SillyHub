---
author: qinyi
created_at: 2026-08-29 20:48:03
---
# 任务清单（Tasks）

> 骨架只列任务名。plan 阶段会把展开后的清单写回本文件。

- [ ] task-01: backend 分流挂起（suspend+offline sweep 按 parent_session_id：worker failed(daemon_interrupted)/主会话 suspended 不变）
- [ ] task-02: backend worker 自动重派（AgentSession 行重建上下文+dispatch_to_daemon+resume_session_id 注入+attempt>=3 节流）
- [ ] task-03: backend claim interactive 分支 resume_session_id 白名单补透传
- [ ] task-04: daemon _startInteractiveSession 消费 resume_session_id 传 SessionManager.create
- [ ] task-05: daemon SessionManager.create resume key 支持+SDK 损伤自动降级 fresh+resume_downgraded 事件
- [ ] task-06: 集成回归（worker 掉线→failed→重派→claim resume→续会话全链+主会话回归锁定+节流+降级）
