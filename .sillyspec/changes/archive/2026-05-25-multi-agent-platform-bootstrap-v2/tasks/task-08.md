---
id: task-08
title: 实现 Knowledge 与 Quicklog 展示
phase: V1
priority: P1
status: draft
owner: qinyi
estimated_hours: 8
affected_components:
  - platform-api
  - platform-web
allowed_paths:
  - backend/app/modules/knowledge/
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/
  - frontend/src/app/(dashboard)/workspaces/[id]/quicklog/
depends_on:
  - task-02
---

## 1. 目标

读取 `.sillyspec/knowledge/` 与 `.sillyspec/quicklog/`，前端展示。Knowledge 是 Workspace 级长期知识，Quicklog 是用户级快速日志。

**不在范围**：

- 向量索引（V5）
- 知识检索 API（V5）

## 2. 输入

- `references/01-sillyspec-native-layout.md` §knowledge / quicklog

## 3. 产出清单

### 3.1 解析约定

```text
.sillyspec/knowledge/
  INDEX.md
  <category>/<doc>.md     # 任意层级
  uncategorized.md

.sillyspec/quicklog/
  QUICKLOG-<user>.md      # 每用户一份
  QUICKLOG-global.md      # 全局
```

### 3.2 数据表（轻量）

```sql
CREATE TABLE knowledge_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  category VARCHAR(100),
  title VARCHAR(500),
  size_bytes BIGINT,
  last_modified_at TIMESTAMPTZ,
  UNIQUE(workspace_id, path)
);

CREATE TABLE quicklog_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_key VARCHAR(100) NOT NULL,    -- 文件名后缀，可为 'global'
  path TEXT NOT NULL,
  size_bytes BIGINT,
  last_modified_at TIMESTAMPTZ,
  UNIQUE(workspace_id, user_key)
);
```

### 3.3 API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/workspaces/{ws_id}/knowledge` | `workspace:read` | 按 category 聚合的列表 |
| GET | `/api/workspaces/{ws_id}/knowledge/raw?path=...` | `workspace:read` | 文档内容 |
| GET | `/api/workspaces/{ws_id}/quicklog` | `workspace:read` | 列出所有用户的 quicklog |
| GET | `/api/workspaces/{ws_id}/quicklog/{user_key}` | `workspace:read` | 单个 quicklog 内容 |
| POST | `/api/workspaces/{ws_id}/knowledge/reparse` | `workspace:write` | 重新扫描 |

### 3.4 前端页面

`knowledge/page.tsx`：

- 左侧树（按 category）
- 右侧 markdown 渲染
- 顶部搜索（前端 fuzzy 即可，V1 不上后端搜索）

`quicklog/page.tsx`：

- 按用户分 Tab，"全局"为默认
- markdown 渲染
- 表明"用户级日志，仅供参考"

## 4. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | fixture 含 INDEX.md + 2 个 category | 树形结构正确 |
| AC-02 | uncategorized.md | 归入"未分类" |
| AC-03 | knowledge 路径 `..` | 403 |
| AC-04 | 多用户 quicklog | Tab 切换正确 |
| AC-05 | 文档 > 500KB | 截断 + warning |
| AC-06 | 重新扫描去除已删除文档 | 索引同步 |
| AC-07 | 跨 workspace 隔离 | 验证通过 |
| AC-08 | 单测覆盖率 | ≥ 75% |
| AC-09 | 前端 fuzzy 搜索 | 200ms 内出结果 |
| AC-10 | XSS / 恶意 markdown 防护 | react-markdown sanitize |

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 知识量大导致首次扫描慢 | 分页扫描；后台异步触发，UI 显示扫描进度 |
| 文件路径中文 | utf-8 + URL encode |
| Quicklog 含敏感信息 | UI 提供"复制安全摘要"按钮（去除疑似 token） |

## 6. 完成定义

- [ ] 10 个 AC 通过
- [ ] 单测 + 截图
- [ ] `verification.md` 追加记录
- [ ] PR 合并
