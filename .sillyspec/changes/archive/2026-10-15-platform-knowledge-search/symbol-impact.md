# 符号影响面报告

> tasks.md 内容指纹（生成时）: ad13ac1b5838240f——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——新增模块 NEW:backend/app/modules/knowledge/search.py（全新符号 scan_corpus/corpus_fingerprint/search_sync/Chunk，无既有调用方）；不修改 vector_search.py/vector_router.py 任何既有签名（已核 backend/app/modules/knowledge/vector_search.py 现有导出面零改动）。
- task-02: 无破坏性签名级变更——新增 schema 符号 KnowledgeSearchIn/KnowledgeSearchResultItem/KnowledgeSearchOut 与新增端点 POST /knowledge/search；既有 KnowledgeEntry/KnowledgeList 等 schema 与既有端点签名零改动（新增符号受 task-03/task-05 消费，字段级契约见 TaskCard provides/expects_from）。
- task-03: 无签名级变更——frontend/src/lib/knowledge.ts 新增导出 searchKnowledge（纯新增，既有导出零改动）；knowledge/page.tsx 为页面组件内部改动（无对外 props 变更）；既有测试文件为扩展（不改既有断言）。
- task-04: 无签名级变更——scan-docs/page.tsx 页面组件内部改动（新增 useSearchParams 读取与选中 effect，无对外 props）；既有 requestDoc/selectDoc 内部函数复用不改签名；测试扩展。
- task-05: 无签名级变更——纯生成物刷新（backend/openapi.json + frontend/src/lib/api-types.ts + sillyhub-daemon/src/api-types.ts），仅追加新端点与新 schema 类型，既有类型定义不变。
