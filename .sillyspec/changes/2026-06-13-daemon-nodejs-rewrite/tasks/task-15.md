---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-15
title: workspace（src/workspace.ts，git mirror/pull/diff + Windows rmtree）
priority: P0
estimated_hours: 4
depends_on: [task-01]
blocks: [task-19, task-22]
allowed_paths:
  - sillyhub-daemon/src/workspace.ts
---

# task-15: workspace（src/workspace.ts，git mirror/pull/diff + Windows rmtree）

本任务实现 daemon 的本地 workspace 镜像管理模块（Wave 2），1:1 迁移 Python `sillyhub_daemon/workspace.py` 的 `WorkspaceManager` 类到 TypeScript。策略 A：mirror workspace——任务前 git clone/pull 确保本地目录与远程同步，任务后收集 git diff 作为产出物。**承载 R-06 风险**（git 子进程错误处理 + Windows rmtree 兼容）的核心验证，是 TaskRunner（task-19）编排链的入口环节。

## 修改文件

精确路径（仓库根为 `/Users/qinyi/SillyHub`）：

| 操作 | 路径 | 说明 |
|---|---|---|
| 新建 | `sillyhub-daemon/src/workspace.ts` | `WorkspaceManager` 类 + `WorkspaceResult` 接口 + `_parseShortstat` / `runGit` 辅助函数 + 结构化 `GitError` |

> 本任务**只产出 `src/workspace.ts` 一个源文件**，不写测试文件（测试迁移在 task-22 1:1 搬运 Python `test_workspace.py`），不引入新依赖（`node:child_process` / `node:fs` / `node:path` 全部为 Node 内置）。

## 实现要求

### R1. prepareWorkspace(repoUrl, branch, workspaceDir) — clone/pull 分支

严格对齐 Python `prepare_workspace` 的三分支逻辑：

1. **目录存在且含 `.git`** → 执行 `git pull --ff-only`（cwd = workspace 目录）。
2. **目录不存在或无 `.git`，且提供 repoUrl** → 执行 `git clone -b <branch> <repo_url> <workspace_dir>`（cwd = base_dir，最后一参数为目标目录由 git 创建）。
3. **目录不存在且无 repoUrl** → `fs.mkdir(workspace_dir, { recursive: true })`，创建空目录。

返回 `string`（workspace 目录绝对路径），与 Python 返回 `Path` 等价。三个分支都落 `logger.info` 日志（事件名 `workspace_pulled` / `workspace_cloned` / `workspace_created_empty`，字段对齐 Python：`path=` / `url=`）。

### R2. collectDiff(workspaceDir) — patch + files_changed

对齐 Python `collect_diff`：

1. 先 `git status --porcelain`（capture=true），输出 strip 后为空 → 直接返回零值（patch="" / files_changed=0 / insertions=0 / deletions=0 / stats=""），**避免对无改动工作区执行多余 git diff**。
2. 非空 → `git diff --shortstat` 拿统计行 → `git diff` 拿完整 unified diff 文本。
3. 用 `_parseShortstat(shortstat)` 解析出 (files_changed, insertions, deletions)。
4. 返回 `WorkspaceResult` 对象（字段名与 Python dict key 完全一致：`patch` / `files_changed` / `insertions` / `deletions` / `stats`）。

`stats` 字段保留 shortstat 原始文本（已 strip），与 Python `"stats": shortstat.strip()` 等价。

### R3. git 子进程封装（R-06 核心）

对齐 Python `_run_git` 的语义，但用 Node `child_process.execFile`（async 包装）：

- 命令固定 `git`（不在 shell 中执行，**禁止用 `child_process.exec`** 避免命令注入风险）。
- `args` 为字符串数组，与 Python `["git"] + args` 拼接方式一致。
- `cwd` 选项传给 `execFile`。
- `maxBuffer`：默认 `execFile` 是 1MB，大 diff 可能溢出。**设为 10MB**（`10 * 1024 * 1024`），覆盖 Python 未显式设但实际通过 PIPE 读流的不限行为。
- **超时 60 秒**：对齐 Python `asyncio.wait_for(proc.communicate(), timeout=60)`。用 `execFile` 的 `timeout: 60000` 选项，超时后子进程被 SIGTERM。
- stdout/stderr 编码：`encoding: 'utf8'`（与 Python `.decode()` 等价，不用 Buffer）。
- `capture` 参数控制 stdout 是否返回：`capture=false` 时 stdout 重定向到 DEVNULL 等价——Node 用 `stdio: ['ignore', 'ignore', 'pipe']`；`capture=true` 时 `stdio: ['ignore', 'pipe', 'pipe']`。

