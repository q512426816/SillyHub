---
author: qinyi
created_at: 2026-08-22 13:33:10
---
# 任务清单（Tasks）

> 任务名唯一真相源；plan.md Wave 段纯 ID 引用。task-XX 卡片在 tasks/task-NN.md 由蓝图步骤展开。
> 顺序铁律：本变更整体先于 team-unify task-11 执行合入（design §1 P1 硬前置门 / D-006@v1）。

- [x] task-01: 4 消费方直迁 SessionPanel mode="dialog" + 类型 import 归位 turn-timeline + 删 interactive-session-panel.tsx + 全仓 dangling import 守护 (depends_on: task-05)
- [x] task-02: session-panel dialog 分支 5 处基元 antd 化（主操作 32 / 打断 small 24 / 结束 danger；UiBadge→Tag；删别名 import） (depends_on: task-01)
- [x] task-03: TurnStatusBadge antd Badge status 化（签名零变化）+ 3 个断言测试文件适配 (depends_on: task-02, task-04)
- [x] task-04: SessionInputBar 发送/📎 按钮换 antd（primary / text） (depends_on: task-01)
- [x] task-05: 3 套 ISP 测试迁移改名 session-panel-dialog*（56 用例对账语义保留）+ workspace-section mock 路径 (depends_on: —)
- [x] task-06: 3 文件注释锚点校正（ask-user-dialog-card / lib/daemon / session-log-sanitize） (depends_on: task-01)
- [x] task-07: 全量回归（vitest + tsc + lint + 双主题换肤冒烟 + 5 消费面人工冒烟对照原型） (depends_on: task-02, task-03, task-04, task-06)
- [x] task-08: 合入后更新 team-unify task-11.md 代码锚点（仅文档，P1 门收尾动作） (depends_on: task-07)
