/**
 * runtime.* RPC handler 业务层（2026-08-19-runtime-live-daemon-read task-09/10/11）。
 *
 * backend RuntimeLiveService 经 WS RPC 调本模块，在宿主读取 workspace 的实时
 * 运行时状态（design §4.1 链路最末端）：
 *
 * - read_progress：spawn `sillyspec progress dump --spec-dir <specCacheRoot> --json`
 *   子进程（spawn+shell 30s 超时杀树，仓内 runInitCmd 同范式——execFile 在
 *   Windows 对 npm .cmd shim 必 ENOENT，见 runSillyspecCmd 注释），解析
 *   machine-interface envelope；旧版 sillyspec 无该命令 → method_not_found
 *   （backend 映射 422 引导升级，R-01）。
 * - read_user_inputs / list_artifacts / read_artifact：直接读宿主 fs 的
 *   `<specCacheRoot>/.runtime/` 下文件（daemon 侧 realpath containment 主防线）。
 *
 * specCacheRoot 推导复用 spec-sync.resolveSpecDir（task-10 constraints：不新建
 * 配置项）——`~/.sillyhub/daemon/specs/<workspace_id>/`。
 *
 * 设计依据：.sillyspec/changes/2026-08-19-runtime-live-daemon-read/design.md
 * （§4.1 / §6.1 RPC 契约 / §6.3 错误码 / §8 R-01/R-04）。
 */

import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { readFile, readdir, stat } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { resolveSpecDir } from './spec-sync.js';
import { RpcError } from './ws-client.js';

/**
 * RPC 错误类复用 ws-client.RpcError：`_dispatchRpc` 按 `instanceof RpcError`
 * 原样回填 code（普通 Error 一律映射 internal）——自定义同形类会被吞掉
 * not_found/method_not_found 等语义码。code 对齐 design §6.3 backend 映射表
 * 消费侧。
 */

/** sillyspec 子进程 timeout（design §8 R-04：30s，与 backend 35s RPC 超时留余量）。 */
const SILLYSPEC_TIMEOUT_MS = 30_000;

/** 单产物读取上限（design §8 R-04：1MB，超限 artifact_too_large）。 */
const ARTIFACT_MAX_BYTES = 1_000_000;

/**
 * workspace_id 严格白名单（shell 拼接注入防线）：本系统 workspace_id 恒为
 * UUID hex-dash 形态，非此形态一律拒 forbidden——shell:true 下这是唯一的
 * 注入主防线（resolveSpecDir 的路径分隔符拒绝只拦 `..` 类穿越，不拦
 * `; rm -rf` 类命令注入）。
 */
const WORKSPACE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * spawn 命令 + 超时杀树（范式对齐 spec-sync.ts runInitCmd:1453 / preflight.ts
 * runWithTreeKill:393，Windows taskkill /T /F 杀孙 node.exe）。
 *
 * **为何 spawn+shell 而非 task 卡原文的 execFile**：Windows npm 全局 bin 是
 * .cmd shim，`execFile('sillyspec')` 无 PATHEXT 解析必 ENOENT（Node ≥18.20
 * 同时拒绝无 shell 调 .cmd，实测证实；仓内先例 runInitCmd X-06 注释同结论）。
 * 注入面由 WORKSPACE_ID_RE 白名单收口（见上）。
 */
function runSillyspecCmd(
  cmd: string,
  timeoutMs: number,
): Promise<{ ok: boolean; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, {
      shell: true,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let settled = false;
    const finish = (ok: boolean, timedOut: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok,
        stdout: Buffer.concat(outChunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
        timedOut,
      });
    };
    if (child.stdout) child.stdout.on('data', (c: Buffer) => outChunks.push(c));
    if (child.stderr) child.stderr.on('data', (c: Buffer) => errChunks.push(c));
    child.on('error', () => finish(false, false)); // ENOENT 等 spawn 失败
    child.on('close', (code) => finish(code === 0, false));
    const timer = setTimeout(() => {
      killProcTree(child);
      finish(false, true);
    }, timeoutMs);
  });
}

/** 杀整个进程树（范式对齐 spec-sync.ts killInitTree:1423，自实现不跨模块 import）。 */
function killProcTree(child: ChildProcess): void {
  const pid = child.pid;
  if (typeof pid !== 'number') return;
  try {
    if (process.platform === 'win32') {
      spawn(
        'taskkill', ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore' },
      );
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        process.kill(pid, 'SIGKILL');
      }
    }
  } catch {
    // 杀树失败不抛（最坏孙进程残留；不阻塞 daemon）。
  }
}

/**
 * workspace_id → specCacheRoot（~/.sillyhub/daemon/specs/<id>）。
 *
 * 双重防线：WORKSPACE_ID_RE UUID 白名单（shell 注入防线，先）+ resolveSpecDir
 * 路径分隔符拒绝（穿越防线，后）；两类入参错误统一转 RpcError(forbidden)
 * （backend → 403），而非裸 Error → internal。
 */
export function specCacheRootFor(workspaceId: string): string {
  if (typeof workspaceId !== 'string' || !workspaceId) {
    throw new RpcError('forbidden', 'workspace_id is required');
  }
  if (!WORKSPACE_ID_RE.test(workspaceId)) {
    throw new RpcError('forbidden', `invalid workspace_id: ${JSON.stringify(workspaceId)}`);
  }
  try {
    return resolveSpecDir(workspaceId);
  } catch {
    throw new RpcError('forbidden', `invalid workspace_id: ${JSON.stringify(workspaceId)}`);
  }
}

