---
schema_version: 1
doc_type: module-card
module_id: workspace
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:13
---
# workspace

## 定位
本地 workspace 镜像管理（Strategy A: mirror workspace）。负责 git clone/pull 确保本地目录与远程同步，任务执行后收集 git diff 作为产出物。承载 R-06（git 子进程错误 + Windows rmtree）。不负责 git 认证（依赖宿主机 git credential）。1:1 迁移自 Python `workspace.py`。

## 契约摘要
- `WorkspaceManager(baseDir)`：构造即 mkdirSync baseDir。
- `GitError(args, stderr, code)`：git 子进程失败错误类型。
- `WorkspaceResult`：`{ patch, filesChanged, insertions, deletions, stats }`。
- `MAX_PATCH_CHARS = 50_000`：patch 字符上限（超长截断）。
- `prepareWorkspace(name, repoUrl?, branch='main', options?): Promise<string>`：返回工作目录绝对路径。options.rootPath 指定真实代码目录。
- `collectDiff(workspaceDir): Promise<WorkspaceResult>`：收集 unified diff + shortstat。
- `cleanWorkspace(name): Promise<void>`：删除 workspace 目录（rmtreeWindowsSafe）。
- `getWorkspacePath(name): string`：返回预期路径（不保证存在）。
- `parseShortstat(text)`：解析 `git diff --shortstat`（导出供测试/复用）。

## 关键逻辑
```
prepareWorkspace(name, repoUrl, branch, options):
  if options.rootPath 可访问且是目录 → 直接返回（跳过 mirror，ql-202617-009）
  wsDir = join(baseDir, name)
  if exists(wsDir) && has .git → git pull --ff-only
  else if repoUrl → git clone -b branch repoUrl wsDir
  else → mkdir 空目录
  return wsDir

collectDiff(dir):
  git status --porcelain → 空 → 返回零值
  git diff --shortstat → parseShortstat
  git diff → patch（截断 MAX_PATCH_CHARS）
```

## 注意事项
- git 子进程用 `execFile`（promisify），超时 60s，大仓库 pull 可能不够。
- `cleanWorkspace` 用 `rmtreeWindowsSafe`（fs.rm maxRetries + chmod 降级）替代 Python shutil onexc，处理 Windows 文件占用。
- rootPath 模式下 workspace 可能不是 git 仓库（项目未 git init），collectDiff 需容忍非 git 目录（ql-202617-014）。
- `parseShortstat` 依赖 git 输出格式稳定性，git 版本升级需回归。
- patch 超 `MAX_PATCH_CHARS` 截断，server 端按截断 patch 处理。
- 被 cli、task-runner 使用。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
