/**
 * `host_fs.*` RPC handler —— daemon 端宿主文件系统操作委托（task-03 / FR-02 + task-02 P3 run_command）。
 *
 * 实现 design §5.2 的 daemon 侧 host_fs handler：接收 backend 经 per-daemon WS
 * （DaemonWsHub.send_rpc）转发的 `host_fs.<method>` 请求，在宿主（Windows / Linux / macOS）
 * 执行 stat / read_file / list_dir / git_apply / git_rev_parse / pollution_archive /
 * read_package_json / read_local_yaml / run_command 九方法，返回结构化结果。
 *
 * **职责定位**：
 *   - 本模块是 host_fs 业务层，由 daemon.ts 包装成 RpcHandler 注册到 WsClient
 *     （与 file-rpc.ts:listDir 同模式）。
 *   - ws-client.ts 只收发分发，不内嵌 fs/git 逻辑（design 职责分离）。
 *   - complete_lease 收尾的 3 个宿主操作（apply_patch / post_scan / stage_callback）
 *     经 backend HostFsDelegate（task-01）+ ws_rpc（task-02）调到本 handler。
 *
 * **每方法统一骨架**（task-03 implementation 第 2 点）：
 *   1. `assertWithinAllowedRoots` 白名单守卫（复用 file-rpc.ts，防 path 穿越到宿主敏感路径）。
 *   2. 执行宿主操作（fs / git child_process）。
 *   3. `toRpcError` 兜底（fs 错误码 → 稳定 RpcError code；git 命令失败结构化回传不抛）。
 *
 * **复用关系**（spike-01 选型 + task-03 constraints 第 7 条）：
 *   - `assertWithinAllowedRoots`：直接 import file-rpc.ts（白名单校验，D-002 穿越防护）。
 *   - `listDir`：直接 import file-rpc.ts 并 re-export 到 HostFsHandler.list_dir 契约
 *     （已实现 + 有测试，零行为变更）。
 *   - `toRpcError`：file-rpc.ts 内为模块私有（未 export），本模块本地实现一份等价映射
 *     （fs 错误码 → RpcError code，逻辑与 file-rpc.ts:196-209 字符级对齐），不污染
 *     file-rpc.ts 的单一职责（list_dir 专属）。
 *
 * **D-008 幂等契约**（task-03 constraints 第 1 条 / 支撑 task-04 patch_id 去重）：
 *   git_apply 先跑 `git apply --check`：
 *     - check 通过 + patch 已含于工作树（再 apply 会报错）→ `skipped:true` 不重复 apply。
 *     - check 通过 + 需写入 → 跑 `git apply`。
 *     - check 失败 + use_3way → `git apply --3way` 兜底。
 *     - 仍失败 → `{ok:false, conflict_detail:<stderr>}`，**不抛**（结构化回传让 backend
 *       判定 PatchConflictError）。
 *
 * **跨平台路径**（task-03 constraints 第 3 条）：
 *   - assertWithinAllowedRoots 内部已做 Windows 盘符大小写归一 + 反斜杠处理（file-rpc.ts:82-95）。
 *   - git 命令用 `execFile`（非 shell）+ `cwd:workdir`，不依赖 shell，防注入。
 *
 * **非目标**：
 *   - 不做权限精细化裁决（per-runtime PolicyEngine 是 list_dir 专属；host_fs 走 daemon
 *     实体级 allowed_roots，与 list_dir RPC handler 等价）。
 *   - 不做 patch_id 去重本身（task-04 D-008 职责；本 handler 只提供 skipped 信号）。
 *   - 不做 RPC 协议匹配（rpc_id 匹配由 task-02 backend 侧 + ws-client.ts:_dispatchRpc 负责）。
 *
 * @module host-fs-handler
 */

import { lstat, readFile, readdir, rename, mkdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, resolve as pathResolve } from 'node:path';
import yaml from 'js-yaml';
import { RpcError } from './ws-client.js';
import {
  assertWithinAllowedRoots,
  listDir,
  type ListDirResult,
} from './file-rpc.js';

// ── 类型定义（与 backend HostFsDelegate / design §7 三端对齐）─────────────────

/** stat 返回结构：`{ exists, is_dir, size }`（不存在 → `{exists:false}`，不抛）。 */
export interface StatResult {
  exists: boolean;
  is_dir: boolean;
  size: number;
}

/** git_apply 返回结构：`{ ok, conflict_detail, skipped }`（D-008 幂等 + task-04 消费）。 */
export interface GitApplyResult {
  /** apply 是否成功（含 skipped 场景算成功：幂等目标已达成）。 */
  ok: boolean;
  /** 冲突详情（check/3way 失败时的 stderr；成功时为空串）。 */
  conflict_detail: string;
  /** 是否跳过实际 apply（patch 已含于工作树，幂等命中）。 */
  skipped: boolean;
}

// ── task-02 worktree 三方法返回结构（design §7 RPC 表 + §7.5 契约表）──────────────

/**
 * 单个冲突文件描述（git_merge 解析 `git diff --name-only --diff-filter=U` 输出 +
 * 读冲突标记行数 `<<<<<<< / ======= / >>>>>>>`，喂主 agent LLM 解决）。
 */
export interface MergeConflict {
  /** 冲突文件相对路径（git diff --name-only 输出的相对路径，原样回传）。 */
  file: string;
  /** 文件内冲突标记行数（<<<<<<< / ======= / >>>>>>> 总行数，≥2 才算真冲突）。 */
  marker_lines: number;
}

/**
 * git_worktree_add 返回结构（design §7：`{ ok, worktree_path, error }`）。
 *
 *   - 成功：`{ ok:true, worktree_path: <sibling_path>, error: undefined }`。
 *   - 失败（git exit 非 0）：`{ ok:false, worktree_path: undefined, error: <stderr> }`
 *     （**不抛**，结构化回传让 backend 标 worker run failed，不崩 mission）。
 */
export interface GitWorktreeAddResult {
  ok: boolean;
  /** 成功时的副本绝对路径；失败时缺省。 */
  worktree_path?: string;
  /** 失败时的 git stderr 文案；成功时缺省。 */
  error?: string;
}

