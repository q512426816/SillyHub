---
id: task-03
title: 实现 projects 组件配置解析
phase: V1
priority: P0
status: draft
owner: qinyi
estimated_hours: 14
affected_components:
  - platform-api
  - platform-web
allowed_paths:
  - backend/app/modules/component/
  - backend/app/models/component.py
  - backend/migrations/versions/
  - frontend/src/app/(dashboard)/workspaces/[id]/components/
depends_on:
  - task-02
blocks:
  - task-04
---

## 1. 目标

读取 `.sillyspec/projects/*.yaml`，解析为 `ProjectComponent` 与 `ComponentRelation`，前端展示组件列表 + 拓扑图。

**重申**：`projects/*.yaml` 是 **项目组组件** 配置，不是项目列表。这是 V1 模型最容易翻车的点。

**不在范围**：

- scan docs（task-04）
- 组件路径上的 Git 操作（task-09 起）

## 2. 输入

- `references/01-sillyspec-native-layout.md` §projects
- `references/03-domain-model.md` §3.2 / 3.3
- `references/12-frontmatter-schema.md` §Project Component
- `references/17-db-schema.md` §2.3
- 真实样例：`silly.yaml`、`silly-admin-ui.yaml`（要求用户提供 ≥ 2 个样例 fixture）

## 3. 产出清单

### 3.1 期望的 yaml schema

```yaml
id: silly-admin-ui
name: Silly Admin UI
type: frontend                    # frontend / backend / tooling / docs / test
role: admin_console
path: ../silly-admin-ui
repo_url: git@github.com:org/silly-admin-ui.git
default_branch: main
tech_stack:
  - TypeScript
  - React
  - Vite
commands:
  build: npm run build
  test: npm run test
  dev: npm run dev
relations:
  - target: silly
    type: consumes_api_from
    description: 调用 silly 后端 API
```

`relations.type` 取值：`consumes_api_from / depends_on / tests / publishes_to / documents`。

### 3.2 数据表

按 `references/17-db-schema.md` §2.3 建：

- `project_components`
- `component_relations`

migration `202605260930_create_components_and_relations.py`。

### 3.3 后端模块

```text
backend/app/modules/component/
├─ __init__.py
├─ router.py
├─ service.py
├─ parser.py          # YAML → ProjectComponent
├─ schema.py
├─ model.py
└─ tests/
   ├─ test_parser.py
   ├─ test_service.py
   └─ fixtures/
      ├─ valid/
      │  ├─ silly.yaml
      │  └─ silly-admin-ui.yaml
      └─ invalid/
         ├─ missing-id.yaml
         ├─ bad-relation.yaml
         └─ duplicate-id.yaml
```

### 3.4 API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/workspaces/{ws_id}/components` | `component:read` | 列出 |
| GET | `/api/workspaces/{ws_id}/components/{id}` | `component:read` | 详情 |
| POST | `/api/workspaces/{ws_id}/components/reparse` | `component:write` | 重新解析 projects/*.yaml |
| GET | `/api/workspaces/{ws_id}/components/topology` | `component:read` | 拓扑图（节点 + 边） |

### 3.5 解析规则

| 检查 | 行为 |
|---|---|
| 缺 `id` | 跳过该文件，记录 warning |
| `id` 重复 | 跳过后者，记录 warning |
| `path` 不存在 | 解析成功但置 `status='path_missing'` |
| `relations.target` 引用不存在 component | 解析成功但记录 warning |
| 整个文件 YAML 解析失败 | 跳过文件，记录 error |
| 未知字段 | 保留到 `extra` JSONB 字段 |

任何 warning / error 都必须返回给前端展示，不能静默吞掉。

### 3.6 前端页面

`frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx`：

- 表格列：id / name / type / role / path / 路径状态 / tech_stack / 关联数
- 顶部 "重新解析" 按钮 → 调 `/reparse` → 显示 warnings
- 详情抽屉：完整 yaml 源 + 解析结果 + 关联列表

`frontend/src/app/(dashboard)/workspaces/[id]/components/topology/page.tsx`：

- 用 React Flow 渲染组件拓扑
- 节点：组件名 + type 颜色
- 边：relation_type label

## 4. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 用 `valid/` fixtures 解析 | 2 个 component、1 条 relation，无 warning |
| AC-02 | `missing-id.yaml` | 跳过，warning 含 `missing_id` |
| AC-03 | `duplicate-id.yaml` | 第二个文件跳过，warning 含 `duplicate_id` |
| AC-04 | 引用不存在 target | 解析成功但 warning 含 `unknown_relation_target` |
| AC-05 | `path` 字段指向不存在目录 | component.status = `path_missing` |
| AC-06 | YAML 语法错误 | 单个文件跳过不影响其他文件 |
| AC-07 | 重新解析时 id 一致的 component 用 UPSERT | 不出现重复行 |
| AC-08 | 列表 API 不返回其他 workspace 的 component | workspace 隔离生效 |
| AC-09 | 单测覆盖率 | ≥ 85% |
| AC-10 | 拓扑图能正确渲染 3 个节点 / 2 条边 | 截图存档 |

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 把 projects 当成项目列表 | 数据建模错 | 模型类名严格用 ProjectComponent；API 路径不要叫 `/projects`；UI 文案统一"项目组件" |
| YAML 中文键 | 解析失败 | 全程 `yaml.safe_load(open(..., encoding="utf-8"))` |
| relations 循环引用 | 拓扑死循环 | 渲染时检测环并 break |
| 真实样例缺失 | 测试覆盖不足 | 在 task-03 开工前用户必须提供 ≥ 2 个真实 yaml |
| component_key 全局唯一性误解 | DB 冲突 | UNIQUE 是 `(workspace_id, component_key)`，不是全局 |

## 6. 完成定义

- [ ] 10 个 AC 通过
- [ ] 单测 + topology 渲染截图
- [ ] `verification.md` 追加 task-03 记录
- [ ] PR 合并
