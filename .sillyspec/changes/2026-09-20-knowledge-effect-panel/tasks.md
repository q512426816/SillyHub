---
author: qinyi
created_at: 2026-09-20 21:20:00
---
# 任务清单（Tasks）

> 任务注册表唯一真相（plan.md Wave 纯 ID 引用分组；TaskCard 细节 execute 阶段生成）。

- [ ] task-01: backend 数据底座（knowledge_hits 表+ingest/stats 服务+两端点+parser 条目全集 helper 含 slug 归一与 fr zone） (depends_on: )
- [ ] task-02: daemon hits 增量上报（offset 状态/完整行断点/分批/postSpecSync 挂点 best-effort） (depends_on: )
- [ ] task-03: 联调门面（list 透传 use_count+gen:types+openapi 提交） (depends_on: task-01,task-02)
- [ ] task-04: frontend 运营仪表盘（四指标卡+死条目抽屉+使用率榜全量（%格式显示）+三态） (depends_on: task-03)
- [ ] task-05: frontend 统一条目渲染器（三形态+fr zone 组+双 tab 接入） (depends_on: task-03,task-04)
- [ ] task-06: 端到端验证（hits 上行幂等/指标对拍/卡片流/fr zone/老 daemon 零影响，证据落 evidence/） (depends_on: task-04,task-05)
- [ ] task-07: 模块文档增量+回归+原型对照 (depends_on: task-06)