**错误结构化（R-06）**：returncode != 0 时，Python 抛 `RuntimeError(f"git {args} failed: {stderr}")`。Node 版升级为结构化错误类 `GitError`，承载：
- `command`：完整 git 命令字符串（`git ${args.join(' ')}`）。
- `args`：args 数组（便于调试）。
- `stderr`：stderr 文本（decode errors='replace' 等价：Node 默认 utf8 解码，已规避）。
- `code`：进程退出码（number）。
- `message`：`git ${args.join(' ')} failed (exit ${code}): ${stderr.trim()}`。

`GitError` 继承 `Error`，`name = 'GitError'`，是导出的具名类（task-19 TaskRunner 可 `instanceof GitError` 分支捕获，task-22 测试可断言）。

### R4. Windows rmtree（FR-06）

对齐 Python `shutil.rmtree(path, onexc=_on_rmtree_error)`。Node 用 `fs.rm(path, { recursive: true, force: true })`，但需处理 Windows 上 git objects 只读文件导致 EPERM/EBUSY：

**重试 + 降级策略**（Python `_on_rmtree_error` 的 Node 等价）：
1. 调 `fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })`——`maxRetries` + `retryDelay` 是 Node `fs.rm` 内置选项，自动对 EBUSY/ENOTEMPTY/EPERM 重试（Windows 文件锁常见）。
2. 若仍失败（rare case，git pack 文件仍只读），捕获错误后**降级遍历**：递归 `readdir` + `chmod` 改可写（`0o666`）+ `unlink`/`rmdir`，模拟 Python `os.chmod(path, stat.S_IWRITE)` + `func(path)`。
3. 降级仍失败 → 抛原错误（不吞），日志 `logger.warn` 记录路径与错误码。

`force: true` 保证目录不存在时不抛 ENOENT（对齐 Python `if ws_dir.exists()` 守卫）。

### R5. 清理/复用策略（clean_workspace + getWorkspacePath）

- `cleanWorkspace(workspaceName)`：拼 `base_dir/workspace_name` → 调 R4 的 rmtree 辅助函数 → 日志 `workspace_cleaned path=`。
- `getWorkspacePath(workspaceName)`：纯函数，返回 `path.join(baseDir, workspaceName)`，不保证目录存在（与 Python `get_workspace_path` 等价，task-19 用于检查 workspace 是否已就绪）。

**复用语义**：prepareWorkspace 不主动清理——已存在带 `.git` 的目录直接 pull 复用，符合 Python "Strategy A mirror" 设计（任务复用同一 workspace，不每次重建）。清理时机由 TaskRunner（task-19）决定（如任务失败后清理）。

### R6. 构造函数与 baseDir

`WorkspaceManager` 构造函数接收 `baseDir: string`，对齐 Python `WorkspaceManager(base_dir)`：
- 存为 `this.baseDir`（私有，readonly）。
- 构造时 `fs.mkdirSync(baseDir, { recursive: true })`（对齐 Python `self._base_dir.mkdir(parents=True, exist_ok=True)`）——同步创建，因构造函数不能 async。

## 接口定义

