---
author: qinyi
created_at: 2026-10-11 17:05:00
change: 2026-10-11-linked-repo-workspace-ref
version: 2（archive 终审——5a53d8846 为准）
---

# 模块影响分析（Module Impact）— 2026-10-11-linked-repo-workspace-ref

| 模块 ID | 触及文件 | 影响类型 | 文档动作 | 更新结果 |
|---|---|---|---|---|
| backend | linked_repos 五文件+linked_repos_sync.py+迁移 | 增量能力（FK 挂载+读时降级+匹配） | backend 卡「关联仓」段补挂载/匹配一句 | done |
| frontend | 卡片+表单+测试+lib+生成物 | 增量 UI（下拉/跳转/提示） | frontend 卡「关联仓卡片」段补一句 | done |

## 未匹配文件

无（迁移归 backend 行；无新原型——R-04 声明）。
