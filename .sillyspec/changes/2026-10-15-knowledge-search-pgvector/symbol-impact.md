# 符号影响面报告

> tasks.md 内容指纹（生成时）: 见 CLI 骨架注——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 新增符号（KnowledgeSearchChunk/KnowledgeSearchState 两 ORM + pgvector 依赖 + 迁移模块）——纯新增无既有调用方；search.py 既有导出零改动。
- task-02: **内部签名级变更**——search_sync 从 sync 改 async def + 新增 keyword-only session_factory 参数：受影响调用点 = backend/app/modules/knowledge/router.py search 端点（task-03 范围内改 await）+ backend/app/modules/knowledge/tests/test_knowledge_search.py 既有用例 17 函数/10 处直调点（task-02 自带适配）；返回形态不变。CLI 向量端点 vector_router.py/vector_search.py 不消费 search_sync（零影响，已核）。
- task-03: 无签名级变更——router.py search 端点内部调用形态改 await（端点签名/响应模型零改动）；test_router 端点级用例无感。
- task-04: 无签名级变更——compose 镜像字符串替换。
- task-05: 无签名级变更——文档同步 + 回归验证。
