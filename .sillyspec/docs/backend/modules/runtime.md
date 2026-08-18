---
schema_version: 1
doc_type: module-card
module_id: runtime
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 运行时状态投影（runtime）

## 定位
工作区运行时状态的只读投影层（无 model / 无表）：从 spec 树的 `sillyspec.db`（SQLite，SillySpec v4 权威状态源）、`user-inputs.md`、`artifacts/` 三处读数据，供前端运行面板展示。本模块永不写——状态由 SillySpec CLI 写入文件、daemon spec-sync 同步到服务器可读路径。

## 契约摘要
- `GET /api/workspaces/{workspace_id}/runtime` → `RuntimeProgress | None`：最近活跃 change 的阶段/步骤进度（读 sillyspec.db，无数据返回 null）。
- `GET .../runtime/user-inputs` → `list[UserInputEntry]`；`GET .../runtime/user-inputs/raw` → `text/plain` 纯文本（user-inputs.md 原文，空返空串）。
- `GET .../runtime/artifacts` → `list[ArtifactEntry]`（目录条目含大小/mtime）；`GET .../runtime/artifacts/{filename}` → `text/plain` 内容（`errors="replace"` 容错解码）。
- 五端点统一 `require_permission(Permission.RUNTIME_READ)`。
- `RuntimeService(session, workspace_service=None, host_fs=None)`：`host_fs` 注入 `HostFsDelegate` 时全部文件访问走 daemon WS RPC；`None`（默认/旧测试）回落容器 Path 直读。

## 关键逻辑
```
resolver = SpecPathResolver(spec_ws.spec_root, platform_managed=True)
          # 无 spec_ws/spec_root → None → 「无运行时数据」降级（不抛错）
progress: sqlite3.connect("file:<db>?mode=ro", uri=True) 直读 sillyspec.db
          最近活跃 change → 映射 RuntimeProgress/StageProgress/StageStep
          整段包 asyncio.to_thread（同步 IO 不进事件循环）
文本/目录: host_fs 有 → delegate.stat/read_file/list_dir（WS RPC）
          无 → 容器 Path 直读（同样 to_thread 移出事件循环）
```

## 注意事项
- sillyspec.db 刻意保持 `sqlite3` 只读直连而非走 HostFsDelegate：delegate 的 `read_file` 返 `str`，传不了二进制 SQLite 文件。这意味着 **db 必须在服务器容器可达路径**（daemon spec-sync 产物）——换存储方案时此处要跟着动。
- `_resolver_for` 是 2026-07-10 remove-server-local-workspace-mode（D-005/D-007）后的形态：所有 workspace 恒 daemon-client、恒 `platform_managed=True` 扁盘布局（`.runtime/` 直接在 spec_root 下）；不要恢复旧的双模式判定。
- `_read_text` 统一了 user-inputs 与 artifact 内容读取两条路（host_fs / 容器直读），`errors` 语义：user-inputs 严格、artifact replace——改的时候别合并成一种。
- 前端拿不到数据（null / 空列表）通常不是本模块 bug，而是 daemon spec-sync 没把 `.runtime/` 推上来或 spec_root 未解析——排查方向在 daemon 侧。
- 事件循环纪律：所有同步 FS / sqlite 调用都已在 to_thread 内（性能 change Wave 2/S1-4 + Wave C），新增读取路径保持同样包裹。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
