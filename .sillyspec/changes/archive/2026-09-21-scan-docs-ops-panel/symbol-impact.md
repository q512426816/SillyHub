# 符号影响面报告

> tasks.md 内容指纹（生成时）: b4fee14bc37e93a7——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 新增签名级符号（纯增量，无既有签名修改）：ScanDocsService.stats(workspace_id) 新方法、router 新增 get_scan_docs_stats 端点函数、schema 新增 9 个 DTO 类——既有 list_/get/reparse/_apply_parsed/_fetch_existing 签名零改动（quick 已改部分属本会话另一变更）；消费方仅前端（经 OpenAPI 生成类型，task-02 覆盖）与自身测试（NEW test_stats.py 在范围内）。跨模块只读引用 KnowledgeHit（SELECT），无其模块符号修改。
- task-02: 新增 API client 函数 getScanDocsStats + 查询键 scanDocsStatsQueryKey（frontend/src/lib/scan-docs.ts 纯增量，既有 listScanDocs/getScanDoc/reparseScanDocs 签名零改动）；api-types.ts/openapi.json 为生成产物覆盖（无手写签名）。调用点=task-03 面板组件（在范围内）。
- task-03: 无既有签名级变更：新增组件 ScanDocsStatsPanel（新符号）+ page.tsx 挂载一行（PageHeader 组件 props 不变）。page.tsx 本会话 quick 已改（DocTree expandAll 等属 ql-20260921-003），本 task 只追加面板挂载与 mock。既有测试断言可能受挂载影响——scan-docs-page.test.tsx 已在 allowed_paths（补 stats mock）。
- task-04: sillyspec 仓（跨仓卡）：prompt.js/execute.js 注入函数签名零改动，仅在命中分支内追加 appendKnowledgeHit 调用（appendKnowledgeHit 底座签名不变）；新符号=无（遥测行为内联）。调用点扫描：appendKnowledgeHit 现有 6 处调用方（stage-contract/archive-distill/execute/run-shared/knowledge-classify）均不受影响。
- task-05: 无签名级变更：仅模块文档三份（md 文档）+ 跑回归测试，不触碰任何代码符号。
