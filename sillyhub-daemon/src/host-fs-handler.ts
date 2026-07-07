/**
 * `host_fs.*` RPC handler —— daemon 端宿主文件系统操作委托（task-03 / FR-02）。
 *
 * 实现 design §5.2 的 daemon 侧 host_fs handler：接收 backend 经 per-daemon WS
 * （DaemonWsHub.send_rpc）转发的 `host_fs.<method>` 请求，在宿主（Windows / Linux / macOS）
 * 执行 stat / read_file / list_dir / git_apply / git_rev_parse / pollution_archive /
 * read_package_json / read_local_yaml 八方法，返回结构化结果。
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
 * HostFsHandler 构造参数：daemon 实体级 allowed_roots（与 list_dir RPC handler 同源，
 * 取自 DaemonConfig.allowed_roots）。每方法调 assertWithinAllowedRoots 时透传。
 */
export interface HostFsHandlerOptions {
  allowed_roots: string[];
}

// ── toRpcError（本地实现，逻辑与 file-rpc.ts:196-209 等价）─────────────────────
//
// spike-01 / task-03 蓝图说复用 file-rpc.ts:toRpcError，但该函数在 file-rpc.ts 是
// 模块私有（未 export，仅服务 listDir）。本模块为 host_fs 八方法的 fs 错误兜底，
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
): Promise<{ commit: string | null; error: string | null }> {
  async function tryOnce(): Promise<{
    commit: string | null;
    error: string | null;
    stderr: string;
  }> {
    const r = await runCmd(
      'git',
      ['-C', root, 'rev-parse', 'HEAD'],
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

// ── HostFsHandler：八方法宿主实现 ─────────────────────────────────────────────

/**
 * daemon 侧 host_fs handler 业务层（task-03）。
 *
 * 八方法 1:1 对齐 design §5.1 / backend HostFsDelegate 签名（跨任务契约锁死）。
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

  // ── git_rev_parse ─────────────────────────────────────────────────────────

  /**
   * `git_rev_parse({ root }) → { commit, error }`（对齐 backend _get_source_commit）。
   *
   * 非 git 仓库 / git 不可用 / 超时 → commit=null + error 代号（不抛，backend 降级 warning）。
   * safe.directory dubious ownership 自动重试。
   */
  async gitRevParse(params: { root: string }): Promise<GitRevParseResult> {
    assertWithinAllowedRoots(params.root, this._allowedRoots);
    const root = pathResolve(params.root);
    return runGitRevParse(root);
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
    runtime_root: string;
    scan_run_id: string;
  }): Promise<PollutionArchiveResult> {
    assertWithinAllowedRoots(params.source_root, this._allowedRoots);
    assertWithinAllowedRoots(params.runtime_root, this._allowedRoots);
    const sourceRoot = pathResolve(params.source_root);
    const runtimeRoot = pathResolve(params.runtime_root);
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

    // 3. 移动到归档目录。
    const archiveDir = join(runtimeRoot, 'pollution', params.scan_run_id);
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
}
