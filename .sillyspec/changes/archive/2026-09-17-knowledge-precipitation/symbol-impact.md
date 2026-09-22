# 符号影响面报告

> tasks.md 内容指纹（生成时）: 193c23add91280f8——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: DTO 字段级变更：`ParsedEntry`（parser.py）与 `KnowledgeEntry`（schema.py，design 记作 KnowledgeEntryRead）新增 `zone` 字段、`filename` 语义扩展为含子目录段（顶层值不变）。受影响调用点：KnowledgeService.list/get（service.py，本任务内透传）、前端 lib/knowledge.ts 消费再生成 api-types（task-03/05 范围内）。既有调用点零签名破坏（字段只增不删）。
- task-02: 枚举签名级变更：`Permission`（auth/permissions.py）新增 `KNOWLEDGE_WRITE` 成员。受影响调用点=仅新增 router 装饰器引用（task-04/07 范围内）；既有 collect_permissions/rbac 链路对枚举成员自动生效，零调用点修改。
- task-03: 无签名级变更——纯前端组件层改造（page.tsx 树分组渲染），消费 task-01 再生成的 api-types 新字段。
- task-04: 新增签名（非修改）：新类 KnowledgeWriterService（propose_manual/update_entry/preview_merge/merge/reject）+ 5 个新 REST 端点 + 新 DTO（KnowledgeProposeIn/KnowledgeUpdateIn/KnowledgeMergeIn/MergePreviewOut）。消费既有 SpecWorkspaceService.apply_ops 与 FileOp（只调用不修改，签名零变更）。
- task-05: 新增签名（非修改）：lib/knowledge.ts 新增 proposeKnowledge/updateKnowledge 封装 + 新组件 precipitate-dialog/entry-editor 导出。既有 getKnowledge/listKnowledge 签名不动。
- task-06: 无签名级变更——新组件 merge-dialog + page.tsx 操作区挂载（消费 task-04 契约）。
- task-07: 新增签名（非修改）：新类 DistillDispatchService（dispatch/list_tasks）+ 2 个新 REST 端点 + 新 DTO（DistillDispatchIn/DistillTaskRead）。消费既有 AgentRun/AgentRunWorkspace 模型与 bootstrap 创建链路（只调用不修改）。
- task-08: 无签名级变更——lib/knowledge.ts 新增 dispatchDistill/listDistillTasks（新增函数非修改）+ 新组件 distill-task-bar + precipitate-dialog 增 tab（组件内部结构，props 无对外签名变化）。
- task-09: 无签名级变更——纯验证任务（不改业务源码）。
- task-10: 无签名级变更——纯文档更新。
