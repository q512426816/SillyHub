/**
 * 关联仓双落盘例程（2026-10-10-workspec-maintenance task-04 / FR-03 / FR-04 / FR-07）。
 *
 * 在成员机器的工作区根上，逐仓两层 spawn sillyspec CLI 落盘工具消费点：
 * - projects_yaml 层：`sillyspec workspace add <name> <rel_path> [--repo <url>]`
 *   （rel_path 缺省 → skipped「未配置约定相对路径」；不传 --role——数据模型无该字段）
 * - repos_registry 层：`sillyspec local register-repo <name> <abs_path>`
 *   （abs_path 缺省 → skipped「本机路径未配置」）
 *
 * 设计约束（design.md 分层要点）：
 * - 一律经 CLI 命令落盘，本模块不手写/手改任何 yaml（D-008）。
 * - execFile 数组形参（node [bin, ...args]，无 shell 拼接——Windows 路径空格安全，
 *   R-06）；路径统一正斜杠化后传参（对齐 workspaceAdd 的写入口径）。
 * - 两层独立成败（FR-03）：一层失败不阻断另一层。
 * - 能力降级（FR-07）：spawn 失败且输出匹配 unknown command → 该层 skipped
 *   「sillyspec 需升级」，不报错不重试；其余失败 → failed + detail。
 * - 串行执行天然满足 R-07（同机一次一条命令，无并发写 local.yaml 窗口）。
 * - 结果经 report 回调回报 backend（REST 落库唯一通道）；report 抛错静默
 *   （RPC 响应仍携带逐层结果供发起方即时反馈）。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { resolveSillySpecBinDefault } from './sillyspec-manager.js';

const execFileAsync = promisify(execFile);

/** 单命令 spawn 超时（60s）：两条 CLI 命令都是本地 yaml 外科写，远小于编排层预算。 */
const COMMAND_TIMEOUT_MS = 60_000;
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;

export interface LinkedRepoParam {
  name: string;
  rel_path?: string | null;
  repo_url?: string | null;
  abs_path?: string | null;
}

export interface LinkedRepoSyncPayload {
  workspace_id: string;
  root_path: string;
  repos: LinkedRepoParam[];
}

export type SyncLayerName = 'projects_yaml' | 'repos_registry';
export type SyncStatusName = 'ok' | 'skipped' | 'failed';

export interface LinkedRepoLayerResult {
  repo_name: string;
  layer: SyncLayerName;
  status: SyncStatusName;
  detail?: string | null;
}