/**
 * git_merge 返回结构（design §7：`{ ok, conflicts, merged_files, error }`）。
 *
 *   - 成功：`{ ok:true, conflicts:[], merged_files?: [...] }`。
 *   - 冲突（exit 1 + 冲突文件）：`{ ok:false, conflicts:[{file,marker_lines}], merged_files:[] }`。
 *
 * `merged_files` 字段对齐 design §7 返回结构；当前实现不解析（git merge --no-ff 成功
 * 时 stdout 非结构化），缺省回空数组，留 backend consume 时降级用 conflicts 判定。
 */
export interface GitMergeResult {
  ok: boolean;
  /** 冲突文件列表（成功为 []，失败且无冲突识别也为 []）。 */
  conflicts: MergeConflict[];
  /** 成功合并的文件列表（当前实现回 []，留扩展）。 */
  merged_files: string[];
  /** 失败时的错误文案；成功时缺省。 */
  error?: string;
}

/**
 * git_worktree_remove 返回结构（design §7：`{ ok, error }`）。
 *
 *   - 成功：`{ ok:true }`。
 *   - 失败：`{ ok:false, error: <stderr> }`（不抛，结构化回传；backend cleanup 路径
 *     失败仅记 warning，不阻塞 mission 收尾，对齐 design §9 兼容策略）。
 */
export interface GitWorktreeRemoveResult {
  ok: boolean;
  /** 失败时的 git stderr 文案；成功时缺省。 */
  error?: string;
}

/** git_rev_parse 返回结构：`{ commit, error }`（非 git 仓库 → commit=null + error 文案）。 */
export interface GitRevParseResult {
  /** HEAD commit hash；非 git 仓库 / git 不可用时为 null。 */
  commit: string | null;
  /** 失败原因代号（not_git_repo / git_timeout / git_not_found / <exception str>）；成功为 null。 */
  error: string | null;
}

/** pollution_archive 返回结构（对齐 backend post_scan_validator._archive_and_clean_pollution）。 */
export interface PollutionArchiveResult {
  /** 是否成功归档（source 不存在 / 空也算 false，但不抛）。 */
  archived: boolean;
  /** 归档目标路径；未归档时为 null。 */
  archive_path: string | null;
  /** 归档文件数（source 下 .sillyspec 树的文件总数）。 */
  file_count: number;
  /** 归档失败时的错误文案；成功时缺省。 */
  error?: string;
}

/** read_package_json / read_local_yaml 返回 dict | null（不存在 → null）。 */
export type ReadDictResult = Record<string, unknown> | null;

/**
 * run_command 返回结构（task-02 / design §7 + backend HostFsDelegate.run_command 契约，
 * 三端字段级对齐）。
 *
 *   - `exit_code`：子进程 exit code（0=成功 / 124=超时 / 126=命令被白名单拒绝 / 命令自身退出码）。
 *   - `stdout` / `stderr`：子进程标准输出/错误（utf8 字符串）。
 *   - `duration_ms`：从方法入口到 callback 回来的墙钟耗时（Date.now 差值）。
 *
 * **不抛**：白名单拒绝、超时、子进程非 0 退出都结构化回传（让 backend 记审计/决策，
 * 与 git_apply D-008 不抛语义一致）。cwd 越界是安全守卫，仍抛 forbidden（RpcError）。
 */
export interface RunCommandResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

/** run_command 入参（对齐 design §7 / task-01 backend HostFsDelegate.run_command 契约）。 */
export interface RunCommandParams {
  /** 可执行命令（白名单只允 `sillyspec`）。 */
  command: string;
  /** 命令参数（白名单约束为 gate 模板形状）。 */
  args: string[];
  /** 工作目录（先过 assertWithinAllowedRoots 防穿越）。 */
  cwd: string;
  /** execFile 超时（ms，透传调用方值，不写死；超时 → exit_code 124）。 */
  timeout: number;
  /** 环境变量覆盖（合并到 process.env 之上，不清空 PATH）；null/空走默认环境。 */
  env: Record<string, string> | null;
}

/**
 * HostFsHandler 构造参数：daemon 实体级 allowed_roots（与 list_dir RPC handler 同源，
 * 取自 DaemonConfig.allowed_roots）。每方法调 assertWithinAllowedRoots 时透传。
 */
export interface HostFsHandlerOptions {
  allowed_roots: string[];
}

// ── toRpcError（本地实现，逻辑与 file-rpc.ts:196-209 等价）─────────────────────
//
// spike-01 / task-03 蓝图说复用 file-rpc.ts:toRpcError，但该函数在 file-rpc.ts 是
// 模块私有（未 export，仅服务 listDir）。本模块为 host_fs 九方法的 fs 错误兜底，
// 复制一份等价映射（fs errno → RpcError code），保持 file-rpc.ts 单一职责不被破坏。
// 映射规则与 file-rpc.ts:196-209 / listDir 错误码语义字符级对齐，确保跨模块一致。

/**
 * 把 fs 错误映射成稳定的 RpcError code（task-03 验收：tsc 严格类型 + 不抛 unknown）。
 *
 *   - ENOENT / ENOTDIR → `not_found`
 *   - EACCES / EPERM   → `internal`（message 统一 "permission denied"，不泄漏详情）
 *   - 其他              → `internal`（原 message 透传，便于排查）
 *
 * `where` 前缀（如 `'stat.lstat'`）便于日志定位（与 file-rpc.ts 风格一致）。
 */
function toRpcError(e: unknown, where: string): RpcError {
  const code =
    typeof e === 'object' && e !== null && 'code' in e
      ? (e as { code: string }).code
      : '';
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new RpcError('not_found', `${where}: not found`);
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new RpcError('internal', `${where}: permission denied`);
  }
  const msg = e instanceof Error ? e.message : String(e);
  return new RpcError('internal', `${where}: ${msg}`);
}

