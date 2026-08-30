# 符号影响面报告

> tasks.md 内容指纹（生成时）: 1cfe667400ed0a5a——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 新增签名（非修改）：schema.py 新 DTO 四个 UsageByModelItemRead / UsageTotalsRead / ChangeUsageRead / UsageSummaryRead；ChangeSummary 与 QuicklogEntryListItem 各新增 optional 字段 usage（新增字段非改既有字段，旧消费方零影响）。无既有方法签名修改。
- task-02: 新增签名（非修改）：新建 usage_service.py ChangeUsageQueryService（get_change_usage / get_quicklog_usage / summarize_changes / summarize_quicklogs 四方法，均 async）。无既有调用点受影响；消费方 task-03/04/05 在任务范围内。
- task-03: 接线级变更（无对外签名修改）：ChangeService.enrich_summaries 内部尾段新增 usage 批量投影调用（方法签名不变，返回值 ChangeSummary 多填充既有 optional 字段）；router.list_quicklog_entries 组装处填充 usage（端点签名与 response_model 不变）。
- task-04: 新增签名（非修改）：router.py 新增两个端点处理函数（GET /changes/{change_id}/usage、GET /quicklog-entries/{ql_id}/usage，response_model=ChangeUsageRead）。无既有路由/签名修改。
- task-05: 无签名级变更：纯新增测试文件 test_usage_stats.py，不改产品代码。
- task-06: 新增签名（非修改）：lib/changes.ts 新增 getChangeUsage、lib/quicklog.ts 新增 getQuicklogUsage（类型来自 gen:types 生成物，非手写）；api-types.ts / openapi.json 为生成物重生成。
- task-07: 新增签名（非修改）：新组件 ChangeUsageCard（props 为 kind、workspaceId、refKey 三字段）。无既有导出修改。
- task-08: 无签名级变更：changes/page.tsx columns 数组加「执行」列（内部数据结构）、quicklog-table.tsx 同款加列；不改组件导出 props/签名。quicklog-table.test.tsx 补 mock 字段与断言。
- task-09: 无签名级变更：[cid]/page.tsx 与 quicklog-drawer.tsx 仅内部接线（各新增一处 ChangeUsageCard 渲染点），不改组件导出 props/签名。
- task-10: 无签名级变更：gen:types 产物复核 + 回归测试执行，无源码签名改动。
