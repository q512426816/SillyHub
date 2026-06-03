---
id: task-05
title: 实现 Change 解析与变更中心
phase: V1
priority: P0
status: draft
owner: qinyi
estimated_hours: 18
affected_components:
  - platform-api
  - platform-web
allowed_paths:
  - backend/app/modules/change/
  - backend/migrations/versions/
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/
depends_on:
  - task-02
blocks:
  - task-06
  - task-12
  - task-13
---

## 1. 目标

读取 `changes/change/*` 与 `changes/archive/*`，每个目录视为一个 Change，建立 `changes` 与 `change_documents` 表数据，前端展示"变更中心"与"变更详情"。

**不在范围**：

- task 解析（task-06）
- 平台写入 Change（task-12）
- 状态机与审批（task-13）

## 2. 输入

- `requirements.md` FR-004
- `references/02-lifecycle-from-requirement-to-deployment.md`
- `references/03-domain-model.md` §3.5 / 3.6
- `references/12-frontmatter-schema.md` §Change
- `references/17-db-schema.md` §2.4

## 3. 产出清单

### 3.1 解析约定

每个 Change 目录名作为 `change_key`，例如 `2026-05-25-silly-query-enhancement`。

期望文件：

```text
MASTER.md
proposal.md
requirements.md
design.md
plan.md
tasks.md
verification.md
tasks/                 # 不在本 task 范围（task-06 处理）
references/            # 任意附件
prototype-*.html       # 可选原型
```

`MASTER.md` 头部 frontmatter 期望字段：

```yaml
---
id: 2026-05-25-xxx
title: ...
status: draft / in_progress / reviewing / approved / merged / archived
change_type: feature / bugfix / hotfix / docs / refactor
owner: <user_key>
affected_components: [comp-a, comp-b]
---
```

### 3.2 数据表

- `changes`
- `change_documents`

（按 17-db-schema.md §2.4）

### 3.3 后端模块

```text
backend/app/modules/change/
├─ __init__.py
├─ router.py
├─ service.py
├─ parser.py         # 目录扫描 + frontmatter 提取
├─ schema.py
├─ model.py
└─ tests/
   ├─ test_parser.py
   ├─ test_service.py
   └─ fixtures/
      └─ changes/
         ├─ change/
         │  └─ 2026-05-25-demo-feature/{MASTER.md, proposal.md, ...}
         └─ archive/
            └─ 2026-05-21-demo-archived/{MASTER.md, ...}
```

### 3.4 API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/workspaces/{ws_id}/changes` | `change:read` | 列表，query: `?location=active/archive&status=&owner=` |
| GET | `/api/workspaces/{ws_id}/changes/{cid}` | `change:read` | 详情 |
| GET | `/api/workspaces/{ws_id}/changes/{cid}/documents/{doc_type}` | `change:read` | 单文档内容 |
| GET | `/api/workspaces/{ws_id}/changes/{cid}/documents` | `change:read` | 文档存在性矩阵 |
| POST | `/api/workspaces/{ws_id}/changes/reparse` | `change:read` | 重新扫描 changes/* |

文档矩阵响应：

```json
{
  "change_id": "...",
  "documents": [
    {"doc_type": "MASTER", "exists": true, "path": "...", "status": "approved"},
    {"doc_type": "proposal", "exists": true, ...},
    {"doc_type": "requirements", "exists": false, ...},
    ...
  ],
  "prototypes": ["prototype-search-ui.html"],
  "references": ["01-foo.md"]
}
```

### 3.5 解析规则

| 检查 | 行为 |
|---|---|
| 目录不在 change/ 或 archive/ 下 | 忽略 |
| 缺 MASTER.md | 仍入库，status='unknown'，warning |
| frontmatter 解析失败 | 仍入库，warning |
| affected_components 引用不存在 component | 入库 + warning |
| location 与目录位置不符（archive 但 status=in_progress） | 不报错，UI 给出冲突提示 |

### 3.6 前端页面

**变更中心** `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx`：

- 两个 Tab：进行中 / 已归档
- 表格列：change_key / title / change_type / owner / affected_components / 文档完整度（7 个 doc 中存在数）/ 更新时间
- 过滤器：status、change_type、owner、关键词

**变更详情** `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`：

- 顶部 banner：title / status badge / owner / affected_components
- Tabs：MASTER / Proposal / Requirements / Design / Plan / Tasks / Verification / Prototypes / References
- 每个 Tab 渲染 markdown
- 缺失文档显示空状态 + "去 SillySpec 创建" 提示

## 4. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | fixture 包含 1 active + 1 archive | 列表分别在两个 Tab |
| AC-02 | active 目录但 status=archived | UI 显示警告徽章 |
| AC-03 | 缺 requirements.md | `exists=false`，UI 显示灰色 |
| AC-04 | MASTER frontmatter 解析含 owner 不存在 | 入库成功 + warning |
| AC-05 | 列表按 owner 过滤 | 只返回匹配项 |
| AC-06 | 详情 Tab 切换无重新 fetch | 一次拉全部 documents 矩阵 |
| AC-07 | 原型 prototype-*.html 在 References Tab 可下载 | 文件存在性正确 |
| AC-08 | 跨 workspace 不串数据 | 隔离生效 |
| AC-09 | 单测覆盖率 | ≥ 80% |
| AC-10 | 重新扫描 200 个 change 目录 | < 2s |

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| frontmatter 格式不统一 | 解析失败 | 用 python-frontmatter 库，失败时降级取目录名作 title |
| Markdown 内引用相对路径图片 | 前端 404 | API 增加 `/raw?path=...` 端点，受 workspace 路径限制 |
| change_key 含特殊字符 | URL 解析错 | URL 编码 + 不允许 `..` |
| archive 文件被 git mv 后 mtime 失真 | 排序错 | 兼容 `archived_at` frontmatter 字段 |
| 同名 change_key 出现在 change/ 和 archive/ | 数据库冲突 | UNIQUE(workspace_id, change_key)；冲突时以 archive 为准 |

## 6. 完成定义

- [ ] 10 个 AC 通过
- [ ] 单测 + 详情页截图
- [ ] `verification.md` 追加 task-05 记录
- [ ] PR 合并
