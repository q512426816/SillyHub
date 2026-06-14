---
schema_version: 1
doc_type: module-card
module_id: workspace
author: qinyi
created_at: 2026-06-10T16:55:00
---

# workspace

## 定位
本地 workspace 镜像管理（Strategy A: mirror workspace）。负责 git clone/pull 确保本地目录与远程仓库同步，任务执行后收集 git diff 作为产出物。不负责 git 认证（依赖宿主机的 git credential 配置）。

## 契约摘要
- `WorkspaceManager(baseDir)` — 初始化，自动创建 baseDir
- `GitError` — git 子进程失败时抛出的错误类型（含 stderr）
- `WorkspaceResult` — diff 收集结果类型（patch/filesChanged/insertions/deletions/stats）
- `prepareWorkspace(workspaceName, repoUrl?, branch?) -> Promise<string>` — clone 或 pull，返回工作目录路径
- `collectDiff(workspacePath) -> Promise<WorkspaceResult>` — 收集 unified diff
- `cleanWorkspace(workspaceName) -> Promise<void>` — 完整删除 workspace 目录
- `getWorkspacePath(workspaceName) -> string` — 返回预期路径（不保证存在）
- `parseShortstat(text) -> {filesChanged, insertions, deletions}` — 解析 `git diff --shortstat` 文本（导出供测试/复用）

## 关键逻辑
```
prepareWorkspace(name, repoUrl, branch)
  if dir exists and has .git → git pull --ff-only
  elif repoUrl → git clone -b branch repoUrl dir
  else → mkdir empty dir

collectDiff(path)
  git status --porcelain → if empty return zeros
  git diff --shortstat → parseShortstat(text)
  git diff → full patch text
  return { patch, filesChanged, insertions, deletions, stats }
```

## 注意事项
- git 子进程通过 `child_process.spawn` 同步包装执行，超时 60 秒，大仓库 pull 可能不够
- cleanWorkspace 删除失败时内联处理（不再有独立的 `_onRmtreeError` 方法）
- `parseShortstat` 解析 git diff --shortstat 文本格式，依赖 git 输出格式稳定性
- git 操作捕获 stderr 用于 `GitError` 诊断
- 被 cli 和 task-runner 使用

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
