---
id: task-06
title: 实现 Task 解析与任务看板
phase: V1
priority: P0
status: draft
owner: qinyi
estimated_hours: 16
affected_components:
  - platform-api
  - platform-web
allowed_paths:
  - backend/app/modules/task/
  - backend/migrations/versions/
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/tasks/
depends_on:
  - task-05
blocks:
  - task-13
  - task-14
---

## 1. 目标

读取 `changes/change/{change_id}/tasks.md` 与 `tasks/task-xx.md`，建立 `tasks` 表数据，前端展示任务看板与任务详情。

**不在范围**：

- 任务状态机（task-13）
- Agent 执行任务（task-14）

## 2. 输入

- `requirements.md` FR-005
- `references/03-domain-model.md` §3.7
- `references/12-frontmatter-schema.md` §Task
- `references/17-db-schema.md` §2.4 `tasks`

## 3. 产出清单

### 3.1 解析约定

来源：

- `changes/change/{cid}/tasks.md` — 总表 markdown（可能含 table）
- `changes/change/{cid}/tasks/task-{NN}.md` — 详情，含 frontmatter

期望 frontmatter（参考 task-01.md 改写后的样子）：

```yaml
---
id: task-01
title: ...
phase: V1
priority: P0
status: draft / ready / in_progress / review / done / cancelled
owner: <user_key>
estimated_hours: 16
affected_components: [...]
allowed_paths: [...]
depends_on: [task-xx]
blocks: [task-yy]
---
```

### 3.2 数据表

按 17-db-schema.md §2.4 `tasks`。本 task 额外需要：

```sql
ALTER TABLE tasks ADD COLUMN depends_on JSONB DEFAULT '[]'::jsonb;
ALTER TABLE tasks ADD COLUMN blocks JSONB DEFAULT '[]'::jsonb;
ALTER TABLE tasks ADD COLUMN phase VARCHAR(20);
```

### 3.3 后端模块

```text
backend/app/modules/task/
├─ __init__.py
├─ router.py
├─ service.py
├─ parser.py
├─ schema.py
├─ model.py
└─ tests/
   ├─ test_parser.py
   └─ fixtures/
      └─ change-with-tasks/
         ├─ tasks.md
         └─ tasks/
            ├─ task-01.md
            ├─ task-02.md
            └─ task-03.md          # 没 frontmatter，仅文件名
```

### 3.4 API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/workspaces/{ws_id}/changes/{cid}/tasks` | `task:create`/`task:read`(包含) | 列出 |
| GET | `/api/workspaces/{ws_id}/tasks/{tid}` | `task:read` | 详情 |
| GET | `/api/workspaces/{ws_id}/changes/{cid}/tasks/board` | `task:read` | 看板分组 |
| POST | `/api/workspaces/{ws_id}/changes/{cid}/tasks/reparse` | `task:create` | 重新解析 |

看板响应：

```json
{
  "columns": [
    {"status": "draft", "count": 3, "items": [{...}, {...}, {...}]},
    {"status": "ready", "count": 1, "items": [...]},
    {"status": "in_progress", "count": 2, "items": [...]},
    {"status": "review", "count": 0, "items": []},
    {"status": "done", "count": 5, "items": [...]}
  ]
}
```

### 3.5 解析规则

| 情况 | 行为 |
|---|---|
| 缺 frontmatter | 从文件名提取 `task-NN`，title 取首行 H1 或文件名，status='draft' |
| frontmatter 解析失败 | 同上，warning |
| tasks.md 中 table 行能匹配上 task-xx.md | 合并，table 行的字段以 frontmatter 为准 |
| tasks.md 中 table 行无对应 .md | 入库为 stub task（path=null） |
| depends_on 引用不存在 task | 入库 + warning |
| 一个 change 下多个文件 id 重复 | 后者跳过 + warning |

### 3.6 前端页面

**看板** `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/tasks/page.tsx`：

- 5 列：draft / ready / in_progress / review / done
- 卡片显示：task_key / title / owner / priority / affected_components / 预估工时
- 拖拽暂不支持（状态机在 task-13 才做）
- 顶部过滤：owner / priority / phase

**详情** `.../tasks/[tid]/page.tsx`：

- 渲染 task-xx.md 的 markdown
- 元数据 panel：所有 frontmatter 字段
- 依赖图：depends_on / blocks 可视化

## 4. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | fixture 解析 3 个 task | 2 个完整 frontmatter，1 个仅文件名 |
| AC-02 | tasks.md table 与 .md frontmatter 冲突 | 以 .md 为准 |
| AC-03 | depends_on 引用不存在 | 入库 + warning，UI 显示红色徽章 |
| AC-04 | 看板返回正确分组 | count 与 items 匹配 |
| AC-05 | 详情页能渲染完整 markdown | 含代码、表格、列表 |
| AC-06 | 跨 change 不串 task | 隔离 |
| AC-07 | 重新解析 50 个 task | < 1s |
| AC-08 | 单测覆盖率 | ≥ 80% |
| AC-09 | task-key 含特殊字符 | URL 编码安全 |
| AC-10 | 依赖图正确显示 task-02 blocks task-03/04 | 截图 |

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| tasks.md 各种 markdown table 格式 | 解析失败 | 用 markdown-it-py + GFM table 插件 |
| depends_on 环 | 看板死循环 | 拓扑排序时检测环并 break |
| 多 owner 同一 task | 数据冲突 | frontmatter owner 只取首个，warning 提示 |
| owner 是 user_key 不是 user_id | 关联缺失 | DB 存 `owner_key`，UI 通过 user 表 lookup 显示头像 |

## 6. 完成定义

- [ ] 10 个 AC 通过
- [ ] 看板 + 详情截图
- [ ] `verification.md` 追加 task-06 记录
- [ ] PR 合并
