---
author: qinyi
created_at: 2026-08-29 13:22:15
---
# 任务清单（Tasks）

> 骨架只列任务名。plan 阶段会把展开后的清单**写回本文件**（checkbox 行带一句话名，可附 [model:xxx]/(depends_on: …) 标注；保留 frontmatter/标题/ql-xxx 等非 task-XX 行）；execute 勾选与 verify 对照都在本文件。

- [x] task-01: backend DTO + get_session_usage 聚合（schema.py SessionUsageRead/SessionUsageModelItemRead + session/service.py 两段聚合 + ctx_tokens 排除 + 归属校验）
- [x] task-02: backend 端点 GET /sessions/{session_id}/usage + test_session_usage.py（纯明细/纯兜底/混合/空会话/归属 404）（depends_on: task-01）
- [x] task-03: frontend getSessionUsage 封装 + session-usage-bar 组件 + 组件测试（摘要/命中率 0 分母「—」/折叠/refreshSignal 重取）（depends_on: task-02）
- [x] task-04: session-panel page/dialog 双模式渲染点接线 + 轮次终态 refreshSignal 递增 + 渲染点测试适配（depends_on: task-03）
- [x] task-05: gen:types 三端同步 + 三端相关测试回归收口（depends_on: task-01, task-02, task-03, task-04）