/** filename 预检：空名 / 控制字符 / 绝对路径 / `..` 段 / 子路径 → forbidden。 */
function assertSafeArtifactFilename(filename: string): void {
  const bad =
    !filename ||
    [...filename].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f) ||
    filename.startsWith('/') ||
    filename.startsWith('\\') ||
    /^[A-Za-z]:/.test(filename) ||
    filename.split(/[\\/]/).includes('..') ||
    filename.includes('/') ||
    filename.includes('\\');
  if (bad) {
    throw new RpcError(
      'forbidden',
      `invalid artifact filename: ${JSON.stringify(filename)}`,
    );
  }
}

/** runtime.* handler。sillyspecCmd 可注入（测试 / 源码 link 场景覆盖）。 */
export class RuntimeHandler {
  constructor(
    private readonly opts: {
      sillyspecCmd?: (
        cmd: string,
        timeoutMs: number,
      ) => Promise<{ ok: boolean; stdout: string; stderr: string; timedOut: boolean }>;
    } = {},
  ) {}

  /** progress dump（spawn sillyspec 子进程，design §6.2）。 */
  async readProgress(workspaceId: string): Promise<{ progress: unknown | null }> {
    const specDir = specCacheRootFor(workspaceId);
    const cmd = `sillyspec progress dump --spec-dir "${specDir}" --json`;
    const run = this.opts.sillyspecCmd ?? runSillyspecCmd;
    const r = await run(cmd, SILLYSPEC_TIMEOUT_MS);
    if (!r.ok) {
      // 旧版 sillyspec：progress 无 dump 子命令 → default case 用法提示（stdout）
      // + exit 2。提示串在 stdout（console.log），非 stderr。
      if (r.stdout.includes('|dump') || r.stdout.includes('sillyspec progress <')) {
        throw new RpcError('method_not_found', 'sillyspec progress dump not supported; upgrade sillyspec');
      }
      if (r.timedOut) {
        throw new RpcError('timeout', `sillyspec progress dump timed out (${SILLYSPEC_TIMEOUT_MS}ms)`);
      }
      throw new RpcError('internal', `sillyspec progress dump failed: ${`${r.stdout}\n${r.stderr}`.trim().slice(0, 500)}`);
    }
    let envelope: { ok?: boolean; data?: unknown; errors?: string[] };
    try {
      envelope = JSON.parse(r.stdout);
    } catch {
      throw new RpcError('internal', 'sillyspec progress dump output is not valid JSON');
    }
    // envelope.ok=false + data=null（无 DB/无活跃变更）不算错误，progress 传 null。
    return { progress: envelope.data ?? null };
  }

  /** 读 .runtime/user-inputs.md（不存在 → not_found，backend 映射 404）。 */
  async readUserInputs(workspaceId: string): Promise<{ content: string | null }> {
    const specDir = specCacheRootFor(workspaceId);
    const uiPath = join(specDir, '.runtime', 'user-inputs.md');
    try {
      return { content: await readFile(uiPath, 'utf8') };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return { content: null };
      }
      throw new RpcError('internal', `read user-inputs failed: ${String(e)}`);
    }
  }

  /** 列 .runtime/artifacts（目录不存在 → 空数组，与旧行为一致）。 */
  async listArtifacts(workspaceId: string): Promise<{
    artifacts: { filename: string; size_bytes: number; last_modified: string | null }[];
  }> {
    const specDir = specCacheRootFor(workspaceId);
    const artDir = join(specDir, '.runtime', 'artifacts');
    let names: string[];
    try {
      names = await readdir(artDir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return { artifacts: [] };
      }
      throw new RpcError('internal', `list artifacts failed: ${String(e)}`);
    }
    const artifacts = await Promise.all(
      names.map(async (name) => {
        const st = await stat(join(artDir, name));
        return {
          filename: name,
          size_bytes: st.isFile() ? st.size : 0,
          last_modified: st.isFile() ? st.mtime.toISOString() : null,
        };
      }),
    );
    // 只保留文件（目录/符号链接等非产物跳过）。
    return { artifacts: artifacts.filter((a) => a.size_bytes > 0 || a.last_modified !== null) };
  }

  /** 读单个产物（filename 预检 + realpath containment + 1MB 上限）。 */
  async readArtifact(workspaceId: string, filename: string): Promise<{ content: string | null }> {
    assertSafeArtifactFilename(filename);
    const specDir = specCacheRootFor(workspaceId);
    const artDir = resolve(join(specDir, '.runtime', 'artifacts'));
    const filePath = resolve(join(artDir, filename));
    // containment 主防线：resolve 后必须仍在 artDir 内（平文件名预检已过，这里
    // 兜底符号链接等 fs 层歧义——Windows junction resolve 会展开）。
    if (filePath !== artDir && !filePath.startsWith(artDir + sep)) {
      throw new RpcError('forbidden', 'artifact path escapes artifacts dir');
    }
    let st;
    try {
      st = await stat(filePath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new RpcError('not_found', `artifact not found: ${filename}`);
      }
      throw new RpcError('internal', `stat artifact failed: ${String(e)}`);
    }
    if (!st.isFile()) {
      throw new RpcError('not_found', `artifact is not a file: ${filename}`);
    }
    if (st.size > ARTIFACT_MAX_BYTES) {
      throw new RpcError('artifact_too_large', `artifact over ${ARTIFACT_MAX_BYTES} bytes: ${filename}`);
    }
    try {
      return { content: await readFile(filePath, 'utf8') };
    } catch (e) {
      throw new RpcError('internal', `read artifact failed: ${String(e)}`);
    }
  }
}

/** 供测试/其他模块复用的常量导出；RpcError 转发自 ws-client（单一类型源）。 */
export { ARTIFACT_MAX_BYTES, SILLYSPEC_TIMEOUT_MS, RpcError };
