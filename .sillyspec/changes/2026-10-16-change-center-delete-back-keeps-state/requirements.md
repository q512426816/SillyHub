---
author: flow-machine-draft
created_at: 2026-10-16T14:32:32.483Z
---
# 需求规格（Requirements）— 2026-10-16-change-center-delete-back-keeps-state

## 背景与动机

上一变更 2026-10-16-change-center-back-keeps-list-state 已把变更中心列表状态 URL 化并让
详情页返回入口走 router.back()。但详情页**删除成功**后的跳转仍是 `router.push` 无参列表
（DetailDeleteAction onSuccess）——删归档区变更后回到进行中第一页，同病未治。且删除使
总数减一后，用户停留的页码可能超界（删的是当前页最后一行时），回列表后当前页 items 为空、
antd Pagination 停在超界页，无兜底。

## 功能需求

### FR-01: 详情页删除成功后按历史可退性返回列表

详情页 DetailDeleteAction 删除成功后，浏览器历史可后退（`window.history.length > 1`）时
必须调用 `router.back()`——回退到离开前带 query 的列表 URL（列表页从 URL 恢复 tab/页码，
复用 2026-10-16-change-center-back-keeps-list-state 的恢复链路）；无历史可退（新标签深链
详情）时必须兜底 `router.push` 默认列表 `/workspaces/<id>/changes`。删除失败的路径行为
不变（onError toast 不跳转）。

#### 场景：从列表进详情删除后返回

- Given 用户从已归档第 N 页列表整页导航进详情
- When 删除成功
- Then 触发 router.back()（不 push 无参列表），回到带 query 的列表 URL

#### 场景：新标签深链详情后删除

- Given 用户新标签直接打开详情页（history.length = 1）
- When 删除成功
- Then 走 router.push 到无参默认列表（不调用 back）

### FR-02: 列表页页码超界钳回最后一页

变更中心列表页在主列表查询返回**真实响应**（非 placeholderData）且 items 为空、total > 0、
当前 page > 1 时，必须计算最后一页 `ceil(total / pageSize)`；若当前 page 超过最后一页，
必须自动 `setPage` 钳回最后一页（触发重新请求与 URL 写回）。page 未超界（如筛选后当前页
恰无数据但 page ≤ 最后一页）与 total = 0（真空列表）时禁止钳回，空状态展示维持现状。
quicklog tab（主查询禁用）不参与钳回。

#### 场景：删除后当前页超界

- Given 列表停留在已归档第 5 页（pageSize=20，删除后 total=80，最后一页为 4）
- When 回到列表，page=5 的请求返回 items=[]、total=80
- Then 自动钳回 page=4 并重新请求第 4 页，URL 写回 ?tab=archive&page=4

#### 场景：真空列表不钳回

- Given 筛选/删除后 total=0
- When 当前页 items 为空
- Then 不触发钳回，维持空状态展示与当前页码

### FR-03: 测试零回归 + 新增断言

既有相关测试必须全部保持通过；必须新增覆盖：删除成功后 back/兜底 push 两分支；列表页
页码超界钳回（深链超界 page → 钳回最后一页 → URL 写回）与真空不钳回。

#### 场景：回归与新增断言

- Given 前端测试套件
- When 运行变更中心列表页与详情页相关测试文件
- Then 既有用例零回归，新增用例全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-back-to-list.test.tsx「删除成功:历史可后退时 router.back() 回列表」「删除成功:无历史可退时兜底 push 默认列表」
FR-02: frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx「页码超界钳回最后一页并重新请求」
FR-03: frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx（既有用例全量回归）+ frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-back-to-list.test.tsx + page-team-toggle.test.tsx（详情页既有用例回归）