```typescript
// sillyhub-daemon/src/workspace.ts
// 本地 workspace 镜像管理（Strategy A: mirror workspace）。
// 1:1 迁移自 Python sillyhub_daemon/workspace.py 的 WorkspaceManager。
// 承载 R-06（git 子进程错误 + Windows rmtree）风险验证。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdirSync,
  rm,
  readdirSync,
  statSync,
  chmodSync,
  unlinkSync,
  rmdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

/** git 子进程超时（秒），对齐 Python asyncio.wait_for(..., timeout=60)。 */
const GIT_TIMEOUT_MS = 60_000;

/** git diff 输出 maxBuffer（字节），大 diff 防溢出。 */
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

/**
 * 结构化 git 错误（R-06）。
 * Python 版用 RuntimeError；Node 版升级为具名类，便于 task-19 instanceof 分支。
 */
export class GitError extends Error {
  readonly args: readonly string[];
  readonly stderr: string;
  readonly code: number | null;

  constructor(args: readonly string[], stderr: string, code: number | null) {
    super(`git ${args.join(" ")} failed (exit ${code}): ${stderr.trim()}`);
    this.name = "GitError";
    this.args = args;
    this.stderr = stderr;
    this.code = code;
  }
}

/** collectDiff 返回结构，字段名与 Python dict key 完全一致。 */
export interface WorkspaceResult {
  /** 完整 unified diff 文本（git diff 输出）。 */
  patch: string;
  /** 改动文件数。 */
  files_changed: number;
  /** 新增行数。 */
  insertions: number;
  /** 删除行数。 */
  deletions: number;
  /** git diff --shortstat 原始行（已 strip）。 */
  stats: string;
}

/**
 * 本地 workspace 镜像管理器。
 * - prepareWorkspace: clone 或 pull --ff-only，确保本地目录就绪。
 * - collectDiff: 收集 git diff 作为任务产出。
 * - cleanWorkspace: 删除 workspace（Windows 兼容）。
 */
export class WorkspaceManager {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    // 对齐 Python self._base_dir.mkdir(parents=True, exist_ok=True)
    mkdirSync(baseDir, { recursive: true });
  }

  /**
   * 确保 workspace 存在且为最新。
   * @param workspaceName workspace 目录名（相对 baseDir）
   * @param repoUrl git 远程 URL，首次 clone 必填；已存在则忽略
   * @param branch 分支名，默认 "main"
   * @returns workspace 目录绝对路径
   */
  async prepareWorkspace(
    workspaceName: string,
    repoUrl?: string,
    branch = "main",
  ): Promise<string> {
    const wsDir = join(this.baseDir, workspaceName);
    const hasGit = existsSync(join(wsDir, ".git"));

    if (existsSync(wsDir) && hasGit) {
      // 分支 1：已存在 + .git → pull --ff-only
      await runGit(["pull", "--ff-only"], wsDir, false);
      logger.info(`workspace_pulled path=${wsDir}`);
    } else if (repoUrl) {
      // 分支 2：clone（cwd=baseDir，目标目录由 git 创建）
      await runGit(["clone", "-b", branch, repoUrl, wsDir], this.baseDir, false);
      logger.info(`workspace_cloned url=${repoUrl} path=${wsDir}`);
    } else {
      // 分支 3：无 repoUrl → 创建空目录
      mkdirSync(wsDir, { recursive: true });
      logger.info(`workspace_created_empty path=${wsDir}`);
    }

    return wsDir;
  }

  /**
   * 收集 workspace 的 git diff。
   * 无改动时返回零值（patch="", files_changed=0, ...）。
   */
  async collectDiff(workspaceDir: string): Promise<WorkspaceResult> {
    const status = await runGit(["status", "--porcelain"], workspaceDir, true);

    if (!status.trim()) {
      return {
        patch: "",
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        stats: "",
      };
    }

    const shortstat = await runGit(["diff", "--shortstat"], workspaceDir, true);
    const diffOutput = await runGit(["diff"], workspaceDir, true);
    const { files_changed, insertions, deletions } = parseShortstat(shortstat);

    return {
      patch: diffOutput,
      files_changed,
      insertions,
      deletions,
      stats: shortstat.trim(),
    };
  }

  /**
   * 删除 workspace 目录（Windows rmtree 兼容）。
   * 目录不存在时静默成功（force=true）。
   */
  async cleanWorkspace(workspaceName: string): Promise<void> {
    const wsDir = join(this.baseDir, workspaceName);
    if (existsSync(wsDir)) {
      await rmtreeWindowsSafe(wsDir);
      logger.info(`workspace_cleaned path=${wsDir}`);
    }
  }

  /** 返回预期 workspace 路径（不保证存在）。 */
  getWorkspacePath(workspaceName: string): string {
    return join(this.baseDir, workspaceName);
  }
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 执行 git 子进程。
 * @param args git 参数（不含 "git" 前缀）
 * @param cwd 工作目录
 * @param capture 是否捕获 stdout；false 时丢弃 stdout（对齐 Python DEVNULL）
 * @returns stdout 文本（capture=false 时返回 ""）
 * @throws GitError 当退出码非 0
 */
async function runGit(
  args: readonly string[],
  cwd: string,
  capture: boolean,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args as string[], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      encoding: "utf8",
      // capture=false 时丢弃 stdout（DEVNULL 等价）
      stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "ignore", "pipe"],
    });
    return capture ? stdout : "";
  } catch (e) {
    const err = e as NodeJS.ErrnoException & {
      code?: number | string;
      stderr?: string;
      stdout?: string;
    };
    // execFile 失败时 err.code 通常是退出码（number），errno 系统错误时为 string
    const exitCode =
      typeof err.code === "number" ? err.code : null;
    const stderr = err.stderr ?? "";
    // 超时（ETIMEDOUT/killed）也走 GitError 分支
    throw new GitError(args, stderr, exitCode);
  }
}

/**
 * 解析 git diff --shortstat 输出。
 * 示例输入：
 *   " 3 files changed, 10 insertions(+), 2 deletions(-)"
 *   " 1 file changed, 5 insertions(+)"
 *   " 2 files changed, 3 deletions(-)"
 */
export function parseShortstat(shortstat: string): {
  files_changed: number;
  insertions: number;
  deletions: number;
} {
  let files_changed = 0;
  let insertions = 0;
  let deletions = 0;

  const text = shortstat.trim();
  if (!text) return { files_changed, insertions, deletions };

  for (let raw of text.split(",")) {
    const token = raw.trim();
    const parts = token.split(/\s+/);
    const first = parts[0];
    if (first === undefined || !/^\d+$/.test(first)) continue;
    const n = Number(first);
    if (token.includes("file")) files_changed = n;
    else if (token.includes("insertion")) insertions = n;
    else if (token.includes("deletion")) deletions = n;
  }

  return { files_changed, insertions, deletions };
}

/**
 * Windows 安全删除目录（R-06 / FR-06）。
 * 策略：
 * 1. fs.rm 内置 maxRetries（处理 EBUSY/EPERM/ENOTEMPTY）。
 * 2. 失败降级：递归 chmod 0o666 + unlink/rmdir（模拟 Python _on_rmtree_error）。
 * 3. 仍失败抛原错误。
 */
async function rmtreeWindowsSafe(dir: string): Promise<void> {
  try {
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  } catch (firstErr) {
    logger.warn(
      `rmtree_retry_fallback path=${dir} code=${(firstErr as NodeJS.ErrnoException).code}`,
    );
    // 降级：递归改可写 + 删除
    try {
      chmodRecursive(dir, 0o666);
      await rm(dir, { recursive: true, force: true });
    } catch (secondErr) {
      logger.warn(
        `rmtree_failed path=${dir} code=${(secondErr as NodeJS.ErrnoException).code}`,
      );
      throw secondErr;
    }
  }
}

/** 递归 chmod（同步，仅在小目录降级路径使用）。 */
function chmodRecursive(dir: string, mode: number): void {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir);
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      chmodRecursive(full, mode);
    } else {
      try {
        chmodSync(full, mode);
      } catch {
        // 单文件 chmod 失败不中断（尽力而为）
      }
    }
  }
  try {
    chmodSync(dir, mode);
  } catch {
    // 目录自身 chmod 失败忽略
  }
}

// logger 占位：task-01 未提供统一 logger 时用 console。
// 后续 task（如 task-04 或 task-19）若引入 pino/winston，此处改为 import。
// 当前保持与 Python logging.getLogger(__name__) 等价的极简输出。
const logger = {
  info: (msg: string): void => console.log(`[workspace] ${msg}`),
  warn: (msg: string): void => console.warn(`[workspace] ${msg}`),
};
```