// ── run_command 命令白名单（task-02 / R3 / AC-8）─────────────────────────────
//
// 现有 8 方法靠 assertWithinAllowedRoots（路径白名单）防穿越；run_command 要在宿主
// 跑命令，需命令白名单（design §5.3「命令白名单安全层」新抽象）。判定规则与 task-01
// backend 侧 delegate.py:_enforce_command_whitelist **字符级对齐**（同一 gate 模板
// 复制两份，双端必须一致否则 backend 放行的 args daemon 侧被拒 → gate 永远跑不了）：
//
//   只允 command === 'sillyspec' 且 args 头部精确匹配
//     `['gate', 'verify', '--change', <changeName>, '--json']`（changeName 任意非空，
//     字符集不约束——gate 任务已对 change_id 做来源校验，白名单只守结构，与 backend
//     delegate.py:792 `or not head[3]` 一致），尾部可追加白名单 flag（当前仅 `--stage`，
//     必须成对 flag+value，value 字符集不约束，与 backend delegate.py:799-815 一致）。
//
// execFile 非 shell（host-fs-handler 内调用）是第二道防线：即便白名单漏放，也无法
// 经 shell 拼接注入（命令与参数分立传递）。backend 层是第一道防线（RPC 前拦截）。

/** gate verify 模板头部固定前缀长度（= `["gate","verify","--change",<name>,"--json"]`）。 */
const GATE_VERIFY_PREFIX_LEN = 5;

/**
 * gate verify 尾部允许的 flag 白名单（design §5.3：stage 枚举等已知 flag）。
 * 新增 gate 模板参数需在此登记，否则 run_command 拒绝（R3 防任意命令注入）。
 * 与 backend delegate.py:684 `_GATE_VERIFY_TAIL_FLAG_WHITELIST` 字符级对齐。
 */
const GATE_VERIFY_TAIL_FLAG_WHITELIST: ReadonlySet<string> = new Set(['--stage']);

/**
 * 判定 run_command 请求是否命中 gate 模板白名单（task-02 / R3 / AC-8）。
 *
 * **与 task-01 backend delegate.py:_enforce_command_whitelist 字符级对齐**：
 *   - command 必须严格等于 `'sillyspec'`（不允许带路径，防 `../evil/sillyspec`）。
 *   - args 长度 >= 5（前缀 5 + 尾部成对 flag+value）。
 *   - 头部 5 元素精确匹配：`['gate', 'verify', '--change', <非空 changeName>, '--json']`
 *     （changeName 任意非空字符串，字符集不约束，与 backend `or not head[3]` 一致）。
 *   - 尾部 args 成对消费：每个 flag 必须在 GATE_VERIFY_TAIL_FLAG_WHITELIST 内且必须
 *     带值（flag + value 成对，无值则拒），value 字符集不约束（与 backend delegate.py:799-815 一致）。
 *
 * 非命中（rm / ls / sillyspec derive / 乱序 flag / 未知 flag / 缺值 flag）→ false，
 * 由 runCommand 返回 exit_code 126（不执行，结构化回传）。
 */
export function isGateCommand(command: string, args: string[]): boolean {
  if (command !== 'sillyspec') return false;
  if (!Array.isArray(args)) return false;
  if (args.length < GATE_VERIFY_PREFIX_LEN) return false;

  // 头部结构精确匹配：args[0..2] + args[4] 固定 token，args[3] 为任意非空 changeName
  //（与 backend delegate.py:787-793 一致——changeName 只守非空，不约束字符集）。
  if (
    args[0] !== 'gate' ||
    args[1] !== 'verify' ||
    args[2] !== '--change' ||
    args[4] !== '--json' ||
    !args[3]
  ) {
    return false;
  }

  // 尾部 flag 必须在白名单内且成对 flag+value（与 backend delegate.py:800-815 一致）。
  const tail = args.slice(GATE_VERIFY_PREFIX_LEN);
  let i = 0;
  while (i < tail.length) {
    const flag = tail[i];
    if (typeof flag !== 'string' || !GATE_VERIFY_TAIL_FLAG_WHITELIST.has(flag)) {
      return false;
    }
    // 白名单 flag 需带值（--stage <value>）——成对消费，无值则拒。
    if (i + 1 >= tail.length) return false;
    // value（tail[i+1]）字符集不约束（与 backend 一致，gate 任务负责值校验）。
    i += 2;
  }
  return true;
}

// ── execFile 封装 + git 命令统一执行器 ────────────────────────────────────────
//
// 不用 promisify(execFile)：@types/node 对 promisify 重载的返回类型推断在 Buffer/string
// 分支上不够精确（stdout/stderr 类型导致 .toString('utf8') 报 "Expected 0 arguments"）。
// 直接用 callback 形式，类型显式可控。

/** execFile 超时（对齐 backend post_scan_validator 的 10s + patch/service.py 子进程语义）。 */
const GIT_TIMEOUT_MS = 10_000;

/** execFile 调用结果（buffer 自行 toString，类型显式）。 */
interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * 执行一条命令（execFile 非 shell，防注入），喂 stdin + 收 stdout/stderr。
 * 超时 / exit!=0 → ok:false（不抛，由调用方判定结构化返回）。
 */
function runCmd(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number; input?: string } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeout,
        maxBuffer: 10 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        const out = Buffer.isBuffer(stdout)
          ? stdout.toString('utf8')
          : stdout ?? '';
        const errOut = Buffer.isBuffer(stderr)
          ? stderr.toString('utf8')
          : stderr ?? '';
        if (err) {
          resolve({ ok: false, stdout: out, stderr: errOut });
        } else {
          resolve({ ok: true, stdout: out, stderr: errOut });
        }
      },
    );
    if (opts.input !== undefined && child.stdin) {
      child.stdin.on('error', () => {
        /* EPIPE if child exited before reading stdin — ignore, exit code captures it. */
      });
      child.stdin.end(opts.input);
    }
  });
}

