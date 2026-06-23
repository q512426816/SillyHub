---
schema_version: 1
doc_type: module-card
module_id: runtime
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:33
---
# runtime

## 定位
后端「SillySpec 运行时进度」功能域：以只读方式读取工作区 `.sillyspec/.runtime/` 状态文件，对外暴露 SillySpec 工具的执行进度（阶段 stages）、用户输入快照、产出物（artifacts）。它不执行 SillySpec，只把本地 CLI 产出的状态翻译成结构化 API，供前端实时展示执行情况。

## 契约摘要
- API（prefix=/workspaces/{workspace_id}, tag=runtime）：`GET /runtime`（进度总览，含各阶段）、`GET /runtime/user-inputs`（结构化用户输入列表）、`GET /runtime/user-inputs/raw`（原始文本）、`GET /runtime/artifacts`（产出物列表）、`GET /runtime/artifacts/{filename}`（单个产出物内容）。
- `RuntimeService`：`get_progress / get_user_inputs / get_user_inputs_raw / get_artifacts / get_artifact_content`；`_resolve_runtime_dir`（经 SpecPathResolver 定位 `.runtime/`）、`_read_sqlite_progress`（只读模式打开 `sillyspec.db`）、`_get_base`、`_parse_dt`。
- 进度数据源：SillySpec v4 的权威状态在 `.sillyspec/.runtime/sillyspec.db`（SQLite），通过 `sqlite3` 以 `mode=ro` 只读连接读取 active change 及其 stages；用户输入与产出物仍是文件形态（`.runtime/` 下文件）。

## 关键逻辑
```
get_progress(ws) → _resolve_runtime_dir → sillyspec.db 存在?
  → _read_sqlite_progress: mode=ro 打开 → 查最近 active change + stages 表
  → 映射为 RuntimeProgress(stages: {name: StageProgress})
get_user_inputs → 读 .runtime 用户输入文件 → _parse_dt → list[UserInputEntry]
get_artifacts → 扫描 .runtime 产出物 → get_artifact_content 读单个正文
```

## 注意事项
- SQLite 连接必须 `mode=ro`（只读 URI），避免后端锁住 SillySpec CLI 的写入或反向破坏状态。
- SillySpec CLI 与本模块共享 `sillyspec.db`，schema 由 CLI 主导；CLI 升级表结构后本模块查询需同步适配（见 memory：verify 阶段 transition bug 记录的表结构）。
- 本模块无 model.py（不持久化），schema 仅定义响应 DTO（RuntimeProgress/StageProgress/UserInputEntry/ArtifactEntry）。
- `.runtime` 目录不存在时 `get_progress` 返回 None 而非报错（工作区尚未跑过 SillySpec）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