## 边界处理

| # | 场景 | 处理 |
|---|------|------|
| 1 | **git 命令失败（退出码非 0）** | 抛 `GitError`（结构化，含 args/stderr/code）。task-19 TaskRunner 可 `catch (e) { if (e instanceof GitError) ... }` 分支处理，转 lease 失败上报。**禁止吞错误**——Python 版直接 raise，Node 版同样不重试不降级（git 失败通常是网络/认证/冲突，重试无意义）。 |
| 2 | **仓库目录已存在但 dirty（未提交改动）** | prepareWorkspace 仍走 `pull --ff-only` 分支。若本地有未提交改动且与远程冲突，git 会拒绝 fast-forward（"Your local changes would be overwritten"），退出码非 0 → 走边界 1 抛 GitError。**不自动 stash/discard**（Python 版也不做，保留用户改动）。task-19 可在收到 GitError 后调 cleanWorkspace 重建（由编排层决策，本模块不内嵌）。 |
| 3 | **pull 非 fast-forward（远程有分叉）** | `--ff-only` 标志让 git 在无法 ff 时直接失败（退出码非 0，stderr 含 "Not possible to fast-forward"）。走边界 1 抛 GitError。**禁止 fallback 到 merge/rebase**——Strategy A 是纯 mirror，不允许本地分叉。 |
| 4 | **diff 为空（无改动）** | collectDiff 在 `status --porcelain` 输出 strip 后为空时**立即返回零值**，不执行后续 `git diff --shortstat` / `git diff`（避免空仓库触发 git diff 异常输出）。task-19 收到 `patch === ""` 即判定无产出。 |
| 5 | **Windows rmtree EBUSY/EPERM** | `fs.rm` 的 `maxRetries: 3` + `retryDelay: 100` 自动重试（Node 内置）。仍失败 → 降级 `chmodRecursive(0o666)` + 再删。再失败 → 抛原错误并 `logger.warn` 记录 code。**不静默吞**——清理失败会让下次 prepareWorkspace 拿到脏目录，必须让上层感知。 |
| 6 | **workspace 目录权限不足（无法 mkdir/clone）** | mkdir/clone 失败时抛原始 `NodeJS.ErrnoException`（EACCES）。不包成 GitError（这不是 git 错误）。task-19 应单独处理 EACCES/EEXIST 等文件系统错误。 |
| 7 | **git 子进程超时（60s）** | `execFile` 的 `timeout: 60000` 触发后子进程被 SIGTERM，`err.killed=true`、`err.code` 可能是 `null` 或信号名。走 GitError 分支（exitCode=null），stderr 可能为空。task-19 可据 `err.code === null && err.killed` 判定超时，转为 lease timeout。 |
| 8 | **repoUrl 含特殊字符（空格/分号）** | `execFile` 不经 shell（`shell: false` 默认），args 作为数组原样传递给 git，**无命令注入风险**。空格在 URL 中应已 percent-encode（git 自身要求），本模块不做额外校验。 |
| 9 | **branch 不存在** | `git clone -b <branch>` 失败（"Remote branch xxx not found"），退出码非 0 → GitError。**不 fallback 到默认分支**——Python 版也不做，显式失败优于静默用 main。 |
| 10 | **baseDir 构造时不可写** | `mkdirSync(baseDir, { recursive: true })` 抛 EACCES，构造函数直接抛（同步），WorkspaceManager 实例化失败。task-12（config 加载）应捕获并报配置错误。 |

