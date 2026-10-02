# 符号影响面报告

> tasks.md 内容指纹（生成时）: 010cfce9b08bb22d——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 接口级 additive 变更：SillySpecAuditRow 增可选字段 cross_repo?: string | null；新增导出接口 SillySpecAuditRepoAnchor/SillySpecAuditRepoTotals/SillySpecAuditRepo；SillySpecAuditTable 增 repos: SillySpecAuditRepo[] | null；auditTable() 方法签名不变（返回结构增量）。受影响调用点：①RPC handler（daemon.ts sillyspec_scope_audit 注册处）对 result 直接 JSON 序列化透传，无逐字段 TS 消费——零改动；②tests/sillyspec-file-diff.test.ts 既有断言用 toEqual 逐字段比对（result.rows[0] toEqual）——新字段 cross_repo: null 需既有断言同步（该文件在任务 allowed_paths 内）。均在任务范围内。
- task-02: DTO 字段增量：ScopeAuditRow 增 cross_repo: str | None；新增 pydantic 类 ScopeAuditRepoAnchor/ScopeAuditRepoTotals/ScopeAuditRepo；ScopeAuditResponse 增 repos: list[ScopeAuditRepo] = []；get_scope_audit() 方法签名不变。受影响调用点：①router 层（change/router.py scope-audit 端点）直接返回 ScopeAuditResponse——序列化自动含新字段，零改动；②OpenAPI 生成物链（backend/openapi.json → frontend/src/lib/api-types.ts）——task-03 范围内消费。均在任务范围内。
- task-03: 组件内部变更：ScopeAuditCommandCardProps 导出接口不变（target 复用）；内部新增分组渲染分支与分桶 helper（不导出）；api-types.ts 为生成物类型增量（components.schemas.ScopeAuditRow.cross_repo / ScopeAuditResponse.repos / ScopeAuditRepo 族）。受影响调用点：①mobile-change-detail.tsx 与 quicklog-drawer.tsx import 复用卡片（props 不变零改动，仅回归测试）；②lib/changes.ts 的 ScopeAuditRow 类型别名自动跟随生成物。除两回归测试文件（已在 allowed_paths，只跑不改为主）外无范围外调用点。