/**
 * git apply 子命令统一执行器（对齐 backend patch/service.py:144-161 _run_git_apply）。
 *
 * @param workdir     工作目录（cwd，execFile 非 shell，防注入）。
 * @param args        git 子命令参数（如 `['apply', '--check']`）。
 * @param patchData   stdin 输入（unified diff）。
 * @returns `{ ok, stderr }`——ok=exit code 0；stderr 去首尾空白。
 */
async function runGitApply(
  workdir: string,
  args: string[],
  patchData: string,
): Promise<{ ok: boolean; stderr: string }> {
  const r = await runCmd('git', args, {
    cwd: workdir,
    timeout: GIT_TIMEOUT_MS,
    input: patchData,
  });
  return { ok: r.ok, stderr: r.stderr.trim() };
}

/**
 * git rev-parse HEAD（对齐 backend post_scan_validator._get_source_commit）。
 *
 * 含 safe.directory dubious ownership 重试：detected 时跑 `git config --global --add
 * safe.directory <root>` 再重试一次 rev-parse（与 Python 等价）。
 */
async function runGitRevParse(
  root: string,
  ref: string = 'HEAD',
): Promise<{ commit: string | null; error: string | null }> {
  async function tryOnce(): Promise<{
    commit: string | null;
    error: string | null;
    stderr: string;
  }> {
    const r = await runCmd(
      'git',
      ['-C', root, 'rev-parse', ref],
      { timeout: GIT_TIMEOUT_MS },
    );
    if (r.ok) {
      const commit = r.stdout.trim();
      if (commit) return { commit, error: null, stderr: r.stderr };
      return { commit: null, error: 'not_git_repo', stderr: r.stderr };
    }
    // exit code / 错误映射（对齐 Python FileNotFoundError → git_not_found / TimeoutExpired → git_timeout）。
    if (/ENOENT|spawn [^ ]+ ENOENT/i.test(r.stderr)) {
      return { commit: null, error: 'git_not_found', stderr: r.stderr };
    }
    if (/timed out|ETIMEDOUT/i.test(r.stderr)) {
      return { commit: null, error: 'git_timeout', stderr: r.stderr };
    }
    return { commit: null, error: 'not_git_repo', stderr: r.stderr };
  }

  const first = await tryOnce();
  if (first.commit) return { commit: first.commit, error: null };

  // dubious ownership 重试（对齐 Python：stderr 含 "dubious" 时加 safe.directory 再跑）。
  if (/dubious/i.test(first.stderr)) {
    await runCmd(
      'git',
      ['config', '--global', '--add', 'safe.directory', root],
      { timeout: 5_000 },
    ).catch(() => undefined);
    const retry = await tryOnce();
    if (retry.commit) return { commit: retry.commit, error: null };
    return { commit: null, error: retry.error ?? 'not_git_repo' };
  }

  return { commit: first.commit, error: first.error ?? 'not_git_repo' };
}

// ── HostFsHandler：九方法宿主实现 ─────────────────────────────────────────────

/**
 * daemon 侧 host_fs handler 业务层（task-03 八方法 + task-02 P3 run_command 第九方法）。
 *
 * 九方法 1:1 对齐 design §5.1 / §5.3 / backend HostFsDelegate 签名（跨任务契约锁死）。
 * 由 daemon.ts:_registerHostFsRpcHandler 包装成 RpcHandler 注册到 WsClient。
 */
export class HostFsHandler {
  private readonly _allowedRoots: string[];

  constructor(opts: HostFsHandlerOptions) {
    this._allowedRoots = opts.allowed_roots;
  }

  // ── stat ──────────────────────────────────────────────────────────────────

