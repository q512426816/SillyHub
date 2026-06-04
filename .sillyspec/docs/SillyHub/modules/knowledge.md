---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# knowledge
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/knowledge/**

## 职责

knowledge 模块是 SillySpec 文档的只读查询层，负责：

- **Knowledge 查询**：读取 workspace 下的 `.sillyspec/docs/` 知识库文档
- **Quicklog 查询**：读取 workspace 下的 `.sillyspec/quicklog/` 快速日志
- **Markdown 解析**：从 .md 文件中提取标题（第一个 `#` 行）和内容
- **路径安全**：防止路径穿越攻击（如 `../`）

## 当前设计

```
router.py              HTTP 入口，4 个端点（全部只读）
  |
service.py             KnowledgeService — 核心业务逻辑
  |                      - list_knowledge()    列出知识库条目
  |                      - get_knowledge()     获取单条知识（含完整内容）
  |                      - list_quicklog()     列出快速日志
  |                      - get_quicklog()      获取单条日志（含完整内容）
  |
parser.py              Markdown 解析器
  |                      - parse_md_directory()  递归解析 .md 文件目录
  |                      - KnowledgeParser       封装类（knowledge/quicklog 路径）
  |                      - _extract_title()      从内容提取第一个 # 标题
  |                      - _read_file_safe()     安全读取文件（捕获编码错误）
schema.py              响应 schema（KnowledgeEntry/List, QuicklogEntry/List）
```

### 文件系统布局

```
<sillyspec_root>/
  ├── docs/              ← knowledge 数据源
  │     ├── foo.md
  │     └── bar.md
  └── quicklog/          ← quicklog 数据源
        ├── 2026-01-01.md
        └── 2026-01-02.md
```

### 解析流程

1. `KnowledgeParser` 根据类型确定子目录（`docs/` 或 `quicklog/`）
2. `parse_md_directory()` 递归扫描 `.md` 文件
3. `_extract_title()` 从内容中提取第一个 `#` 标题行
4. `_read_file_safe()` 处理文件读取（跳过编码错误）
5. 列表接口不含内容字段（`include_content=False`），详情接口包含

### 路径安全

- 验证 workspace 目录存在（通过 `WorkspaceService`）
- `filename` 参数防止路径穿越（`../`）

## 对外接口

| 方法 | 路径 | 说明 | 认证/权限 |
|------|------|------|-----------|
| GET | `/workspaces/{workspace_id}/knowledge` | 列出知识库条目（不含内容） | require_permission(WORKSPACE_READ) |
| GET | `/workspaces/{workspace_id}/knowledge/{filename}` | 获取单条知识详情 | require_permission(WORKSPACE_READ) |
| GET | `/workspaces/{workspace_id}/quicklog` | 列出快速日志（不含内容） | require_permission(WORKSPACE_READ) |
| GET | `/workspaces/{workspace_id}/quicklog/{filename}` | 获取单条日志详情 | require_permission(WORKSPACE_READ) |

## 关键数据流

```
Client → GET /workspaces/{ws_id}/knowledge
  → KnowledgeService.list_knowledge(workspace_id)
  → WorkspaceService 验证 workspace 存在
  → 确定 sillyspec_root 路径
  → KnowledgeParser.parse_knowledge(sillyspec_root)
  → parse_md_directory(docs_dir, ...)
  → 返回 KnowledgeList（entries 不含 content）

Client → GET /workspaces/{ws_id}/knowledge/{filename}
  → KnowledgeService.get_knowledge(workspace_id, filename)
  → 同上路径解析
  → 返回 KnowledgeEntry（含 content）
```

## 设计决策

| 决策 | 原因 |
|------|------|
| 纯只读模块 | 知识库文件由 SillySpec 工具链写入，API 不负责创建/修改 |
| 列表不含内容 | 减少 API 响应体大小，列表页只需标题和元信息 |
| 独立 parser 模块 | 解析逻辑可复用，与 HTTP 层解耦 |
| 路径穿越防护 | 防止恶意 filename 参数访问非预期文件 |
| 通过 WorkspaceService 验证 workspace | 确保路径合法，复用已有的 workspace 查找逻辑 |

## 依赖关系

### 内部依赖

- `app.core.auth_deps` — require_permission
- `app.core.db` — get_session
- `app.core.errors` — WorkspaceNotFound（延迟导入）
- `app.modules.auth.model` — User
- `app.modules.auth.permissions` — Permission
- `app.modules.workspace.service` — WorkspaceService

### 外部依赖

- 无特殊外部依赖（纯文件系统操作）

## 注意事项

- 该模块没有数据库模型（model.py），完全基于文件系统读取
- 没有 `__init__.py` 中导出 model（因为不存在）
- 如果 workspace 目录下没有 `docs/` 或 `quicklog/` 子目录，返回空列表
- `_read_file_safe()` 在遇到编码错误时返回 `(空字符串, False)` 而非抛异常
- 路由前缀为 `/workspaces/{workspace_id}`，与其他模块（incident、release）保持一致

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| | | （初始生成，暂无变更记录） |