## 非目标

- **不做 git push**——daemon 是只读 mirror + diff 收集，不回写远程（Strategy A 设计，与 Python 一致）。
- **不实现 git rebase/cherry-pick/merge**——`--ff-only` 是硬约束，不允许本地分叉。
- **不引入 simple-git / isomorphic-git 等库**——直接用 `child_process.execFile` 调系统 git（G-05 零/少依赖，且 Python 版也是直接调 git 二进制）。
- **不做 git 凭证管理**——依赖宿主机 git credential 配置（模块文档明确："不负责 git 认证"）。credential.json 的 GITHUB_TOKEN 通过环境变量传给 agent 子进程（task-19），不注入 git。
- **不做并发 workspace 锁**——同一 workspace 并发 prepareWorkspace 是上层（task-19 TaskRunner）的调度问题，本模块不加锁（Python 版也不加）。
- **不写测试文件**——1:1 迁移 Python `test_workspace.py` 在 task-22 统一处理；本任务只产 `src/workspace.ts`。
- **不实现 logger 抽象**——用 `console.log/warn` 占位，待统一 logger（pino/winston）在后续 task 引入后替换。**禁止**在本任务引入新依赖。
- **不修改 task-01 的 tsconfig/package.json**——本任务在已有工程内增补单文件，零配置改动。

