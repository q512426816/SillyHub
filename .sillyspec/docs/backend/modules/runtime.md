---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# runtime — 运行时状态读取

> 最后更新：2026-05-31
> 最近变更：初始模块文档
> 模块路径：`app/modules/runtime/**`

## 职责

提供对 Agent 运行时状态的**只读**访问。从 `.sillyspec/.runtime/` 目录读取 `progress.json`、`user-inputs.md` 和 `artifacts/` 目录，将运行时进度、用户输入历史和产出物通过 REST API 暴露给前端。

## 当前设计（架构 + 关键逻辑）

### 架构

- **Router** — 5 个 GET 端点，挂载在 `/workspaces/{workspace_id}/` 前缀下
- **Service** — `RuntimeService`，纯只读，结合 DB 查询（SpecWorkspace）和文件系统读取

### 关键逻辑

1. **运行时目录定位**：`_resolve_runtime_dir()` 根据 SpecWorkspace 的 strategy 决定路径
   - `repo-native` 策略：使用 `spec_ws.spec_root/.sillyspec/.runtime/`
   - 其他策略：使用 `workspace.root_path/.sillyspec/.runtime/`
2. **progress.json 解析**：使用 Pydantic `RuntimeProgress` model_validate 校验 JSON 结构
3. **user-inputs.md 解析**：按行拆分，跳过空行和 `#` 注释行，每行作为一个 `UserInputEntry`
4. **artifacts 目录扫描**：遍历 `.runtime/artifacts/` 下所有文件，收集文件名、大小和修改时间
5. **路径安全**：`get_artifact_content()` 使用 resolve + startswith 防止路径穿越

## 对外接口

| 方法 | 路径 | 权限 | 响应 | 说明 |
|------|------|------|------|------|
| GET | `/workspaces/{wid}/runtime` | WORKSPACE_READ | `RuntimeProgress \| None` | 获取当前运行时进度 |
| GET | `/workspaces/{wid}/runtime/user-inputs` | WORKSPACE_READ | `list[UserInputEntry]` | 获取用户输入历史（结构化） |
| GET | `/workspaces/{wid}/runtime/user-inputs/raw` | WORKSPACE_READ | `PlainTextResponse` | 获取原始 Markdown 内容 |
| GET | `/workspaces/{wid}/runtime/artifacts` | WORKSPACE_READ | `list[ArtifactEntry]` | 列出所有产出物文件 |
| GET | `/workspaces/{wid}/runtime/artifacts/{filename}` | WORKSPACE_READ | `PlainTextResponse` | 获取单个产出物内容 |

### 数据模型（Pydantic Schema）

**RuntimeProgress**：

| 字段 | 类型 | JSON 别名 | 说明 |
|------|------|-----------|------|
| version | int | `_version` | progress.json 格式版本 |
| project | str \| None | — | 项目名称 |
| current_stage | str \| None | `currentStage` | 当前所处阶段 |
| current_change | str \| None | `currentChange` | 当前处理变更 |
| stages | dict[str, StageProgress] | — | 各阶段进度映射 |
| last_active | datetime \| None | `lastActive` | 最后活跃时间 |

**UserInputEntry**：

| 字段 | 类型 | 说明 |
|------|------|------|
| timestamp | str | 时间戳（当前为空字符串） |
| content | str | 输入内容 |

**ArtifactEntry**：

| 字段 | 类型 | 说明 |
|------|------|------|
| filename | str | 文件名 |
| size_bytes | int | 文件大小（字节） |
| last_modified | str \| None | ISO 格式修改时间 |

## 关键数据流

```
客户端 GET /runtime
  → Router (WORKSPACE_READ 权限)
    → RuntimeService.get_progress(workspace_id)
      → _get_base(workspace_id)
        → WorkspaceService.get(workspace_id)
        → DB: SELECT * FROM spec_workspaces WHERE workspace_id = ?
      → _resolve_runtime_dir()  # 根据 strategy 选择路径
      → 读取 .runtime/progress.json
      → RuntimeProgress.model_validate(raw_json)
    ← RuntimeProgress | None
```

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 只读设计 | 仅 GET | 运行时文件由 Agent 写入，后端只负责读取展示 |
| 策略感知路径 | 区分 repo-native 和其他 | repo-native 策略下 spec_root 可能与 root_path 不同 |
| 容错返回 | 文件不存在返回 None/空列表 | 避免运行时文件尚未生成时抛错 |
| 路径穿越防护 | resolve + startswith | artifacts 内容按文件名读取，必须防止目录遍历 |

## 依赖关系

- **workspace**：`WorkspaceService.get()` — 获取 workspace 的 `root_path`
- **spec_workspace**：`SpecWorkspace` model — 读取 strategy 和 spec_root 字段
- **auth**：`require_permission(Permission.WORKSPACE_READ)` — 所有端点均需读权限
- 无自有数据库表（不定义 model.py）

## 注意事项

- `RuntimeProgress` 使用 `alias` 映射 camelCase JSON 字段（`currentStage` → `current_stage`），需确保前端传递的 JSON 使用 camelCase
- `progress.json` 解析失败时返回 None 而非抛错（容错策略）
- `user-inputs` 的 timestamp 字段当前未从文件中提取（始终为空字符串），未来可能需要改进解析逻辑
- artifacts 内容以 `PlainTextResponse` 返回，对二进制文件会使用 `errors="replace"` 替换不可解码字节

## 变更索引

| 日期 | 变更 |
|------|------|
| 2026-05-27 | 初始实现：runtime 只读 API |
| 2026-05-31 | 文档归档 |
