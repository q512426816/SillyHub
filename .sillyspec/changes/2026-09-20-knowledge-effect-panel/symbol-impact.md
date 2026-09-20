# 符号影响面报告

> tasks.md 内容指纹（生成时）: e18d290893b4512f——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无既有签名修改——新增为主（knowledge_hits 表/HitsService/两新端点/parser 增 zone 常量与条目 helper），parse_knowledge 签名不变。
- task-02: 无签名级变更——daemon 新模块+spec-sync 增 best-effort 钩子，不改既有函数签名。
- task-03: KnowledgeEntryRead 增可选 use_count 字段（字段只增不删，旧客户端忽略）；gen:types 再生成。
- task-04: 无签名级变更——新组件+API 封装（新增函数非修改）。
- task-05: 无签名级变更——新组件+page.tsx 内部分发结构（props 无对外签名变化）。
- task-06: 无签名级变更——纯验证任务零 diff。
- task-07: 无签名级变更——纯文档更新。
