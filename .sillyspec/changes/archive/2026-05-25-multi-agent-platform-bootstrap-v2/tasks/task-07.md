---
id: task-07
title: 实现 Runtime 状态展示
phase: V1
priority: P1
status: draft
owner: qinyi
estimated_hours: 8
affected_components:
  - platform-api
  - platform-web
allowed_paths:
  - backend/app/modules/runtime/
  - frontend/src/app/(dashboard)/workspaces/[id]/runtime/
depends_on:
  - task-02
---

## 1. 目标

读取 `.sillyspec/.runtime/` 下的本地运行态信息（progress / user-inputs / artifacts），前端展示且**必须标明"本地运行态、非长期事实源"**。

**不在范围**：

- Agent Run 真正写入 .runtime（V4）
- 文件变更监听（V2）

## 2. 输入

- `requirements.md` FR-006
- `references/03-domain-model.md` §RuntimeState
- `references/17-db-schema.md` §2.4 `runtime_snapshots`

## 3. 产出清单

### 3.1 解析约定

```text
.sillyspec/.runtime/
  progress.json          # 当前流程阶段（结构由 SillySpec CLI 定义）
  user-inputs.md         # 历史用户输入
  artifacts/             # 各阶段产物 (任意文件)
  *.lock                 # 锁文件，忽略
```

`progress.json` 期望结构（容错，缺字段不报错）：

```json
{
  "current_change": "2026-05-25-xxx",
  "current_phase": "design",
  "last_action": "design.md updated",
  "updated_at": "2026-05-25T..."
}
```

### 3.2 数据表

`runtime_snapshots`（按 17-db-schema.md §2.4）。每次扫描覆盖（保留最近 10 条历史）。

### 3.3 API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/workspaces/{ws_id}/runtime` | `workspace:read` | 返回最新 snapshot |
| GET | `/api/workspaces/{ws_id}/runtime/history` | `workspace:read` | 最近 10 次 snapshot |
| POST | `/api/workspaces/{ws_id}/runtime/rescan` | `workspace:read` | 重新扫描 |
| GET | `/api/workspaces/{ws_id}/runtime/artifacts/{path}` | `workspace:read` | 下载 artifact（受路径限制） |

### 3.4 前端页面

`frontend/src/app/(dashboard)/workspaces/[id]/runtime/page.tsx`：

- 顶部 banner（黄色背景）："以下是本地运行态，仅供参考，不应提交 Git"
- 三栏：
  - Progress：current_change / phase / last_action / updated_at
  - User Inputs：渲染 markdown
  - Artifacts：文件列表 + 下载
- 缺失数据显示空状态

## 4. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | fixture 含完整 progress.json | 正确显示 |
| AC-02 | progress.json 缺字段 | 不报错，缺字段显示 "—" |
| AC-03 | 不存在 `.runtime` 目录 | 显示空状态 |
| AC-04 | artifacts 含 5 个文件 | 列表展示文件名 + 大小 |
| AC-05 | 下载 artifact 路径 `..` | 拒绝，403 |
| AC-06 | 顶部黄色提示 banner | 始终显示 |
| AC-07 | history 保留 10 条 | 第 11 条覆盖最早 |
| AC-08 | 单测覆盖率 | ≥ 75% |
| AC-09 | 跨 workspace 不串数据 | 隔离 |
| AC-10 | rescan 后 updated_at 变化 | 实时刷新 |

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 用户误把 .runtime 当 source of truth | 数据混乱 | UI 强 banner + 文档反复说明 |
| artifacts 含敏感凭据 | 信息泄露 | API 检测疑似 token 字符串，下载时打 warning |
| `.runtime` 被 git 提交 | 仓库污染 | scanner 检测 .gitignore 是否含 `.sillyspec/.runtime/`，否则 warning |

## 6. 完成定义

- [ ] 10 个 AC 通过
- [ ] 单测 + 截图
- [ ] `verification.md` 追加 task-07 记录
- [ ] PR 合并