  /**
   * `stat(path) → { exists, is_dir, size }`（fs/promises.lstat）。
   *
   * 不存在返回 `{exists:false}` 而非抛（区分「文件不存在」与「读失败」，
   * 对齐 backend stat 语义；前端/校验逻辑靠 exists 字段判定）。
   */
  async stat(path: string): Promise<StatResult> {
    assertWithinAllowedRoots(path, this._allowedRoots);
    const abs = pathResolve(path);
    try {
      const info = await lstat(abs);
      return {
        exists: true,
        is_dir: info.isDirectory(),
        size: info.size,
      };
    } catch (e) {
      const code =
        typeof e === 'object' && e !== null && 'code' in e
          ? (e as { code: string }).code
          : '';
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return { exists: false, is_dir: false, size: 0 };
      }
      throw toRpcError(e, 'host_fs.stat.lstat');
    }
  }

  // ── read_file ─────────────────────────────────────────────────────────────

  /**
   * `read_file(path) → string`（fs/promises.readFile utf8）。
   *
   * 越界抛 `forbidden`（assertWithinAllowedRoots）；不存在抛 `not_found`（toRpcError）。
   */
  async readFile(path: string): Promise<string> {
    assertWithinAllowedRoots(path, this._allowedRoots);
    const abs = pathResolve(path);
    try {
      return await readFile(abs, 'utf8');
    } catch (e) {
      throw toRpcError(e, 'host_fs.read_file');
    }
  }

  // ── list_dir ──────────────────────────────────────────────────────────────

  /**
   * `list_dir(path) → ListDirResult`（直接复用 file-rpc.ts:listDir，零行为变更）。
   *
   * task-03 constraints 第 7 条：list_dir 复用不重写。listDir 已落地 + 有测试，
   * 本方法只 re-export 到 HostFsHandler 契约（policyEngine=null 走 fallback_roots
   * 分支，与 daemon.ts:_registerListDirRpcHandler 同模式）。
   */
  async listDir(path: string): Promise<ListDirResult> {
    return listDir(path, null, '', this._allowedRoots);
  }

  // ── git_apply（D-008 幂等契约核心）─────────────────────────────────────────

  /**
   * `git_apply({ workdir, patch_data, use_3way }) → { ok, conflict_detail, skipped }`。
   *
   * 三路径（对齐 backend patch/service.py:48-161 + 新增 D-008 skipped 幂等信号）：
   *
   *   1. `git apply --check` 预检：
   *      - check 通过 + 紧跟 `git apply` 若报 "already applied" / 无变化 → `skipped:true`。
   *      - check 通过 + apply 成功 → `ok:true, skipped:false`。
   *   2. check 失败 + use_3way → `git apply --3way` 兜底：
   *      - 成功 → `ok:true`。
   *      - 失败 → `ok:false, conflict_detail:<3way stderr>`。
   *   3. check 失败 + !use_3way → `ok:false, conflict_detail:<check stderr>`。
   *
   * **不抛**（结构化回传让 backend 判定 PatchConflictError / PatchApplyError）。
   *
   * skipped 判定：check 通过但 `git apply` 实际跑时 exit!=0 且 stderr 含
   * "already applied" / "no changes" → 视为幂等命中（patch 已含于工作树）。
   */
  async gitApply(params: {
    workdir: string;
    patch_data: string;
    use_3way: boolean;
  }): Promise<GitApplyResult> {
    assertWithinAllowedRoots(params.workdir, this._allowedRoots);
    const workdir = pathResolve(params.workdir);

    // 1. git apply --check 预检（D-008 幂等铺垫）。
    const check = await runGitApply(workdir, ['apply', '--check'], params.patch_data);

    if (check.ok) {
      // 2a. check 通过 → 跑真实 apply。
      const apply = await runGitApply(workdir, ['apply'], params.patch_data);
      if (apply.ok) {
        return { ok: true, conflict_detail: '', skipped: false };
      }
      // apply 失败：若语义是「已 applied / 无变化」→ skipped（D-008 幂等命中）。
      const detail = apply.stderr.toLowerCase();
      if (
        detail.includes('already applied') ||
        detail.includes('no changes') ||
        detail.includes('nothing to commit')
      ) {
        return { ok: true, conflict_detail: apply.stderr, skipped: true };
      }
      // check 通过但 apply 失败且非幂等 → 异常路径（对齐 backend PatchApplyError 语义，
      // 但本 handler 不抛，结构化回传 ok:false）。
      return { ok: false, conflict_detail: apply.stderr, skipped: false };
    }

    // 2b. check 失败。
    if (!params.use_3way) {
      return { ok: false, conflict_detail: check.stderr, skipped: false };
    }

    // 3. check 失败 + use_3way → 3way 兜底。
    const threeWay = await runGitApply(
      workdir,
      ['apply', '--3way'],
      params.patch_data,
    );
    if (threeWay.ok) {
      return { ok: true, conflict_detail: '', skipped: false };
    }
    // 3way 也失败：冲突详情合并 check + 3way stderr（对齐 backend PatchConflictError.details）。
    const merged = [check.stderr, threeWay.stderr].filter(Boolean).join('\n---\n');
    return { ok: false, conflict_detail: merged, skipped: false };
  }

  // ── git_worktree_add（task-02 / design §7 / D-008 默认 identity）─────────────

  /**
   * `git_worktree_add({ workdir, sibling_path, branch, base_ref }) → { ok, worktree_path, error }`。
   *
   * task-02（2026-07-12-worker-worktree-isolation）三方法之一：在 workspace root 之外
   * 创建 sibling worktree 副本（per-worker 隔离，D-001@v1），跑：
   *
   *   `git -C <workdir> -c user.name=worker -c user.email=worker@sillyhub
   *      worktree add <sibling_path> -b <branch> <base_ref>`
   *
   * **D-008 默认 identity（R-08）**：透传 `-c user.name=worker -c user.email=worker@sillyhub`
   * 让 worker 在副本 `git commit` 时不依赖宿主机全局 git config（worker 进程无 identity 会
   * commit 失败）。`-c` 是 per-invocation override，不污染宿主全局 / 副本 .git/config 之外
   * 的状态（merge / remove 不重复传，因为 worker commit 已完成，副本 identity 已就位）。
   *
   * **base_ref 空兜底**（X-001）：`ws.default_branch` 为空时兜底 `HEAD`（execution.py:106
   * 同款可空语义），避免 `git worktree add <path> -b <branch> `（空 ref 报错）。
   *
   * **不抛**：git exit 非 0 → `{ ok:false, error: <stderr> }`（结构化回传让 backend 标
   * worker run failed，不崩 mission，对齐 design §9 兼容策略 + gitApply D-008 不抛语义）。
   *
   * **安全守卫**：workdir + sibling_path 都过 `assertWithinAllowedRoots`（防 sibling 写到
   * 宿主敏感位置如 /etc/<runid>，与 gitApply :479 同款 forbidden 抛出）。
   *
   * **execFile 非 shell**（防注入，与 runCmd:268 同模式）：参数走 runCmd 的 args 数组，
   * branch / base_ref 即便含 shell 元字符也无法注入（命令与参数分立传递）。
   */
  async gitWorktreeAdd(params: {
    workdir: string;
    sibling_path: string;
    branch: string;
    base_ref: string;
  }): Promise<GitWorktreeAddResult> {
    assertWithinAllowedRoots(params.workdir, this._allowedRoots);
    assertWithinAllowedRoots(params.sibling_path, this._allowedRoots);
    const workdir = pathResolve(params.workdir);
    const siblingPath = pathResolve(params.sibling_path);
    // base_ref 空 → 兜底 HEAD（X-001：ws.default_branch 可空）。
    const baseRef =
      params.base_ref && params.base_ref.length > 0 ? params.base_ref : 'HEAD';

    const r = await runCmd(
      'git',
      [
        '-C',
        workdir,
        '-c',
        'user.name=worker',
        '-c',
        'user.email=worker@sillyhub',
        'worktree',
        'add',
        siblingPath,
        '-b',
        params.branch,
        baseRef,
      ],
      { timeout: GIT_TIMEOUT_MS },
    );
    if (r.ok) {
      return { ok: true, worktree_path: siblingPath };
    }
    const error = r.stderr.trim() || r.stdout.trim() || 'git worktree add failed';
    return { ok: false, error };
  }

  // ── git_merge（task-02 / design §7 / §7.5 converge 事件）────────────────────

  /**
   * `git_merge({ workdir, worker_branch }) → { ok, conflicts, merged_files, error }`。
   *
   * task-02 三方法之二：把 worker_branch 合并到 workspace root 当前 HEAD（converge 收敛，
   * design §7.5 第 4 行），跑：
   *
   *   `git -C <workdir> merge --no-ff <worker_branch>`
   *
   * **解析冲突**（design §7.5 第 5 行 / R-02）：merge exit 1 时跑
   * `git -C <workdir> diff --name-only --diff-filter=U` 拿冲突文件列表，逐个 readFile
   * 数冲突标记行（`<<<<<<< / ======= / >>>>>>>`），回传 `conflicts:[{file, marker_lines}]`
   * 让 backend converge_mission tool 喂主 agent LLM 自动解决（D-004@v1）。
   *
   * **不重复传 identity**（R-08 注释）：merge 用 worker 副本已配的 identity（git_worktree_add
   * 已带 -c user.name/email 创建副本，commit 时 identity 已落到副本 .git/config 之外的
   * per-invocation 上下文；merge --no-ff 产生 merge commit 需要 committer，但 worktree
   * 副本从父仓库继承全局 config 或共享 .git/config，worker commit 时已就位）。
   *
   * **不抛**：merge 失败（含冲突）→ `{ ok:false, conflicts:[...], merged_files:[] }`；
   * 读冲突文件失败（race / 已被外部清理）→ 跳过该文件 marker_lines 计数（不崩）。
   *
   * **marker_lines 计数语义**：`<<<<<<<`/`=======`/`>>>>>>>` 总行数。≥2 才算真冲突
   * （单标记行通常意味着文件被外部篡改非真冲突，但仍计入让 caller 决策）。
   */
  async gitMerge(params: {
    workdir: string;
    worker_branch: string;
  }): Promise<GitMergeResult> {
    assertWithinAllowedRoots(params.workdir, this._allowedRoots);
    const workdir = pathResolve(params.workdir);

    const merge = await runCmd(
      'git',
      ['-C', workdir, 'merge', '--no-ff', params.worker_branch],
      { timeout: GIT_TIMEOUT_MS },
    );

    if (merge.ok) {
      // 成功路径：conflicts 空，merged_files 当前回空数组（stdout 非结构化，留 backend 降级）。
      return { ok: true, conflicts: [], merged_files: [] };
    }

    // 失败：拉冲突文件列表（git diff --name-only --diff-filter=U）。
    const conflictFiles = await this._listConflictFiles(workdir);
    const conflicts: MergeConflict[] = [];
    for (const file of conflictFiles) {
      const abs = pathResolve(workdir, file);
      const markerLines = await this._countConflictMarkers(abs).catch(() => 0);
      conflicts.push({ file, marker_lines: markerLines });
    }

    const error =
      merge.stderr.trim() || merge.stdout.trim() || 'git merge failed';
    return { ok: false, conflicts, merged_files: [], error };
  }

  /**
   * 跑 `git -C <workdir> diff --name-only --diff-filter=U` 拿冲突文件相对路径列表。
   * 失败 / 空输出 → 空数组（不让冲突列举失败阻塞 merge 错误回传）。
   */
  private async _listConflictFiles(workdir: string): Promise<string[]> {
    const r = await runCmd(
      'git',
      ['-C', workdir, 'diff', '--name-only', '--diff-filter=U'],
      { timeout: GIT_TIMEOUT_MS },
    );
    if (!r.ok) return [];
    return r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  /**
   * 数文件内冲突标记行（`<<<<<<<`/`=======`/`>>>>>>>`）。读失败 → 0（让 caller 判定）。
   */
  private async _countConflictMarkers(absPath: string): Promise<number> {
    let content: string;
    try {
      content = await readFile(absPath, 'utf8');
    } catch {
      return 0;
    }
    let count = 0;
    for (const line of content.split('\n')) {
      if (
        line.startsWith('<<<<<<<') ||
        line.startsWith('=======') ||
        line.startsWith('>>>>>>>')
      ) {
        count += 1;
      }
    }
    return count;
  }

  // ── git_worktree_remove（task-02 / design §7 / §7.5 cleanup 事件）────────────

  /**
   * `git_worktree_remove({ workdir, sibling_path }) → { ok, error }`。
   *
   * task-02 三方法之三：合并后清理 worker 副本（design §7.5 第 8 行），跑：
   *
   *   `git -C <workdir> worktree remove --force <sibling_path>`
   *
   * `--force`：副本可能有未提交改动（worker 异常退出残留），强删避免 `git worktree remove`
   * 拒绝（design §5.1：合并成功路径立即清理，副本价值已被 merge 消化）。
   *
   * **不抛**：失败 → `{ ok:false, error: <stderr> }`（backend cleanup 路径失败仅记 warning，
   * 不阻塞 mission 收尾，对齐 design §9 兼容策略；merge 失败回退时副本保留供人工排查）。
   *
   * **安全守卫**：workdir + sibling_path 都过 `assertWithinAllowedRoots`（防删宿主敏感目录）。
   */
  async gitWorktreeRemove(params: {
    workdir: string;
    sibling_path: string;
  }): Promise<GitWorktreeRemoveResult> {
    assertWithinAllowedRoots(params.workdir, this._allowedRoots);
    assertWithinAllowedRoots(params.sibling_path, this._allowedRoots);
    const workdir = pathResolve(params.workdir);
    const siblingPath = pathResolve(params.sibling_path);

    const r = await runCmd(
      'git',
      ['-C', workdir, 'worktree', 'remove', '--force', siblingPath],
      { timeout: GIT_TIMEOUT_MS },
    );
    if (r.ok) {
      return { ok: true };
    }
    const error =
      r.stderr.trim() || r.stdout.trim() || 'git worktree remove failed';
    return { ok: false, error };
  }

  // ── git_rev_parse ─────────────────────────────────────────────────────────

  /**
   * `git_rev_parse({ root }) → { commit, error }`（对齐 backend _get_source_commit）。
   *
   * 非 git 仓库 / git 不可用 / 超时 → commit=null + error 代号（不抛，backend 降级 warning）。
   * safe.directory dubious ownership 自动重试。
   */
  async gitRevParse(params: {
    root: string;
    ref?: string;
  }): Promise<GitRevParseResult> {
    assertWithinAllowedRoots(params.root, this._allowedRoots);
    const root = pathResolve(params.root);
    return runGitRevParse(root, params.ref && params.ref.length > 0 ? params.ref : 'HEAD');
  }

  // ── pollution_archive ─────────────────────────────────────────────────────

  /**
   * `pollution_archive({ source_root, runtime_root, scan_run_id }) → { archived, archive_path, file_count, error? }`。
   *
   * 移动 `source_root/.sillyspec` → `runtime_root/pollution/<scan_run_id>/.sillyspec`
   * （对齐 backend post_scan_validator._archive_and_clean_pollution:204-240）。
   *
   * - source 不存在 / 空目录 → `{archived:false, archive_path:null, file_count:0}`。
   * - 移动失败 → `{archived:false, file_count:N, error:<msg>}`（不抛，结构化回传）。
   */
  async pollutionArchive(params: {
    source_root: string;
    runtime_root?: string;
    scan_run_id?: string;
  }): Promise<PollutionArchiveResult> {
    assertWithinAllowedRoots(params.source_root, this._allowedRoots);
    const sourceRoot = pathResolve(params.source_root);
    // runtime_root / scan_run_id 可选：delegate.pollution_archive 只传 source_root
    // （post_scan_validator:745 调用同样只传 source_root）。空时 fallback
    // source_root + 时间戳，archive 到 source_root/.pollution-<ts>/（与 delegate
    // server-local _local_pollution_archive 一致），不阻塞污染清理路径。
    const runtimeRoot =
      params.runtime_root && params.runtime_root.length > 0
        ? (assertWithinAllowedRoots(params.runtime_root, this._allowedRoots),
          pathResolve(params.runtime_root))
        : sourceRoot;
    const sourceSillyspec = join(sourceRoot, '.sillyspec');

    // 1. source 不存在 → 未归档（file_count:0）。
    try {
      const info = await lstat(sourceSillyspec).catch((e) => {
        const code =
          typeof e === 'object' && e !== null && 'code' in e
            ? (e as { code: string }).code
            : '';
        if (code === 'ENOENT') return null;
        throw toRpcError(e, 'host_fs.pollution_archive.lstat_source');
      });
      if (info === null) {
        return { archived: false, archive_path: null, file_count: 0 };
      }
    } catch (e) {
      throw toRpcError(e, 'host_fs.pollution_archive.lstat_source');
    }

    // 2. 统计 source 下文件数（rglob 等价：递归 readdir）。
    const fileCount = await this._countFiles(sourceSillyspec).catch((e) => {
      throw toRpcError(e, 'host_fs.pollution_archive.count');
    });
    if (fileCount === 0) {
      return { archived: false, archive_path: null, file_count: 0 };
    }

    // 3. 移动到归档目录（scan_run_id 空 → 时间戳兜底，避免 join 段为空）。
    const scanRunId =
      params.scan_run_id && params.scan_run_id.length > 0
        ? params.scan_run_id
        : `local-${Date.now()}`;
    const archiveDir = join(runtimeRoot, 'pollution', scanRunId);
    const archivePath = join(archiveDir, '.sillyspec');
    try {
      await mkdir(archiveDir, { recursive: true });
      await rename(sourceSillyspec, archivePath);
      return { archived: true, archive_path: archivePath, file_count: fileCount };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        archived: false,
        archive_path: null,
        file_count: fileCount,
        error: msg,
      };
    }
  }

  /**
   * 递归统计目录下文件数（对齐 Python `Path.rglob('*')` + `is_file()` 过滤）。
   * 不跟随 symlink（避免环路；对齐 pollution 语义——只数真实文件）。
   */
  private async _countFiles(dir: string): Promise<number> {
    let count = 0;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      throw toRpcError(e, 'host_fs.pollution_archive.count.readdir');
    }
    for (const entry of entries) {
      if (entry.isFile()) {
        count += 1;
      } else if (entry.isDirectory()) {
        count += await this._countFiles(join(dir, entry.name));
      }
    }
    return count;
  }

  // ── read_package_json ─────────────────────────────────────────────────────

  /**
   * `read_package_json({ root }) → dict | null`（`<root>/package.json`）。
   *
   * 不存在 → null；解析失败 → 抛 internal（JSON 解析错误属真异常，不是「文件不在」）。
   * 对齐 backend post_scan_validator._check_local_config:433-443（json.loads + .scripts）。
   */
  async readPackageJson(params: { root: string }): Promise<ReadDictResult> {
    assertWithinAllowedRoots(params.root, this._allowedRoots);
    const root = pathResolve(params.root);
    const pkgPath = join(root, 'package.json');
    try {
      const content = await readFile(pkgPath, 'utf8');
      const data = JSON.parse(content);
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return null;
      }
      return data as Record<string, unknown>;
    } catch (e) {
      const code =
        typeof e === 'object' && e !== null && 'code' in e
          ? (e as { code: string }).code
          : '';
      if (code === 'ENOENT') return null;
      throw toRpcError(e, 'host_fs.read_package_json');
    }
  }

  // ── read_local_yaml ───────────────────────────────────────────────────────

  /**
   * `read_local_yaml({ root }) → dict | null`（`<root>/.sillyspec/local.yaml`）。
   *
   * 用 js-yaml safeLoad（对齐 backend post_scan_validator._check_local_config:397-399
   * 的 `yaml.safe_load`）。不存在 → null；解析失败 → 抛 internal。
   *
   * **依赖声明**：spike-01 / task-03 蓝图原说"daemon 依赖已含 js-yaml"，实际
   * sillyhub-daemon/package.json 未声明（仅作为 @redocly/openapi-core 间接依赖存在于
   * pnpm-lock）。本变更 W1 调度阶段已显式声明 `js-yaml` + `@types/js-yaml`（见
   * package.json dependencies / devDependencies），本方法用静态 `import yaml from 'js-yaml'`。
   */
  async readLocalYaml(params: { root: string }): Promise<ReadDictResult> {
    assertWithinAllowedRoots(params.root, this._allowedRoots);
    const root = pathResolve(params.root);
    const yamlPath = join(root, '.sillyspec', 'local.yaml');
    let content: string;
    try {
      content = await readFile(yamlPath, 'utf8');
    } catch (e) {
      const code =
        typeof e === 'object' && e !== null && 'code' in e
          ? (e as { code: string }).code
          : '';
      if (code === 'ENOENT') return null;
      throw toRpcError(e, 'host_fs.read_local_yaml.read');
    }
    try {
      const data = yaml.load(content);
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return null;
      }
      return data as Record<string, unknown>;
    } catch (e) {
      throw toRpcError(e, 'host_fs.read_local_yaml.parse');
    }
  }

  // ── run_command（task-02 / design §5.3+§7 / R3 命令白名单 + AC-8）──────────

  /**
   * `run_command({ command, args, cwd, timeout, env }) → { exit_code, stdout, stderr, duration_ms }`。
   *
   * P3 driver gate pilot 第 9 方法：在宿主跑 `sillyspec gate verify --change <name> --json
   * [--stage <stage>]`，由 backend HostFsDelegate.run_command（task-01）经 send_rpc 转发
   * 到本 handler（design §5.3 / §7）。
   *
   * **命令白名单（R3 / AC-8）**：调用前先过 `isGateCommand(command, args)`，只允 sillyspec
   * gate 模板。非白名单**不执行**，返回 `{ exit_code: 126, stdout: '', stderr: 'command not
   * allowed: <command>', duration_ms: <极小> }`（不抛，结构化回传让 backend 记审计；与
   * git_apply D-008 不抛语义一致）。
   *
   * **execFile 非 shell**（防注入，与 runCmd:169 同模式）：command + args 直接传 execFile，
   * 不经 shell 拼接。timeout 用入参 params.timeout（**不写死 12min，透传调用方值**）；
   * cwd 先过 `assertWithinAllowedRoots`（穿越防护，与现有 8 方法一致）。
   *
   * **超时杀子进程**：execFile timeout 触发后 Node 自动 SIGTERM 子进程（不留孤儿），
   * callback 的 err 带 `signal === 'SIGTERM'` / `killed === true`。超时返回
   * `{ exit_code: 124, stdout, stderr: '<timeout after Nms>', duration_ms }`（不抛）。
   *
   * **env 注入**：env 非空时合并到 `process.env` 之上（仅追加/覆盖入参键，不清空 PATH）；
   * 空/null 走默认环境。
   *
   * **duration_ms**：方法入口 `Date.now()` 计时，返回时算差值。
   */
  async runCommand(params: RunCommandParams): Promise<RunCommandResult> {
    const startedAt = Date.now();

    // 1. 命令白名单守卫（R3 / AC-8）—— 非白名单不执行，结构化回传 exit 126。
    if (!isGateCommand(params.command, params.args)) {
      return {
        exit_code: 126,
        stdout: '',
        stderr: `command not allowed: ${params.command}`,
        duration_ms: Date.now() - startedAt,
      };
    }

    // 2. cwd 穿越守卫（与现有 8 方法一致，assertWithinAllowedRoots 抛 forbidden RpcError）。
    assertWithinAllowedRoots(params.cwd, this._allowedRoots);
    const cwd = pathResolve(params.cwd);

    // 3. 合并 env（非空时叠加到 process.env 之上，不清空 PATH）。
    const env =
      params.env && Object.keys(params.env).length > 0
        ? { ...process.env, ...params.env }
        : process.env;

    // 4. execFile（非 shell，timeout 透传）。不复用 runCmd：runCmd 把超时混入 ok:false 无法
    //    区分 exit_code 124，run_command 需独立从 err 上读 signal/killed 判超时。
    const result = await new Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
      timedOut: boolean;
    }>((resolve) => {
      execFile(
        params.command,
        params.args,
        {
          cwd,
          env: env as NodeJS.ProcessEnv,
          timeout: params.timeout > 0 ? params.timeout : undefined,
          maxBuffer: 10 * 1024 * 1024,
        },
        (err, stdout, stderr) => {
          const out = Buffer.isBuffer(stdout)
            ? stdout.toString('utf8')
            : stdout ?? '';
          const errOut = Buffer.isBuffer(stderr)
            ? stderr.toString('utf8')
            : stderr ?? '';
          // execFile 超时：Node 自动 SIGTERM，err.signal === 'SIGTERM' / err.killed === true。
          const timedOut =
            err !== null &&
            typeof err === 'object' &&
            (('signal' in err && (err as { signal?: string }).signal === 'SIGTERM') ||
              ('killed' in err && (err as { killed?: boolean }).killed === true));
          if (timedOut) {
            resolve({ exitCode: 124, stdout: out, stderr: errOut, timedOut: true });
            return;
          }
          if (err !== null) {
            // 非 0 退出（err.code 或 err.exitCode 是数字）；读不到时兜底 1。
            const code =
              typeof err === 'object' && err !== null
                ? (('code' in err && typeof (err as { code?: unknown }).code === 'number'
                    ? (err as { code?: number }).code
                    : undefined) ??
                  ('exitCode' in err && typeof (err as { exitCode?: unknown }).exitCode === 'number'
                    ? (err as { exitCode?: number }).exitCode
                    : undefined))
                : undefined;
            resolve({
              exitCode: typeof code === 'number' ? code : 1,
              stdout: out,
              stderr: errOut,
              timedOut: false,
            });
            return;
          }
          resolve({ exitCode: 0, stdout: out, stderr: errOut, timedOut: false });
        },
      );
    });

    const stderrFinal = result.timedOut
      ? `${result.stderr}<timeout after ${params.timeout}ms>`.trim()
      : result.stderr;

    return {
      exit_code: result.exitCode,
      stdout: result.stdout,
      stderr: stderrFinal,
      duration_ms: Date.now() - startedAt,
    };
  }
}