## 参考

- **Python 源**：`sillyhub-daemon/sillyhub_daemon/workspace.py`（195 行，1:1 迁移基准）。
  - `WorkspaceManager` 类（构造 + prepare_workspace + collect_diff + clean_workspace + get_workspace_path + _run_git）。
  - `_on_rmtree_error`（Windows 只读文件 chmod 删除，Node rmtreeWindowsSafe 对齐）。
  - `_parse_shortstat`（shortstat 文本解析，Node parseShortstat 对齐）。
- **design.md §10 R-06**：「git mirror 依赖系统 git，子进程错误处理差异，P2，复用 Python 版错误分支用例；Windows rmtree 兼容沿用现有策略」。本任务承载该项验证：GitError 结构化 + rmtreeWindowsSafe 重试降级。
- **design.md §6 文件清单**：`sillyhub-daemon/src/workspace.ts` 替代 `workspace.py`（git mirror/pull/diff）。
- **design.md §5.1 编排链**：`workspace→CLAUDE.md→credential→backend→diff→submit`——本模块覆盖 workspace + diff 两环，prepareWorkspace 是入口，collectDiff 是产出。
- **requirements.md FR-06**：「workspace git mirror：执行 git mirror / pull --ff-only，执行后 collect git diff 生成 patch + files_changed；Windows 兼容 rmtree」。
- **requirements.md 非功能-跨平台**：「POSIX 下 credential 权限 0600；Windows 下权限操作降级为警告不中断；git/子进程错误处理兼容 Windows」。
- **模块文档**：`.sillyspec/docs/sillyhub-daemon/modules/workspace.md`（契约摘要 + 关键逻辑 + 注意事项：60s 超时、Windows rmtree、shortstat 格式依赖）。
- **依赖项**：
  - task-01（Node 工程初始化）：`tsconfig.json` strict + `package.json` 零依赖约束。
- **被阻塞**：
  - task-19（TaskRunner 编排）：调用 prepareWorkspace / collectDiff / cleanWorkspace，依赖 GitError 类做分支。
  - task-22（1:1 测试迁移）：迁移 `test_workspace.py` 到 `tests/workspace.test.ts`。

## TDD 步骤

> 本任务**不写测试文件**（task-22 统一迁移），但实现需保证 task-22 能直接照搬 Python `test_workspace.py` 用例。以下步骤供 execute 阶段自验证（可临时写 scratch 测试后删除，或留给 task-22）。

1. **临时 fixture：建本地 git 仓库**
   - 在 `os.tmpdir()` 下用 `child_process.execFileSync('git', ['init', ...])` 建一个 bare/normal 仓库，提交一个 commit。
   - 这一步是测试前置，**不入库**（task-22 会规范化为 fixture helper）。

2. **验证 prepareWorkspace clone 分支**
   - 调 `prepareWorkspace('test-ws', repoUrl, branch)`。
   - 断言：返回路径存在 + 含 `.git` + 工作树文件与远程一致。

3. **验证 prepareWorkspace pull 分支**
   - 远程仓库追加一个 commit。
   - 再次调 `prepareWorkspace('test-ws', repoUrl, branch)`（同一 workspaceName）。
   - 断言：本地拉到新 commit（`git log` HEAD 与远程一致）。

4. **验证 collectDiff**
   - 在 workspace 内修改一个文件（`fs.writeFileSync`）。
   - 调 `collectDiff(wsDir)`。
   - 断言：`patch` 含 `diff --git` 头 + `files_changed === 1` + `insertions > 0`。
   - 无改动时调 `collectDiff` → 断言 `patch === ""` 且 `files_changed === 0`。

