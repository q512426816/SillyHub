# 符号影响面报告

> tasks.md 内容指纹（生成时）: d3c7f22a67b5d567——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——新表 platform_agent_log_usage_marks + UsageMarkORM 新增类（无既有调用点）。
- task-02: upsert_agent_log_entries 公开签名不变；新增私有 helper（插水位/修剪）无外部消费；_bind_entry_ctx 不动。
- task-03: ChangeUsageQueryService 公开四方法签名与 DTO 字段集零变化；本地段为 _local_* 私有簇内部重构 + 新增差分查询构造。
- task-04: 无签名级变更——纯测试/文档收口。
