# 符号影响面报告

> tasks.md 内容指纹（生成时）: d77efefb31e9402e——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。

- task-01: 签名级变更=vector_search.py `get_embedder(model_name) -> tuple[object|None, str|None]` 返回类型语义变化（FastembedEmbedder 实例 → EmbeddingSubprocessProxy 实例，签名与 Tuple 形状不变，调用方 duck-typing 零改动——knowledge/search.py:510 与 vector_search.py search_sync 两处调用点均在兼容面内，代理 embed(texts) 同签名）；新增符号 EmbeddingSubprocessProxy/FastembedWorker 入口（新文件）；Settings 新增 2 字段（可选带默认，无破坏）。均在任务范围内。
- task-02: 无签名级变更（_bundle_gzip_cache 模块级 dict 的 put/get 内部加帽逻辑，函数签名不动；Settings 加 1 可选字段）。
- task-03: 无签名级变更（_on_timeout 内部改用 session_factory 新会话，方法签名/返回不变；enqueue_and_push 内部事务时序调整，签名不变；调用点 gateway_misc.py:560-565 零改动）。
- task-04: 无签名级变更（send_rpc/resolve_rpc/disconnect 三方法签名不动，仅内部补清理与身份校验；调用点遍布 daemon RPC 族，行为兼容——清理只影响已死条目）。
- task-05: 无签名级变更（router.py 上传端点内部预检；gateway_misc.py 日志语句内截断 helper——新增模块级 `_truncate_for_log` 私有函数）。
- task-06: 签名级变更=ws_hub 新增公共方法 `notify_change_write_available(session, runtime_id) -> None`（新增非改）；protocol.py 新增常量 DAEMON_MSG_CHANGE_WRITE_AVAILABLE 与 payload TypedDict（新增）；四处调用点接线（change/service.py、change_writer/proxy.py、spec_workspace/router.py ×2 处 commit 点）均在任务范围内。
- task-07: 签名级变更=protocol.ts 新增 MSG.CHANGE_WRITE_AVAILABLE 常量与 ChangeWriteAvailablePayload 类型（新增非改，双端对齐 task-06）；config.ts DaemonConfig 接口新增 `change_write_poll_interval: number`（带默认 120，构造点 config 默认对象补键——旧配置文件缺键走默认，向后兼容）；daemon.ts _pollLoop 内部分支改用新配置（签名不变）。
- task-08: 签名级变更=AgentSession 模型新增列 title_fallback（SQLModel table 列，新增非改；AgentSessionRead 响应 DTO 不加字段——title 复用既有字段，响应形状零变化）；session_crud.py list_sessions 内部组装逻辑（签名不变）；新迁移 revision 20261016100000（down_revision 接当前 head，execute 时以 alembic heads 实测为准）。
- task-09: 无签名级变更（compose YAML 值调整 + entrypoint shell 加兜底段 + skill md 文档）。
- task-10: 无签名级变更（部署与实测，无代码符号改动）。
