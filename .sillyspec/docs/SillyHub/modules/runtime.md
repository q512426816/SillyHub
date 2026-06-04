---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# runtime
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/runtime/**

## 职责

只读读取 workspace 下 SillySpec 运行时产物（`progress.json` / SQLite / `user-inputs.md` / artifacts），向前端暴露 runtime 进度与产出信息。不做任何写入操作。

## 当前设计

```
router.py  ── HTTP 入口，挂载到 /workspaces/{workspace_id}/runtime
service.py ── RuntimeService，纯读取逻辑
schema.py  ── Pydantic DTOs（StageStep / StageProgress / RuntimeProgress / UserInputEntry / ArtifactEntry）
tests/     ── test_router.py
```

RuntimeService 通过 `WorkspaceService` 获取 workspace + spec_workspace，再利用 `SpecPathResolver` 解析文件路径。进度数据优先读 `progress.json`，若不存在则回退读 `sillyspec.db`（SQLite）。

## 对外接口（表格）

| 方法 | 路径 | 说明 | 返回类型 |
|------|------|------|----------|
| GET | `/workspaces/{workspace_id}/runtime` | 获取运行时进度 | `RuntimeProgress \| None` |
| GET | `/workspaces/{workspace_id}/runtime/user-inputs` | 获取用户输入列表 | `list[UserInputEntry]` |
| GET | `/workspaces/{workspace_id}/runtime/user-inputs/raw` | 获取原始 user-inputs.md 内容 | `PlainTextResponse` |
| GET | `/workspaces/{workspace_id}/runtime/artifacts` | 列出 artifacts 目录下的文件 | `list[ArtifactEntry]` |
| GET | `/workspaces/{workspace_id}/runtime/artifacts/{filename}` | 获取单个 artifact 文件内容 | `PlainTextResponse` |

所有端点需要认证 + `require_permission`。

## 关键数据流

1. 请求进入 `router` -> 鉴权 -> 注入 `RuntimeService`
2. `RuntimeService._get_base()` -> `WorkspaceService` 查 workspace + `spec_workspace` -> `SpecPathResolver` 解析 runtime 目录
3. 优先读取 `progress.json`；不存在时回退 `_read_sqlite_progress()` 从 SQLite 解析
4. User inputs 从 `user-inputs.md` 解析；artifacts 从 `.runtime/artifacts/` 目录扫描

## 设计决策（表格）

| 决策 | 原因 |
|------|------|
| 只读设计 | Runtime 进度由 SillySpec CLI 产出，本模块只做展示 |
| JSON + SQLite 双源 | 兼容不同版本的 SillySpec 输出格式 |
| 路径遍历防护 | artifact filename 经校验，防止目录遍历攻击 |

## 依赖关系

- `app.core.auth_deps` — require_permission
- `app.core.db` — get_session
- `app.core.logging` — get_logger
- `app.core.spec_paths` — SpecPathResolver
- `app.modules.auth.model` — User
- `app.modules.auth.permissions` — Permission
- `app.modules.spec_workspace.model` — SpecWorkspace
- `app.modules.workspace.service` — WorkspaceService

## 注意事项

- RuntimeService 不写数据库，完全依赖文件系统产物
- `_read_sqlite_progress()` 使用同步 sqlite3（适合小文件读取场景）
- 大 artifact 文件需要注意内存占用

## 变更索引（表格，初始为空）

| 变更ID | 日期 | 改动摘要 |
|--------|------|----------|
