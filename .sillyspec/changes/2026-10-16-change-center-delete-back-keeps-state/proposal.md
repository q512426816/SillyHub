---
author: flow-machine-draft
created_at: 2026-10-16T14:32:32.483Z
---
# 提案书（Proposal）— 2026-10-16-change-center-delete-back-keeps-state

## 动机

任务原话转写：动机:变更详情页删除成功后 router.push 无参列表,丢 tab/页码(删归档区变更后回进行中第一页);且删除使当前页可能超界(最后一页只剩该行时),回到列表后当前页空列表无兜底。
成功标准:
- 详情页删除成功后:浏览器历史可后退时 router.back() 回带 query 的列表 URL(复用 2026-10-16-change-center-back-keeps-list-state 的 URL 快照恢复链路),无历史可退时兜底 push 默认列表
- 列表页页码超界钳回:真实响应(非 placeholder)items 空、total>0 且 page 超过 ceil(total/pageSize) 时自动钳回最后一页并重新请求
- 删除与钳回新增测试断言;既有相关测试零回归

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 详情页删除成功后:浏览器历史可后退时 router.back() 回带 query 的列表 URL(复用 2026-10-16-change-center-back-keeps-list-state 的 URL 快照恢复链路),无历史可退时兜底 push 默认列表
2. 列表页页码超界钳回:真实响应(非 placeholder)items 空、total>0 且 page 超过 ceil(total/pageSize) 时自动钳回最后一页并重新请求
3. 删除与钳回新增测试断言;既有相关测试零回归

## 成功标准（可验证）

1. 详情页删除成功后:浏览器历史可后退时 router.back() 回带 query 的列表 URL(复用 2026-10-16-change-center-back-keeps-list-state 的 URL 快照恢复链路),无历史可退时兜底 push 默认列表
2. 列表页页码超界钳回:真实响应(非 placeholder)items 空、total>0 且 page 超过 ceil(total/pageSize) 时自动钳回最后一页并重新请求
3. 删除与钳回新增测试断言;既有相关测试零回归
