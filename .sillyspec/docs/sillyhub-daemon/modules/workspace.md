---
schema_version: 1
doc_type: module-card
module_id: workspace
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 本地工作区镜像管理（workspace）

## 定位
本地 workspace 镜像管理（`src/workspace.ts`，Strategy A: mirror workspace，
Python `workspace.py` 1:1 迁移）。负责三件事：
- prepareWorkspace：clone/pull 确保本地目录就绪，rootPath 可达时直连真实代码目录；
- collectDiff：任务执行后收集 git diff 作为产出；
- cleanWorkspace：Windows 安全删除。
git 认证依赖宿主机 git credential，本模块不管。承载 R-06
（git 子进程错误 + Windows rmtree）风险验证。

## 契约摘要
- `WorkspaceManager(baseDir)`：构造即 `mkdirSync(baseDir, {recursive:true})`。
- `prepareWorkspace(workspaceName, repoUrl?, branch='main', options?: {rootPath?})`：
  返回工作目录绝对路径。
- `collectDiff(dir): Promise<WorkspaceResult>`：
  `{ patch, files_changed, insertions, deletions, stats }`——snake_case 对齐
  backend diff_collector.DiffResult；stats 即 shortstat 原文 trim（redact 留后端）。
- `cleanWorkspace(name): Promise<void>`；`getWorkspacePath(name): string`（不保证存在）。
- `GitError(args, stderr, code)`：结构化 git 错误，args/stderr/exitCode 只读字段，
  便于上游 instanceof 分支转 lease 失败上报。
- `MAX_PATCH_CHARS = 50_000`：patch 截断上限；`parseShortstat(text)` 导出供测试。

## 关键逻辑
```
prepareWorkspace 四分支:
  0. rootPath 存在且是目录 → 直接返回（跳过 mirror，ql-20260617-009）
  1. wsDir 存在 + .git → git pull --ff-only（cwd=wsDir）
  2. 有 repoUrl → git clone -b branch repoUrl wsDir
  3. 否则 mkdir 空目录
collectDiff: 无 .git → EMPTY_DIFF；status --porcelain 空 → 零值；
  否则 diff --shortstat + diff → parseShortstat；
  patch 超 MAX_PATCH_CHARS → slice + '\n...[truncated]'
runGit: execFileAsync（不经 shell，无注入面）timeout 60s / maxBuffer 10MB；
  退出码非 0 / ENOENT（git 未装）/ 超时 → 一律抛 GitError
```

## 注意事项
- rootPath 不可访问（stat 抛错）或不是目录时回落 mirror，只 warn 不抛
  （`workspace_root_path_inaccessible/not_dir ... fallback=mirror`）。
- rootPath 模式下 workspace 可能不是 git 仓库（项目未 git init）：collectDiff 入口
  先查 `.git` 存在性，缺失直接返回零值（ql-20260617-014——避免 GitError 虽被
  task-runner catch 但以 diff_collect_failed 噪声污染 daemon log）。
- `MAX_PATCH_CHARS=50_000` 对齐 backend diff_collector max_diff_size=50_000；
  backend redact MAX_OUTPUT_SIZE=64_000 更大，故 daemon 截断后后端不会再截
  （无双截断标记）。
- `rmtreeWindowsSafe` 用**同步** `fs.rmSync` 而非 fs.promises.rm：Node v26 的
  promise 版在 vitest 等异步调度环境下有 rimraf 内部 callback 链竞态
  （promise resolve 但底层未完成），同步版无此问题（源码注释记载此坑）。
  四阶段：直接删 → EBUSY/EPERM/ENOTEMPTY/EMFILE/ENFILE 重试 3 次 ×100ms →
  降级递归 chmod 0o666（git objects 只读文件）再删 → 仍失败才抛；ENOENT 视为成功。
- `parseShortstat` 按 "," 切段、每段按空白切、首 token 纯数字才按关键词
  （file/insertion/deletion）归类，容错杂段；依赖 git shortstat 英文文案稳定，
  git 大版本升级需回归。
- execFile 不支持 stdio 选项：capture=false 时仍捕获 stdout 但 return '' 丢弃，
  等价 Python DEVNULL；stderr 始终经 err.stderr 暴露以构造 GitError。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
