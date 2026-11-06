---
author: qinyi
created_at: 2026-11-06 22:44:10
generated_by: manual
change: 2026-11-06-session-reopen-no-cwd
---
# 任务清单（Tasks）

> 任务注册表唯一真相；plan 阶段已展开（6 张能力卡，实现+单测同卡，原 11 任务按拆分粒度纪律重组）。TaskCard 见 tasks/ 目录。

- [ ] task-01: daemon resume cwd 三级同源链（payload 非空串 → sessions.json 快照 → config.workspace_dir）+ 三级链测试
- [ ] task-02: daemon cwd 回报携带（hub-client 两方法可选参数 + 三发送点）+ 回报测试
- [ ] task-03: backend DS-7 门放宽（删 :133-139 拒绝块 + DaemonSessionNoCwd 退役）+ 测试改写
- [ ] task-04: backend SESSION_RESUME payload cwd 条件键（lifecycle + sweep 两处构造）+ 测试
- [ ] task-05: backend notify 端点 cwd 落库（confirm + ready + schema 可选字段）+ 落库测试
- [ ] task-06: gen:types 双端生成物（api-types ×2 + openapi.json）+ 聚焦测试收口
