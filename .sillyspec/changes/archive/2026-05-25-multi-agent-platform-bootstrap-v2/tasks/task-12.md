---
id: task-12
title: 实现平台写入 Change 包
phase: V2
priority: P1
status: draft
owner: qinyi
estimated_hours: 24
affected_components:
  - platform-api
  - platform-web
allowed_paths:
  - backend/app/modules/change_writer/
  - backend/app/modules/outbox/
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/new/
depends_on:
  - task-05
  - task-09
  - task-10
  - task-11
---

## 1. 目标

平台可以通过 UI 表单创建 Change，生成完整 SillySpec 变更包 markdown 文件，并通过 outbox + Git Tool Gateway 提交到任务分支 + 创建 PR。

**不在范围**：

- 状态机 / 审批（task-13）
- Agent 执行（task-14）

## 2. 输入

- `requirements.md` §V2
- `plan.md` §4 V2
- `references/12-frontmatter-schema.md`
- `references/17-db-schema.md` §3 outbox / §2.4

## 3. 产出清单

### 3.1 用户故事

1. 用户在 UI 点"新建 Change"
2. 填写：title / change_type / owner / affected_components / 简要描述
3. 平台生成目录 `changes/change/{date}-{slug}/`，写入 MASTER.md / proposal.md 占位
4. 平台用用户 Git Identity 在 worktree 中 `git add + commit + push` 到任务分支
5. 创建 PR 草案
6. UI 显示 PR 链接 + 文档列表

### 3.2 后端模块

```text
backend/app/modules/change_writer/
├─ __init__.py
├─ router.py
├─ service.py
├─ templates/             # SillySpec 模板（Jinja2）
│  ├─ MASTER.md.j2
│  ├─ proposal.md.j2
│  ├─ requirements.md.j2
│  ├─ design.md.j2
│  ├─ plan.md.j2
│  ├─ tasks.md.j2
│  └─ verification.md.j2
└─ tests/
   ├─ test_service.py
   └─ test_templates.py

backend/app/modules/outbox/
├─ __init__.py
├─ worker.py              # 后台消费者
├─ model.py
└─ tests/
```

### 3.3 模板规范

Jinja2 模板必须严格遵守 SillySpec 真实变更包结构（见 `references/01`、`references/12`）。模板里禁止包含平台标识字段。

MASTER.md.j2 示例：

```jinja
---
id: {{ change_key }}
title: {{ title }}
status: draft
change_type: {{ change_type }}
owner: {{ owner }}
affected_components:
{% for c in affected_components %}  - {{ c }}
{% endfor %}
---

# {{ title }}

## 背景

{{ background or '（待补充）' }}

## 核心目标

（待补充）
```

### 3.4 API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/workspaces/{ws_id}/changes` | `change:create` | 创建 Change + 生成 markdown + 入 outbox |
| PATCH | `/api/workspaces/{ws_id}/changes/{cid}/documents/{doc_type}` | `change:update` | 编辑单个文档（写文件 + 入 outbox） |
| GET | `/api/workspaces/{ws_id}/changes/{cid}/sync-status` | `change:read` | 查询 outbox 同步状态 |

### 3.5 写入流程（事务一致）

```text
HTTP 创建请求
  ↓
1. DB 事务开始
2. 申请 worktree lease（task-10）
3. 在 lease.path 下写文件（多个 .md）
4. INSERT changes / change_documents
5. INSERT outbox（payload 含 lease_id + 待执行 git 操作）
6. DB 事务提交
  ↓
后台 outbox worker
  ↓
7. 用 Git Tool Gateway（task-11）：
   git add + git commit + git push origin <branch>
8. provider API 创建 PR
9. outbox.status = completed，记录 PR url
10. 失败 → 退避重试；超过上限 → dead_letter，UI 弹窗
11. 不论成败 → release worktree lease
```

### 3.6 前端页面

`frontend/src/app/(dashboard)/workspaces/[id]/changes/new/page.tsx`：

- 多步表单：基础信息 → affected_components 选择 → 模板预览 → 确认提交
- 提交后跳转到 change 详情 + 显示同步状态 banner（pending / syncing / pushed / pr_created / failed）

`changes/[cid]/edit/[doc_type]/page.tsx`：

- Monaco editor 编辑 markdown
- 保存 → PATCH API
- 同步状态实时刷新（SSE 或轮询）

## 4. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 创建 change | DB 行 + 7 个 doc 文件 |
| AC-02 | 模板生成的 markdown 通过 task-05 解析 | parser 不报 warning |
| AC-03 | outbox 成功消费 | git push 完成、PR url 入库 |
| AC-04 | 模拟 push 失败 | retry 后 dead_letter，UI 告警 |
| AC-05 | 用户 Git Identity 过期时创建 | 拒绝，提示重新绑定 |
| AC-06 | 编辑文档保存 | 文件被更新、commit + push 到同一分支 |
| AC-07 | change_key 冲突 | 409 |
| AC-08 | affected_components 引用不存在 component | 400 |
| AC-09 | 同步状态实时可见 | SSE 或 5s 轮询 |
| AC-10 | 单测覆盖率 | ≥ 80% |
| AC-11 | 平台用平台自身管理这次变更（dogfood） | 能在 V2 自举 |

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 模板与 SillySpec 真实结构不一致 | Parser 报警 | 模板 fixture 必须通过 task-05 / task-06 parser |
| 多个用户同时创建相同 change_key | 冲突 | UNIQUE + 重试生成 slug |
| Git push 与本地 commit 不一致 | 状态混乱 | 一切走 Outbox，平台不直接命令式 push |
| 文档编辑冲突 | 覆盖 | DB 增加 `change_documents.version`，PATCH 必须传 If-Match |
| 主分支保护规则 | push 失败 | 必须 push 到任务分支 + PR |

## 6. 完成定义

- [ ] 11 个 AC 通过
- [ ] 平台自我管理此 PR（dogfood）
- [ ] 单测 + 集成
- [ ] `verification.md` 追加 task-12 记录
- [ ] PR 合并
