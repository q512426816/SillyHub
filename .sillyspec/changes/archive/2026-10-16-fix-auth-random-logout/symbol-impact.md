# 符号影响面报告

> tasks.md 内容指纹（生成时）: c6b70fd7dc37eaf5——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 数据结构变更（Session 模型加可选列 family_id，SQLModel 构造向后兼容）。SessionRow 构造点 3 处：backend/app/modules/auth/service.py（本域）、backend/tests/modules/auth/test_refresh_grace_window.py 与 backend/tests/modules/auth/test_refresh_token_index.py（均在各 task allowed_paths 内）；可选列默认 None，无破坏性签名变更，无越界调用点。
- task-02: 签名级变更 1 处——私有方法 `_issue_token_pair` 新增可选参数 family_id（默认 None）：调用点仅 backend/app/modules/auth/service.py:168（login）与 backend/app/modules/auth/service.py:201（refresh），同文件任务内同步，无跨模块调用点；新增 `_revoke_session_family` 为全新方法无既有调用方。配置默认值变更（60→300）命中既有断言 backend/app/core/tests/test_config_auth.py:26-28（test_default_is_60）——符号影响扫描发现后已补录 task-02 allowed_paths + target_files + related_tests，无越界调用点；其余边界用例（env 120/0/-1/601/600）不受影响。
- task-03: 无签名级变更（`ensureFreshAccessToken` 签名与返回类型不变）。`doRefresh` 为模块私有函数，本次改其「非 2xx 处理契约」（5xx/408/429 抛错、4xx 返 null）——13 处消费点行为已在 task-03 验收的调用点审计内；既有前端测试基于 401 断言（仍返 null）与 2xx 成功路径，不受影响，无需补 related_tests。
- task-04: 无签名级变更（纯文档 `.sillyspec/docs/multi-agent-platform/flows/auth-flow.md` 同步，不触代码符号）。
