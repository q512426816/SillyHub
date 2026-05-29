---
author: qinyi
created_at: 2026-05-27 09:43:49
---

# STRUCTURE

## 目录树

```text
.
├─ backend/
│  ├─ app/
│  │  ├─ core/
│  │  ├─ models/
│  │  └─ modules/
│  │     ├─ workspace/
│  │     ├─ component/
│  │     ├─ scan_docs/
│  │     ├─ change/
│  │     ├─ task/
│  │     ├─ worktree/
│  │     ├─ git_gateway/
│  │     ├─ tool_gateway/
│  │     ├─ agent/
│  │     ├─ workflow/
│  │     ├─ release/
│  │     ├─ incident/
│  │     └─ settings/
│  ├─ migrations/
│  └─ tests/
├─ frontend/
│  └─ src/
│     ├─ app/
│     ├─ components/
│     └─ lib/
├─ deploy/
├─ docs/
├─ prototype/
├─ spikes/
└─ .sillyspec/
```

## 模块说明

- `workspace`: 管理工作区 root path、扫描状态和 `.sillyspec` 路径。
- `component`: 解析 `.sillyspec/projects/*.yaml` 并维护组件/关系。
- `scan_docs`: 解析 `.sillyspec/docs/{component}/scan/*.md`。
- `change` / `task`: 解析 `.sillyspec/changes/...` 下的变更和任务。
- `runtime`: 读取 `.sillyspec/.runtime/progress.json`。
- `change_writer`: 在目标仓库写入 `.sillyspec/changes/change/...` 文档。
- `worktree`, `git_gateway`, `tool_gateway`, `agent`: 执行层与审计层。
- `frontend/src/lib`: 浏览器侧 API client。
- `frontend/src/app/(dashboard)`: 工作台页面。