export interface LinkedReposSyncDeps {
  /** 依赖注入（测试 mock）：默认 resolveSillySpecBinDefault。 */
  resolveBin?: () => string | null;
  /** 依赖注入（测试 mock）：默认 execFile(node, [bin, ...args], {cwd})。 */
  exec?: (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;
  /** 结果回报（REST 唯一落库通道）；抛错由本模块吞掉（best-effort）。 */
  report?: (results: LinkedRepoLayerResult[]) => Promise<void>;
  /** 单命令超时（默认 60s）。 */
  timeoutMs?: number;
}

/** 老 CLI 子命令缺失的输出特征（sillyspec commander unknown command 家族）。 */
const UNKNOWN_COMMAND_RE = /unknown (?:command|subcommand)|unrecognized/i;

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function truncate(text: string, max = 300): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** 执行单条 sillyspec 命令（cwd=工作区根；execFile 数组形参）。 */
async function runCommand(
  deps: LinkedReposSyncDeps,
  bin: string,
  args: string[],
  cwd: string,
): Promise<{ kind: 'ok' } | { kind: 'unsupported' } | { kind: 'failed'; detail: string }> {
  const timeoutMs = deps.timeoutMs ?? COMMAND_TIMEOUT_MS;
  const exec =
    deps.exec ??
    (async (a: string[], c: string) => {
      const { stdout, stderr } = await execFileAsync(process.execPath, [bin, ...a], {
        cwd: c,
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        windowsHide: true,
      });
      return { stdout, stderr };
    });
  try {
    await exec(args, cwd);
    return { kind: 'ok' };
  } catch (e) {
    const first = classifyError(e, timeoutMs);
    if (first.kind !== 'failed') {
      return first; // unsupported（需升级）不重试
    }
    // R-07：失败自动重试一次（CLI 幂等——workspace add 保留已有字段 /
    // register-repo 外科写入；一次重试收敛竞态与瞬时错误）。
    try {
      await exec(args, cwd);
      return { kind: 'ok' };
    } catch (e2) {
      const second = classifyError(e2, timeoutMs);
      return second.kind === 'unsupported' ? first : second;
    }
  }
}

function classifyError(
  e: unknown,
  timeoutMs: number,
): { kind: 'ok' } | { kind: 'unsupported' } | { kind: 'failed'; detail: string } {
  const err = e as { killed?: boolean; stdout?: string; stderr?: string; message?: string };
  if (err.killed) {
    return { kind: 'failed', detail: `执行超时（${Math.round(timeoutMs / 1000)}s）` };
  }
  const output = `${err.stdout ?? ''}\n${err.stderr ?? ''}\n${err.message ?? ''}`;
  if (UNKNOWN_COMMAND_RE.test(output)) {
    return { kind: 'unsupported' };
  }
  return { kind: 'failed', detail: truncate(output) || '执行失败' };
}

/**
 * 双落盘主例程：逐仓两层 spawn CLI，结果归一后经 report 回报。
 * 返回值同时作为 RPC 响应（发起方即时反馈；落库以 report 为唯一通道）。
 */
export async function runLinkedReposSync(
  payload: LinkedRepoSyncPayload,
  deps: LinkedReposSyncDeps = {},
): Promise<{ workspace_id: string; results: LinkedRepoLayerResult[] }> {
  const resolveBin = deps.resolveBin ?? resolveSillySpecBinDefault;
  const bin = resolveBin();
  const results: LinkedRepoLayerResult[] = [];

  if (!bin) {
    // sillyspec 未安装：全仓两层 skipped（能力缺失而非错误，FR-07）。
    for (const repo of payload.repos) {
      for (const layer of ['projects_yaml', 'repos_registry'] as const) {
        results.push({ repo_name: repo.name, layer, status: 'skipped', detail: 'sillyspec 未安装' });
      }
    }
    await safeReport(deps, results);
    return { workspace_id: payload.workspace_id, results };
  }

  const cwd = payload.root_path;
  for (const repo of payload.repos) {
    const name = typeof repo.name === 'string' ? repo.name : '';
    if (!name || !/^[A-Za-z0-9_.\-]+$/.test(name)) {
      // backend schema 已拦；运行时脏值防御（CLI 同款规则，双保险）。
      for (const layer of ['projects_yaml', 'repos_registry'] as const) {
        results.push({ repo_name: name, layer, status: 'failed', detail: '仓库名非法' });
      }
      continue;
    }

    // ── projects_yaml 层 ──
    if (!repo.rel_path || !repo.rel_path.trim()) {
      results.push({
        repo_name: name,
        layer: 'projects_yaml',
        status: 'skipped',
        detail: '未配置约定相对路径',
      });
    } else {
      const args = ['workspace', 'add', name, toPosix(repo.rel_path.trim())];
      if (repo.repo_url && repo.repo_url.trim()) {
        args.push('--repo', repo.repo_url.trim());
      }
      const outcome = await runCommand(deps, bin, args, cwd);
      results.push(
        outcome.kind === 'ok'
          ? { repo_name: name, layer: 'projects_yaml', status: 'ok' }
          : outcome.kind === 'unsupported'
            ? { repo_name: name, layer: 'projects_yaml', status: 'skipped', detail: 'sillyspec 需升级' }
            : { repo_name: name, layer: 'projects_yaml', status: 'failed', detail: outcome.detail },
      );
    }

    // ── repos_registry 层 ──
    if (!repo.abs_path || !repo.abs_path.trim()) {
      results.push({
        repo_name: name,
        layer: 'repos_registry',
        status: 'skipped',
        detail: '本机路径未配置',
      });
    } else {
      const outcome = await runCommand(
        deps,
        bin,
        ['local', 'register-repo', name, toPosix(repo.abs_path.trim())],
        cwd,
      );
      results.push(
        outcome.kind === 'ok'
          ? { repo_name: name, layer: 'repos_registry', status: 'ok' }
          : outcome.kind === 'unsupported'
            ? { repo_name: name, layer: 'repos_registry', status: 'skipped', detail: 'sillyspec 需升级' }
            : { repo_name: name, layer: 'repos_registry', status: 'failed', detail: outcome.detail },
      );
    }
  }

  await safeReport(deps, results);
  return { workspace_id: payload.workspace_id, results };
}

async function safeReport(deps: LinkedReposSyncDeps, results: LinkedRepoLayerResult[]): Promise<void> {
  if (!deps.report) return;
  try {
    await deps.report(results);
  } catch {
    // best-effort：回报失败静默（RPC 响应已携带结果；下次同步覆盖状态）。
  }
}
