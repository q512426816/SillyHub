---
author: flow-machine-draft
created_at: 2026-10-08T17:38:11.159Z
---
# 任务注册表（Tasks）— 2026-10-09-frontend-risk-fixes

- [x] task-01: 知识库页选择 fetch 失败时内容区显示可判定的错误态（不再永久「正在加载」占位），后续重新选择可恢复
- [x] task-02: 锚点复制按真实结果反馈：复制成功才提示成功，clipboard 不可用/失败提示失败（对齐 governance-cards copyPrompt 既有范式）
- [x] task-03: 知识图谱 overview 与 query 请求前端超时对齐服务端 RPC 预算（显式 timeoutMs ≥ 服务端最坏情形），大仓不再恒超时
- [x] task-04: 图谱画布 pointer 按下（拖拽/平移）与滚轮同样置位用户交互标记，自动 re-fit 跟随即停（兑现提交声明「拖拽/缩放即停」）
- [ ] task-05: 既有相关面测试保持绿；四处修复各有用例钉住（先红后绿或行为断言）