5. **验证 parseShortstat（纯函数，最易测）**
   - 三种输入：
     - `" 3 files changed, 10 insertions(+), 2 deletions(-)"` → (3, 10, 2)。
     - `" 1 file changed, 5 insertions(+)"` → (1, 5, 0)。
     - `" 2 files changed, 3 deletions(-)"` → (2, 0, 3)。
     - `""` → (0, 0, 0)。
   - 直接 import `parseShortstat` 单测，无需 git fixture。

6. **验证 GitError（R-06 核心）**
   - stub 一个不存在的 git 子命令（如 `git no-such-command`）。
   - 断言：`runGit` 抛 `GitError`，`err instanceof GitError === true`，`err.code` 是退出码（number），`err.stderr` 含 "git: 'no-such-command' is not a git command"。

7. **验证 Windows rmtree 降级（mock platform）**
   - 用 `vi.mock('node:fs')` 让 `rm` 第一次抛 EPERM，第二次成功。
   - 断言：`rmtreeWindowsSafe` 最终成功 + 调过 chmodRecursive（spy）。
   - 或：在 workspace 内手动建一个 `0o400` 只读文件（POSIX 也可复现），调 `cleanWorkspace`，断言目录被删除。

8. **验证超时**
   - stub `execFile` 让其 hang（mock 返回永不 resolve，但 timeout 触发）。
   - 断言：60s 后抛 GitError，code=null（或 killed=true）。
   - 注意：此用例实际跑会等 60s，task-22 可用 `vi.useFakeTimers()` 加速。

9. **跑 tsc**
   - `cd sillyhub-daemon && pnpm typecheck`，断言零错误（strict 模式下 `err.code` 类型收窄、`parts[0]` undefined 检查等都必须通过）。

## 验收标准

| AC | 标准 | 验证方式 |
|----|------|----------|
| AC-01 | `prepareWorkspace` clone 分支：对有效 repoUrl+branch，`git clone -b <branch>` 成功，返回路径含 `.git`，工作树文件与远程一致 | task-22 临时 git fixture 测试 pass；或手工 `cd sillyhub-daemon && node -e "import('./src/workspace.js').then(...)"` 跑一次真实 clone |
| AC-02 | `prepareWorkspace` pull 分支：已存在带 `.git` 的 workspace，调 `git pull --ff-only` 拉到远程新 commit，HEAD 与远程一致；远程无新 commit 时幂等不报错 | 同 AC-01 fixture，连续两次 prepareWorkspace + 远程追加 commit |
| AC-03 | `collectDiff`：无改动返回零值（patch="" / files_changed=0）；有改动返回 patch 含 `diff --git` 头、files_changed/insertions/deletions 与 `git diff --shortstat` 一致；stats 字段为 shortstat 原文 | task-22 测试断言 patch/files_changed/insertions；parseShortstat 纯函数单测覆盖 4 种输入 |
| AC-04 | git 命令失败（退出码非 0）抛 `GitError`（非普通 Error），`err instanceof GitError === true`，`err.code` 为 number，`err.stderr` 非空，`err.message` 含命令名 + 退出码 | stub `git no-such-command` 测试；`grep "class GitError" src/workspace.ts` 命中且 `export class` |
| AC-05 | Windows rmtree 降级：`fs.rm` 抛 EPERM/EBUSY 时，`rmtreeWindowsSafe` 自动重试（maxRetries=3）+ chmod 降级，最终成功删除；force=true 保证目录不存在时不抛 ENOENT | mock `fs.rm` 第一次抛 EPERM 测试 pass；`grep "maxRetries" src/workspace.ts` 命中 `3` |
| AC-06 | `cd sillyhub-daemon && pnpm test`（task-22 迁移完成后）workspace 相关测试全绿；本任务交付时若 task-22 未启动，至少 `pnpm typecheck` 零错误 | 执行 `pnpm typecheck`，退出码 0；`grep "execFile\|child_process" src/workspace.ts` 确认用 execFile 而非 exec |
| AC-07 | `cd sillyhub-daemon && pnpm typecheck` 零错误（strict + noUncheckedIndexedAccess），`parts[0]` 已 undefined 检查，`err.code` 类型收窄正确 | 执行命令查退出码；`grep "parts\[0\] === undefined" src/workspace.ts` 命中 |
