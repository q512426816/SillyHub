---
author: qinyi
created_at: 2026-10-08T18:05:00
---
# 符号影响面（Symbol Impact）— 2026-10-08-platform-knowledge-graph

> execute Step「加载上下文」产出：按任务逐一核对签名级变更与受影响调用点（CLI 硬校验覆盖 plan 全部 task）。

- task-01: 方法新增（KnowledgeGovernanceHandler 加 graph 方法 + daemon.ts 注册行）——无既有签名变更；受影响调用点=无（新 RPC 方法，daemon.ts 注册为唯一接线点，在 allowed_paths 内）。
- task-02: 新增面（schema.py 新 DTO 类、graph.py 新 service 类、router.py 三个新端点函数）——无既有签名变更；router 新端点挂载 main.py 既有 include_router（零改动，knowledge router 已整体挂载）；受影响调用点=无。
- task-03: 无签名级变更（NEW test_graph.py 纯新增）。
- task-04: 无签名级变更（既有测试文件追加用例，不改既有用例签名）。
- task-05: 新增导出（api-types.ts 生成物、knowledge.ts 加三函数与类型导出、query-keys.ts 加 key 工厂）——无既有签名变更；受影响调用点=无（新符号仅本变更消费）。
- task-06: 新增面（NEW graph-canvas.tsx 组件与纯函数导出）——无签名级变更。
- task-07: 新增面（NEW page.tsx 页面）——无签名级变更；消费 task-05/06 新符号，均在 allowed_paths 依赖链内。
- task-08: 组件内扩展（workspace-tabs.tsx TABS 数组加一项——常量数据非签名；ops-dashboard.tsx JSX 加子卡——组件 props 签名不变）——无签名级变更；受影响调用点=无（TABS 数组消费方 app-shell 遍历渲染，加项不破坏类型）。
- task-09: 无签名级变更（新增测试文件 + 既有 ops-dashboard 测试追加用例）。
- task-10: 无签名级变更（NEW verify-e2e.md 文档）。
