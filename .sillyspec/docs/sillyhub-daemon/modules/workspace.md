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
- `WorkspaceManager(base_dir)` — 初始化，自动创建 base_dir
- `prepare_workspace(workspace_name, repo_url?, branch) -> Path` — clone 或 pull，返回工作目录路径
- `collect_diff(workspace_path) -> dict` — 收集 unified diff，返回 patch/files_changed/insertions/deletions/stats
- `clean_workspace(workspace_name)` — 完整删除 workspace 目录
- `get_workspace_path(workspace_name) -> Path` — 返回预期路径（不保证存在）

## 关键逻辑
```
prepare_workspace(name, repo_url, branch)
  if dir exists and has .git → git pull --ff-only
  elif repo_url → git clone -b branch repo_url dir
  else → mkdir empty dir

collect_diff(path)
  git status --porcelain → if empty return zeros
  git diff --shortstat → parse (files, insertions, deletions)
  git diff → full patch text
  return {patch, files_changed, insertions, deletions, stats}
```

## 注意事项
- git 子进程超时 60 秒，大仓库 pull 可能不够
- `_on_rmtree_error` 处理 Windows 上 git objects 的只读文件删除问题
- `_parse_shortstat` 解析 git diff --shortstat 文本格式，依赖 git 输出格式稳定性
- git 操作通过 `asyncio.create_subprocess_exec` 异步执行，stderr 被捕获
- 被 cli 和 task-runner 使用

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
