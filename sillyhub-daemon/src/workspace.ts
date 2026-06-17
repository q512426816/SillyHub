// sillyhub-daemon/src/workspace.ts
// 本地 workspace 镜像管理（Strategy A: mirror workspace）。
// 1:1 迁移自 Python sillyhub_daemon/workspace.py 的 WorkspaceManager。
// 承载 R-06（git 子进程错误 + Windows rmtree）风险验证。
//
// 对照 Python:
//   WorkspaceManager.__init__        → constructor
//   prepare_workspace                → prepareWorkspace
//   collect_diff                     → collectDiff
//   clean_workspace                  → cleanWorkspace
//   get_workspace_path               → getWorkspacePath
//   _run_git                         → runGit
//   _parse_shortstat                 → parseShortstat
//   _on_rmtree_error (shutil onexc)  → rmtreeWindowsSafe (fs.rm maxRetries + chmod 降级)

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdirSync,
  rmSync,
  readdirSync,
  statSync,
  chmodSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';

const sleep = promisify(setTimeout);

const execFileAsync = promisify(execFile);

/** git 子进程超时（毫秒），对齐 Python asyncio.wait_for(..., timeout=60)。 */
const GIT_TIMEOUT_MS = 60_000;

/** git diff 输出 maxBuffer（字节），大 diff 防溢出。 */
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

/**
 * diff patch 最大字符数（task-07 / A4）。
 * 对齐 backend diff_collector.py:86 max_diff_size=50_000。
 * 后端 redact_output 的 MAX_OUTPUT_SIZE=64_000（git_gateway/service.py:91）
 * 大于本值，故 daemon 截到 50_000 后后端不会再截（无双截断标记）。
 */
export const MAX_PATCH_CHARS = 50_000;

// logger 占位：task-01 未提供统一 logger 时用 console。
// 后续 task（如 task-04 或 task-19）若引入 pino/winston，此处改为 import。
// 当前保持与 Python logging.getLogger(__name__) 等价的极简输出。
// 注意：const 不提升，必须在被引用的函数定义之前声明（runGit/rmtreeWindowsSafe 都用它）。
const logger = {
  info: (msg: string): void => {
    console.log(`[workspace] ${msg}`);
  },
  warn: (msg: string): void => {
    console.warn(`[workspace] ${msg}`);
  },
};

/**
 * 结构化 git 错误（R-06）。
 * Python 版用 RuntimeError；Node 版升级为具名类，便于 task-19 instanceof 分支。
 *
 * @example
 *   try {
 *     await mgr.prepareWorkspace(...);
 *   } catch (e) {
 *     if (e instanceof GitError) { /* 转换为 lease 失败上报 *\/ }
 *   }
 */
export class GitError extends Error {
  readonly args: readonly string[];
  readonly stderr: string;
  readonly code: number | null;

  constructor(args: readonly string[], stderr: string, code: number | null) {
    super(`git ${args.join(' ')} failed (exit ${code}): ${stderr.trim()}`);
    this.name = 'GitError';
    this.args = args;
    this.stderr = stderr;
    this.code = code;
  }
}

