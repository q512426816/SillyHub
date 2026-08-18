---
schema_version: 1
doc_type: module-card
module_id: runtime
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 运行时进度读取（runtime）

## 定位
后端「SillySpec 运行时进度」只读读取器：把工作区 spec 根目录下 `.runtime/` 的状态文件翻译成结构化 API（阶段/步骤进度、用户输入、产出物），供前端实时展示执行情况。不执行 SillySpec、不写状态、不落任何库（无 model.py）。

## 契约摘要
- 路由（prefix=/workspaces/{wid}，tag=runtime，全部 `RUNTIME_READ` 权限）：
  - `GET /runtime` 进度总览，返回 `RuntimeProgress | None`（version=4）
  - `GET /runtime/user-inputs` 结构化用户输入列表（`UserInputEntry`）
  - `GET /runtime/user-inputs/raw` 原始全文（PlainTextResponse）
  - `GET /runtime/artifacts` 产出物列表（`ArtifactEntry`）
  - `GET /runtime/artifacts/{filename}` 单个产出物内容
- `RuntimeService(session, *, workspace_service=None, host_fs=None)`：
  - `get_progress`：`sqlite3.connect("file:...?mode=ro", uri=True)` 只读打开 `sillyspec.db`，按序查 `changes`（last_active 最近活跃一条）→ `project` → `stages` → `steps`，组装 `RuntimeProgress(stages: dict[str, StageProgress])`
  - `get_user_inputs` / `get_user_inputs_raw`：读 `user-inputs.md`；结构化版逐行解析（跳过空行与 `#` 标题行）
  - `get_artifacts` / `get_artifact_content`：遍历 `artifacts/` 目录；读内容前做路径越界校验（resolve 后必须仍在 artifacts 目录内，否则返回 None）
  - `_resolver_for` / `_resolve_runtime_dir` / `_get_base` / `_parse_dt` 内部辅助
- schema 仅响应 DTO：RuntimeProgress / StageProgress / StageStep / UserInputEntry / ArtifactEntry

## 关键逻辑
```
_get_base → spec_ws.spec_root 存在?
  否 → 返回 None/[]（该工作区无运行时数据，不报错）
  是 → SpecPathResolver(root=spec_root, platform_managed=True)  # 恒扁平布局
get_progress: db 文件存在 → asyncio.to_thread(sqlite 只读直读 changes/stages/steps)
文件读取（user-inputs / artifacts）:
  host_fs 注入 → delegate.stat / read_file 走 WS RPC（daemon-client 工作区）
  未注入 → 容器 Path 直读（同样 to_thread 移出事件循环）
```

## 注意事项
- 所有 workspace 恒为 daemon-client（`workspaces.path_source` 列已删，2026-07-10 change）：root 强制取 `spec_ws.spec_root`（服务器可读路径）且 `platform_managed=True`；无 spec_ws 或 spec_root 时各方法返回 None/[]
- sqlite 读取刻意不走 HostFsDelegate：delegate 的 read_file 返 str，传不了二进制 db 文件，且容器对 spec_root 直读可达（源码 task-12/task-16 注释）；连接必须 `mode=ro`，防锁 CLI 写入
- HostFsDelegate 注入时 `stat` 不返 mtime（契约只有 exists/is_dir/size），ArtifactEntry 的 last_modified 退化为 None
- `sillyspec.db` 表结构由 SillySpec CLI 主导，CLI 升级改表后本模块的 SQL 需同步适配
- sqlite 直读与本地文件遍历均已 `asyncio.to_thread` 包裹（perf-remediation），同步 IO 不再阻塞事件循环
- `_read_text` 的 errors 语义分叉：user-inputs 用 strict（坏编码 UnicodeDecodeError 会向上传播）、artifact 内容用 replace（替换字符容错）——仅作用于容器直读分支，delegate 返的是已解码 str

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
