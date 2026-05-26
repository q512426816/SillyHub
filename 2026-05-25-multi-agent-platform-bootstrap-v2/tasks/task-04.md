---
id: task-04
title: 实现 scan docs 解析与展示
phase: V1
priority: P0
status: draft
owner: qinyi
estimated_hours: 10
affected_components:
  - platform-api
  - platform-web
allowed_paths:
  - backend/app/modules/scan_docs/
  - backend/migrations/versions/
  - frontend/src/app/(dashboard)/workspaces/[id]/components/[cid]/scan/
depends_on:
  - task-03
blocks:
  - task-14
---

## 1. 目标

按组件读取 `.sillyspec/docs/{component}/scan/*.md`，入库并在组件详情页展示。这些文档将作为 V4 Agent 上下文构建的素材来源。

**不在范围**：

- Agent 上下文实际注入（task-14）
- 知识库展示（task-08）

## 2. 输入

- `requirements.md` FR-003
- `references/03-domain-model.md` §3.4
- `references/17-db-schema.md` §2.3 `scan_documents`

## 3. 产出清单

### 3.1 解析目录约定

```text
.sillyspec/docs/{component_key}/scan/
  ARCHITECTURE.md
  CONVENTIONS.md
  CONCERNS.md
  INTEGRATIONS.md
  PROJECT.md
  STRUCTURE.md
  TESTING.md
```

doc_type 取上述 7 种 + `OTHER`（任意其他 `.md` 文件）。`component_key` 必须能在 `project_components` 表里找到对应记录。

### 3.2 后端模块

```text
backend/app/modules/scan_docs/
├─ __init__.py
├─ router.py
├─ service.py
├─ parser.py
├─ schema.py
├─ model.py
└─ tests/
   ├─ test_parser.py
   └─ fixtures/
      └─ docs/
         ├─ silly/scan/{ARCHITECTURE.md, STRUCTURE.md}
         └─ silly-admin-ui/scan/{CONVENTIONS.md}
```

### 3.3 API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/workspaces/{ws_id}/components/{cid}/scan-docs` | `component:read` | 列出组件的扫描文档 |
| GET | `/api/workspaces/{ws_id}/components/{cid}/scan-docs/{doc_type}` | `component:read` | 单个文档内容（含 markdown） |
| POST | `/api/workspaces/{ws_id}/scan-docs/reparse` | `component:write` | 重新解析所有组件扫描文档 |

GET 内容响应：

```json
{
  "component_id": "...",
  "doc_type": "ARCHITECTURE",
  "path": ".sillyspec/docs/silly/scan/ARCHITECTURE.md",
  "title": "Silly 后端架构",
  "content": "# ...",
  "last_modified_at": "2026-05-20T..."
}
```

### 3.4 解析规则

| 检查 | 行为 |
|---|---|
| `docs/{key}` 目录不存在 | component 标记缺 scan，warning |
| 缺单个标准 doc_type | 该 doc_type 行 `exists=false` |
| 非标准 `.md` 文件 | doc_type=`OTHER`，name=文件名 |
| 内容 size > 1MB | 截断到 1MB + warning |
| 首行 `# 标题` | 抽取为 `title` |

### 3.5 前端页面

`frontend/src/app/(dashboard)/workspaces/[id]/components/[cid]/scan/page.tsx`：

- 左侧导航：7 个标准 doc_type（缺失的灰显）+ OTHER 组
- 右侧 markdown 渲染（用 react-markdown + rehype-highlight）
- 顶部 "重新解析" 按钮
- 缺失项显示提示 "未提供 X.md"

## 4. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | fixture：silly 有 ARCHITECTURE + STRUCTURE | 列表 7 项中 2 项 exists=true、5 项 exists=false |
| AC-02 | 不存在 `docs/{key}` 目录 | API 返回空列表 + warning |
| AC-03 | 内容含中文、代码块、表格 | 前端渲染正确，代码高亮 |
| AC-04 | OTHER 类型自定义 `.md` | 列在 OTHER 分组 |
| AC-05 | 文件 > 1MB | 截断，warning 含 `truncated_size` |
| AC-06 | 重新解析时 doc 更新 | last_modified_at 变化 |
| AC-07 | 单测覆盖率 | ≥ 80% |
| AC-08 | 跨组件不串数据 | A 组件不能查到 B 组件的 scan doc |
| AC-09 | 没权限的用户 GET | 403 |
| AC-10 | 前端缺失文档显示灰色 + 提示 | 截图 |

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 大文件内存爆 | OOM | 流式读取 + size 检查 |
| Markdown XSS | 前端注入 | react-markdown 默认 sanitize，禁用 rawHtml |
| 文件路径含 `..` | 越界 | 解析时 `Path.resolve()` 后必须在 sillyspec 根下 |
| 同名不同大小写文件（Windows vs Linux） | 重复入库 | 统一 lower-case doc_type |

## 6. 完成定义

- [ ] 10 个 AC 通过
- [ ] 单测 + 前端截图
- [ ] `verification.md` 追加 task-04 记录
- [ ] PR 合并