/** collectDiff 返回结构，字段名与 Python dict key 完全一致。 */
export interface WorkspaceResult {
  /** 截断后的 unified diff 文本（≤ MAX_PATCH_CHARS + 尾标，task-07 / A4）。 */
  patch: string;
  /** 改动文件数。 */
  files_changed: number;
  /** 新增行数。 */
  insertions: number;
  /** 删除行数。 */
  deletions: number;
  /** 即 stat_summary：git diff --shortstat 原文 trim 后的人可读串（对齐
   *  backend diff_collector.DiffResult.stat_summary；redact 留后端二次处理）。 */
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
    // 同步创建——构造函数不能 async。
    mkdirSync(baseDir, { recursive: true });
  }

  /**
   * 确保 workspace 存在且为最新。
   * 四分支逻辑：
   *   0. **rootPath 存在且可访问**（ql-20260617-009）：直接返回真实代码目录，跳过 mirror。
   *      bootstrap / scan / task 跑在 workspace.root_path（host path），git diff 是真实改动。
   *   1. mirror 目录已存在 + .git → pull --ff-only
   *   2. 提供了 repoUrl → git clone -b <branch>
   *   3. 无 repoUrl → 创建空目录
   *
   * @param workspaceName workspace 目录名（相对 baseDir，rootPath 不可用时作 mirror 目录名）
   * @param repoUrl git 远程 URL，首次 clone 必填；已存在则忽略
   * @param branch 分支名，默认 "main"
   * @param options.rootPath 真实代码目录（host path）；存在且可访问时优先用作 cwd
   * @returns workspace 目录绝对路径
   */
  async prepareWorkspace(
    workspaceName: string,
    repoUrl?: string,
    branch = 'main',
    options?: { rootPath?: string },
  ): Promise<string> {
    // 分支 0：真实代码目录可用 → 直接返回，跳过 mirror（ql-20260617-009）
    if (options?.rootPath) {
      try {
        const st = statSync(options.rootPath);
        if (st.isDirectory()) {
          logger.info(`workspace_use_real_root path=${options.rootPath}`);
          return options.rootPath;
        }
        logger.warn(
          `workspace_root_path_not_dir path=${options.rootPath} fallback=mirror`,
        );
      } catch (e) {
        logger.warn(
          `workspace_root_path_inaccessible path=${options.rootPath} error=${
            (e as Error).message
          } fallback=mirror`,
        );
      }
    }

    const wsDir = join(this.baseDir, workspaceName);
    const hasGit = existsSync(join(wsDir, '.git'));

    if (existsSync(wsDir) && hasGit) {
      // 分支 1：已存在 + .git → pull --ff-only（cwd=wsDir）
      await runGit(['pull', '--ff-only'], wsDir, false);
      logger.info(`workspace_pulled path=${wsDir}`);
    } else if (repoUrl) {
      // 分支 2：clone（cwd=baseDir，目标目录由 git 创建）
      // 对齐 Python: git clone -b branch url dest
      await runGit(
        ['clone', '-b', branch, repoUrl, wsDir],
        this.baseDir,
        false,
      );
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
   * 无改动时返回零值（patch="" / files_changed=0 / ...）。
   *
   * 对齐 Python collect_diff：
   *   1. git status --porcelain 为空 → 直接返回零值
   *   2. 否则 git diff --shortstat + git diff 拿完整 patch
   *
   * ql-20260617-014：rootPath 模式下 workspace 可能不是 git 仓库（项目未 git init），
   * 入口先检查 .git 存在性，不存在直接返回 EMPTY_DIFF，避免 runGit 抛 GitError
   * 在 task-runner 触发 diff_collect_failed 噪声日志（已被 catch 但污染 daemon log）。
   */
  async collectDiff(workspaceDir: string): Promise<WorkspaceResult> {
    if (!existsSync(join(workspaceDir, '.git'))) {
      logger.info(`workspace_not_git_repo skip_collect_diff path=${workspaceDir}`);
      return {
        patch: '',
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        stats: '',
      };
    }

    const status = await runGit(['status', '--porcelain'], workspaceDir, true);

    if (!status.trim()) {
      return {
        patch: '',
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        stats: '',
      };
    }

    const shortstat = await runGit(['diff', '--shortstat'], workspaceDir, true);
    const diffOutput = await runGit(['diff'], workspaceDir, true);
    const { files_changed, insertions, deletions } =
      parseShortstat(shortstat);

    // task-07 / A4：patch 超 MAX_PATCH_CHARS 截断 + 尾标
    // （对齐 backend diff_collector.py:168-170，redact 留后端 redact_output）
    let patch = diffOutput;
    if (diffOutput.length > MAX_PATCH_CHARS) {
      patch = diffOutput.slice(0, MAX_PATCH_CHARS) + '\n...[truncated]';
    }

    return {
      patch,
      files_changed,
      insertions,
      deletions,
      stats: shortstat.trim(), // 即 stat_summary（redact 留后端二次处理）
    };
  }

  /**
   * 删除 workspace 目录（Windows rmtree 兼容）。
   * 目录不存在时静默成功（force=true，对齐 Python if ws_dir.exists() 守卫）。
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
 *
 * @param args git 参数（不含 "git" 前缀）
 * @param cwd 工作目录
 * @param capture 是否捕获 stdout；false 时丢弃 stdout（对齐 Python DEVNULL）
 * @returns stdout 文本（capture=false 时返回 ""）
 * @throws GitError 当退出码非 0
 *
 * 对齐 Python _run_git：
 *   - asyncio.create_subprocess_exec → execFile（不经 shell，无注入风险）
 *   - asyncio.wait_for(timeout=60)   → timeout: 60_000
 *   - returncode != 0 → GitError（Python 抛 RuntimeError）
 *   - capture=false → stdout 重定向到 DEVNULL 等价
 */
async function runGit(
  args: readonly string[],
  cwd: string,
  capture: boolean,
): Promise<string> {
  try {
    // execFile 不支持 stdio option（仅 spawn 支持）。capture=false 时仍会捕获 stdout，
    // 但下面 return '' 直接丢弃，等价 DEVNULL；stderr 始终经 err.stderr 暴露以构造 GitError。
    const { stdout } = await execFileAsync('git', [...args], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      encoding: 'utf8',
    });
    return capture ? stdout : '';
  } catch (e) {
    const err = e as NodeJS.ErrnoException & {
      code?: number | string;
      stderr?: string;
      stdout?: string;
      killed?: boolean;
      signal?: string;
    };
    // execFile 失败时：
    //   - git 退出码非 0 → err.code 是 number（退出码）
    //   - 系统错误（ENOENT git 未装）→ err.code 是 string（如 'ENOENT'）
    //   - 超时 → err.killed=true，err.code 可能是 null/signal 名
    const exitCode = typeof err.code === 'number' ? err.code : null;
    const stderr = err.stderr ?? '';
    throw new GitError(args, stderr, exitCode);
  }
}

/**
 * 解析 git diff --shortstat 输出。
 *
 * 示例输入：
 *   " 3 files changed, 10 insertions(+), 2 deletions(-)"
 *   " 1 file changed, 5 insertions(+)"
 *   " 2 files changed, 3 deletions(-)"
 *
 * 对齐 Python _parse_shortstat：按 "," 切分，每段按空白切，首 token 是数字时归类到
 * file/insertion/deletion（依据段中是否含对应关键词）。
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
  if (!text) {
    return { files_changed, insertions, deletions };
  }

  for (const raw of text.split(',')) {
    const token = raw.trim();
    const parts = token.split(/\s+/);
    const first = parts[0];
    // noUncheckedIndexedAccess：first 是 string | undefined
    if (first === undefined || !/^\d+$/.test(first)) {
      continue;
    }
    const n = Number(first);
    if (token.includes('file')) {
      files_changed = n;
    } else if (token.includes('insertion')) {
      insertions = n;
    } else if (token.includes('deletion')) {
      deletions = n;
    }
  }

  return { files_changed, insertions, deletions };
}

/**
 * Windows 安全删除目录（R-06 / FR-06）。
 *
 * 对齐 Python shutil.rmtree(path, onexc=_on_rmtree_error)。Python 版本身是同步的，
 * Node 版采用同步实现（fs.rmSync）以确保删除在返回前真正完成——
 * Node v26 的 fs.promises.rm 在 vitest 等异步调度环境下存在 rimraf 内部
 * callback 链竞态（promise resolve 但底层未完成 + "callback is not a function"），
 * 同步版无此问题，且 rmtree 是终点操作，短暂阻塞事件循环可接受。
 *
 * 策略：
 *   1. force:true 直接删（目录不存在时静默成功，对齐 Python if ws_dir.exists() 守卫）。
 *   2. 失败（EBUSY/EPERM/ENOTEMPTY 等瞬时错误）→ 重试 maxRetries 次，间隔 retryDelay。
 *   3. 仍失败 → 降级：递归 chmod 0o666（模拟 Python os.chmod(stat.S_IWRITE)）+ 再次删。
 *   4. 再失败 → 抛最后一个错误，logger.warn 记录。
 */
async function rmtreeWindowsSafe(dir: string): Promise<void> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 100;

  let lastErr: unknown = null;

  // 第 1+2 阶段：直接删 + 重试
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return; // 成功
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code;
      // ENOENT（force 应已规避，但保险起见）直接视为成功
      if (code === 'ENOENT') {
        return;
      }
      if (
        attempt < MAX_RETRIES &&
        (code === 'EBUSY' ||
          code === 'EPERM' ||
          code === 'ENOTEMPTY' ||
          code === 'EMFILE' ||
          code === 'ENFILE')
      ) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      break; // 不可重试的错误，进入降级阶段
    }
  }

  // 第 3 阶段：降级——chmod 改可写后重试
  logger.warn(
    `rmtree_retry_fallback path=${dir} code=${
      (lastErr as NodeJS.ErrnoException)?.code ?? 'unknown'
    }`,
  );
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // 模拟 Python _on_rmtree_error：把只读文件（git objects）改可写
      chmodRecursive(dir, 0o666);
      rmSync(dir, { recursive: true, force: true });
      return; // 降级成功
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return;
      }
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
    }
  }

  // 第 4 阶段：彻底失败
  logger.warn(
    `rmtree_failed path=${dir} code=${
      (lastErr as NodeJS.ErrnoException)?.code ?? 'unknown'
    }`,
  );
  throw lastErr;
}

/**
 * 递归 chmod（同步，仅在小目录降级路径使用）。
 * 模拟 Python _on_rmtree_error 的 os.chmod(path, stat.S_IWRITE)，
 * 把所有文件（含 git objects 只读文件）改可写以便删除。
 */
function chmodRecursive(dir: string, mode: number): void {
  if (!existsSync(dir)) {
    return;
  }
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
        // 单文件 chmod 失败不中断（尽力而为，最终 rm 会处理）
      }
    }
  }
  try {
    chmodSync(dir, mode);
  } catch {
    // 目录自身 chmod 失败忽略
  }
}
