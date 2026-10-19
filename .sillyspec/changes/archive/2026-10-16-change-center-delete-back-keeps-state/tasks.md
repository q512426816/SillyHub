---
author: flow-machine-draft
created_at: 2026-10-16T14:32:32.483Z
---
# 任务注册表（Tasks）— 2026-10-16-change-center-delete-back-keeps-state

- [x] task-01: 详情页删除成功后:浏览器历史可后退时 router.back() 回带 query 的列表 URL(复用 2026-10-16-change-center-back-keeps-list-state 的 URL 快照恢复链路),无历史可退时兜底 push 默认列表
- [x] task-02: 列表页页码超界钳回:真实响应(非 placeholder)items 空、total>0 且 page 超过 ceil(total/pageSize) 时自动钳回最后一页并重新请求
- [x] task-03: 删除与钳回新增测试断言;既有相关测试零回归
