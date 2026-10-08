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
 * 2026-08-20-runtime-readpoint-repo-first：读点改为「仓库优先、缓存回退」——
 * 四方法加可选 root_path 入参，pickRuntimeSpecDir 三道校验（元字符黑名单 →
 * assertWithinAllowedRoots → `<root_path>/.sillyspec/.runtime` 存在性）全过读
 * `<root_path>/.sillyspec`，任一不过记 warn 回退缓存目录（design §5.2/§6
 * D-01@v1）；workspace_id 校验的 forbidden 仍 fail-loud，不在回退 catch 范围。
 *
 * 设计依据：.sillyspec/changes/2026-08-19-runtime-live-daemon-read/design.md
 * （§4.1 / §6.1 RPC 契约 / §6.3 错误码 / §8 R-01/R-04）+
 * .sillyspec/changes/2026-08-20-runtime-readpoint-repo-first/design.md（§5.2/§6）。
 */

import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { access, readFile, readdir, stat } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { assertWithinAllowedRoots } from './file-rpc.js';
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
 * UUID hex-dash 形态，非此形态一律拒 forbidden——workspace_id 进入 shell:true
 * 命令串的唯一防线是这个白名单（resolveSpecDir 的路径分隔符拒绝只拦 `..` 类穿越，不拦
 * `; rm -rf` 类命令注入）；root_path 入串的注入防线见下方 ROOT_PATH_METACHAR_RE。
 */
const WORKSPACE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * root_path 元字符黑名单（2026-08-20-runtime-readpoint-repo-first design §6
 * shell 注入面对策第一层）：root_path 会进入 readProgress 的 shell:true 命令串
 * （--spec-dir "<specDir>"），Linux/macOS 上含这些字符的目录名是合法路径，可
 * 先过 realpath containment 再注入 shell（Windows 文件名禁这些字符，风险仅
 * Unix 系）。命中一律判无效回退缓存（优雅降级非报错）；常见路径（含中文、
 * 空格）零误伤。字符集与 design §6 逐字一致："'`$&|;<>()%^ + 换行/回车/NUL，
 * 一个不多一个不少。
 */
const ROOT_PATH_METACHAR_RE = /["'`$&|;<>()%^\n\r\0]/;

/**
 * spawn 命令 + 超时杀树（范式对齐 spec-sync.ts runInitCmd:1453 / preflight.ts
 * runWithTreeKill:393，Windows taskkill /T /F 杀孙 node.exe）。
 *
 * **为何 spawn+shell 而非 task 卡原文的 execFile**：Windows npm 全局 bin 是
 * .cmd shim，`execFile('sillyspec')` 无 PATHEXT 解析必 ENOENT（Node ≥18.20
 * 同时拒绝无 shell 调 .cmd，实测证实；仓内先例 runInitCmd X-06 注释同结论）。
 * 注入面由 WORKSPACE_ID_RE 白名单（workspace_id 入串）+ ROOT_PATH_METACHAR_RE
 * 黑名单（root_path 入串，2026-08-20-runtime-readpoint-repo-first）双防线收口（见上）。
 */
function runSillyspecCmd(
  cmd: string,
  timeoutMs: number,
  cwd?: string,
): Promise<{ ok: boolean; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, {
      shell: true,
      ...(cwd ? { cwd } : {}),
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

/**
 * RPC 参数 root_path 归一（daemon.ts 注册器与四方法入口共用）：非字符串或
 * trim 后为空 → undefined（走缓存读点，老 backend / 缺参兼容）；非空字符串
 * 原样返回——只判空不做 trim 改值（路径本身允许首尾空格，改值会读错目录）。
 */
export function normalizeRootPathParam(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  return v;
}

/** pathExists 默认实现：fs/promises access 探测，存在/可达 → true，否则 false。 */
async function pathExistsViaAccess(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
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

/**
 * runtime.* handler。sillyspecCmd / rootsProvider / pathExists 可注入
 * （测试 / 源码 link 场景覆盖）。
 */
export class RuntimeHandler {
  /** allowed_roots 注入（对齐 HostFsHandler rootsProvider 范式）；缺省空数组 → root_path 分支必回退缓存。 */
  private readonly _rootsProvider: () => string[];
  /** 目录存在性探测注入（读点第三道校验）；缺省 fs access 实现。 */
  private readonly _pathExists: (p: string) => Promise<boolean>;

  constructor(
    private readonly opts: {
      sillyspecCmd?: (
        cmd: string,
        timeoutMs: number,
        cwd?: string,
      ) => Promise<{ ok: boolean; stdout: string; stderr: string; timedOut: boolean }>;
      /** 允许读的根目录白名单来源（design §6 第二道校验消费）。 */
      rootsProvider?: () => string[];
      /** 目录存在性探测（design §6 第三道校验消费，测试注入用）。 */
      pathExists?: (p: string) => Promise<boolean>;
    } = {},
  ) {
    this._rootsProvider = opts.rootsProvider ?? (() => []);
    this._pathExists = opts.pathExists ?? pathExistsViaAccess;
  }

  /**
   * 读点选择（D-01@v1，仓库优先缓存回退）：root_path 非空时依次过三道校验，
   * 全过 → `<root_path>/.sillyspec`；任一不过或抛错 → 记 warn 回退缓存目录。
   *
   * **catch 边界（关键）**：specCacheRootFor 的 workspace_id UUID 白名单校验在
   * try 之外先执行——非法 workspace_id 的 forbidden 仍 fail-loud 不被回退吞掉
   * （design §5.2）；try 内只包 root_path 三道校验路径：
   *   ① ROOT_PATH_METACHAR_RE 元字符黑名单（shell 注入防线第一层）；
   *   ② assertWithinAllowedRoots containment（复用 file-rpc 现有防线，不自实现）；
   *   ③ `<root_path>/.sillyspec/.runtime` 目录存在（仓库没跑过 sillyspec 即回退）。
   */
  private async pickRuntimeSpecDir(workspaceId: string, rootPath?: string): Promise<string> {
    // 先拿缓存目录——specCacheRootFor 内的 workspace_id 校验 fail-loud，不属于
    // 回退 catch 范围（非法 workspace_id 是协议错误，root_path 失效只是数据失效）。
    const cacheDir = specCacheRootFor(workspaceId);
    const root = normalizeRootPathParam(rootPath);
    if (root === undefined) return cacheDir; // 无/空 root_path → 现状缓存读点
    try {
      if (ROOT_PATH_METACHAR_RE.test(root)) {
        throw new RpcError(
          'forbidden',
          `root_path contains shell metacharacters: ${JSON.stringify(root)}`,
        );
      }
      assertWithinAllowedRoots(root, this._rootsProvider());
      if (!(await this._pathExists(join(root, '.sillyspec', '.runtime')))) {
        throw new RpcError(
          'not_found',
          `no .sillyspec/.runtime under root_path: ${JSON.stringify(root)}`,
        );
      }
      return join(root, '.sillyspec');
    } catch (e) {
      // 校验失败一律回退而非报错（D-01：root_path 来自用户自配 binding 行，路径
      // 失效时页面不应 502，回退缓存保持可用）；console.warn 与 spec-sync.ts 回退
      // 日志同风格（模块内无 logger 注入点）。
      console.warn('runtime_read_point_fallback', workspaceId, e);
      return cacheDir;
    }
  }

  /** progress dump（spawn sillyspec 子进程，design §6.2）；rootPath 可选读点（D-01@v1）。 */
  async readProgress(workspaceId: string, rootPath?: string): Promise<{ progress: unknown | null }> {
    const specDir = await this.pickRuntimeSpecDir(workspaceId, rootPath);
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

  /** 读 .runtime/user-inputs.md（不存在 → not_found，backend 映射 404）；rootPath 可选读点（D-01@v1）。 */
  async readUserInputs(workspaceId: string, rootPath?: string): Promise<{ content: string | null }> {
    const specDir = await this.pickRuntimeSpecDir(workspaceId, rootPath);
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

  /** 列 .runtime/artifacts（目录不存在 → 空数组，与旧行为一致）；rootPath 可选读点（D-01@v1）。 */
  async listArtifacts(workspaceId: string, rootPath?: string): Promise<{
    artifacts: { filename: string; size_bytes: number; last_modified: string | null }[];
  }> {
    const specDir = await this.pickRuntimeSpecDir(workspaceId, rootPath);
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

  /** 读单个产物（filename 预检 + realpath containment + 1MB 上限）；rootPath 可选读点（D-01@v1）。 */
  async readArtifact(
    workspaceId: string,
    filename: string,
    rootPath?: string,
  ): Promise<{ content: string | null }> {
    assertSafeArtifactFilename(filename);
    const specDir = await this.pickRuntimeSpecDir(workspaceId, rootPath);
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

// ── knowledge 治理 RPC（2026-09-27-governance-rpc-actions，三层治理 v2 ①②）────
// digest 直采：收敛平台/CLI 双出口为单源（CLI 为真相——绑定信号与基线消音只在仓工作
// 树在场时可得）；action 回传：白名单机械动作（repair-paths / redomain），平台信号卡
// 按钮的执行端。安全：域名参数过 [a-z0-9-]+ 元字符防线（spawn shell:true 命令串
// 拼接的注入面）；kind 白名单硬编码。root 防线两道（2026-09-28-audit-risk-fixes
// 补齐第二道）：①KNOWLEDGE_ROOT_ANOMALY_RE 异常值黑名单（root 只进 spawn cwd 不拼
// 命令串，拦的是路径 API 禁形与 Windows 非法文件名字符——& $ ' ` ; 是 Windows 合法
// 目录字符不拦，R&D 类路径不再误拒）；②assertWithinAllowedRoots containment
// （rootsProvider 注入，与 RuntimeHandler 读点/HostFsHandler 同款——写能力校验
// 不弱于读，防借用绑定越机器主人 allowed_roots 在宿主任意目录执行写动作）。
const KNOWLEDGE_DOMAIN_RE = /^[a-z0-9-]+$/;
const KNOWLEDGE_ACTION_KINDS = new Set(['repair-paths', 'redomain']);
const KNOWLEDGE_ROOT_ANOMALY_RE = /[\0\r\n<>|"?*]/;

// ── knowledge graph 查询（2026-10-08-platform-knowledge-graph task-01，FR-04）──
// 平台图查询唯一 daemon 出口：digest/action 同款结构扩展。消毒面三自由串
// （anchor/anchor2/search）共用一个黑名单正则——三者都进 shell:true 命令串
// （锚点是 CLI 位置参数，实测 usage `[锚点...]` 非旗标），引号本身在黑名单内，
// 拼串引号包裹即杜绝逃逸（R-01 注入面）。旧 CLI 三态细分回码见 graph 方法注释。
// 2026-10-09-knowledge-graph-fullmap task-02 加 dump（全图导出，FR-02/D-002@v1）：
// layout 必须 true（false/缺省 validation_rejected）、拼串固定 `dump --layout --json`
//（无锚点无 search——dump 无自由串入参，注入消毒面零新增）、回包全量透传
//（旁路 orphans/dangling top-50 清单裁剪）。
const KNOWLEDGE_GRAPH_SUBS = new Set(['summary', 'nodes', 'neighbors', 'path', 'impact', 'orphans', 'dangling', 'dump']);

/**
 * --edges 值白名单：CLI knowledge-graph.js EDGE_STRENGTH 键集的硬拷贝（16 边型，
 * 2026-10-08 实测）∪ {all}（neighbors 缺省即 all）。CLI 加边型时此处同步硬拷贝。
 */
const KNOWLEDGE_GRAPH_EDGES = new Set([
  'module-dep', 'module-files', 'anchors', 'supersedes', 'from-change', 'belongs-module',
  'deliverables', 'change-modules', 'test-binding', 'describes', 'changelog-of',
  'changelog-entry', 'doc-refs', 'scan-refs', 'route', 'entry-link', 'all',
]);

/**
 * graph 自由串黑名单：先例 ROOT_PATH_METACHAR_RE 全集（"'`$&|;<>() %^ + \n\r\0
 * ——注意空格与反引号都在集合内）外加 \t。命中即 validation_rejected；正常节点
 * id 字符集（/ # : @ - _ . 与中文，实测样本 decision:decisions/x.md#D-1@v1、
 * src/foo.js、FR-core-engine-001、2026-10-08-x）零冲突放行。
 */
const GRAPH_TEXT_BLACKLIST_RE = /["'`$&|;<>() %^\n\r\0\t]/;

/** graph 自由串消毒（anchor/anchor2/search 三参数同函数）：命中黑名单拒（D-001@v2）。 */
function sanitizeGraphText(name: string, v: string): string {
  if (GRAPH_TEXT_BLACKLIST_RE.test(v)) {
    throw new RpcError('validation_rejected', `graph ${name} contains forbidden characters: ${JSON.stringify(v)}`);
  }
  return v;
}

/**
 * graph 数值旗标钳制：parseInt 后夹 [min,max]（越界钳不拒——depth 0/4 → 1/3、
 * limit 0/99 → 1/50）；NaN（非数字串）拒 validation_rejected；缺省/空 → undefined
 * = 不拼旗标（走 CLI 缺省）。
 */
function clampGraphInt(
  name: string,
  v: number | string | undefined,
  min: number,
  max: number,
): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = parseInt(String(v), 10);
  if (!Number.isInteger(n)) {
    throw new RpcError('validation_rejected', `graph ${name} must be an integer: ${JSON.stringify(v)}`);
  }
  return Math.min(max, Math.max(min, n));
}

export class KnowledgeGovernanceHandler {
  /** allowed_roots 白名单来源（containment 第二道校验）；缺省空数组 → 一律拒。 */
  private readonly _rootsProvider: () => string[];

  constructor(
    private readonly opts: {
      sillyspecCmd?: (cmd: string, timeoutMs: number, cwd?: string) => Promise<{
        ok: boolean; stdout: string; stderr: string; timedOut: boolean;
      }>;
      rootsProvider?: () => string[];
    } = {},
  ) {
    this._rootsProvider = opts.rootsProvider ?? (() => []);
  }

  /** root 两道防线：非空 → 异常值黑名单 → allowed_roots containment。 */
  private _guardRoot(rootPath: string | undefined): string {
    const root = rootPath ?? '';
    if (!root) {
      throw new RpcError('forbidden', 'root_path required: knowledge RPC must run inside an allowed root');
    }
    if (KNOWLEDGE_ROOT_ANOMALY_RE.test(root)) {
      throw new RpcError('forbidden', `root_path suspicious: ${JSON.stringify(root)}`);
    }
    assertWithinAllowedRoots(root, this._rootsProvider());
    return root;
  }

  /** knowledge.digest：cwd=仓库根跑 `sillyspec knowledge digest --json`，stdout JSON 透传。 */
  async digest(workspaceId: string, rootPath?: string): Promise<{ digest: unknown }> {
    // rootPath 已由 daemon.ts 侧 normalizeRootPathParam 归一；_guardRoot 两道防线
    //（异常值黑名单 + allowed_roots containment——digest 读面同样不弱于读点，见类注释）。
    const root = this._guardRoot(rootPath);
    const cmd = 'sillyspec knowledge digest --json';
    const run = this.opts.sillyspecCmd ?? runSillyspecCmd;
    const r = await run(cmd, SILLYSPEC_TIMEOUT_MS, root);
    if (!r.ok) {
      if (r.stdout.includes('knowledge <') || r.stdout.includes('unknown_subcommand')) {
        throw new RpcError('method_not_found', 'sillyspec knowledge digest not supported; upgrade sillyspec');
      }
      if (r.timedOut) throw new RpcError('timeout', `digest timed out (${SILLYSPEC_TIMEOUT_MS}ms)`);
      throw new RpcError('internal', `digest failed: ${`${r.stdout}\n${r.stderr}`.trim().slice(0, 500)}`);
    }
    try {
      const j = JSON.parse(r.stdout);
      if (j && j.ok === true) return { digest: j };
      throw new Error('ok!=true');
    } catch {
      throw new RpcError('internal', 'digest output is not valid CLI JSON envelope');
    }
  }

  /** knowledge.action：白名单机械动作执行（repair-paths --write / redomain --write）。 */
  async action(
    workspaceId: string,
    kind: string,
    params: { from?: string; to?: string },
    rootPath?: string,
  ): Promise<{ output: string }> {
    // root 元字符防线（评审 P2-③ 清偿）+ containment（2026-09-28-audit-risk-fixes
    // 补齐第二道）：写能力 handler 校验不弱于读（digest 同款防线）。
    const root = this._guardRoot(rootPath);
    if (!KNOWLEDGE_ACTION_KINDS.has(kind)) {
      throw new RpcError('forbidden', `action kind not allowed: ${JSON.stringify(kind)}`);
    }
    let cmd: string;
    if (kind === 'repair-paths') {
      cmd = 'sillyspec tests repair-paths --write';
    } else {
      const from = String(params.from ?? '');
      const to = String(params.to ?? '');
      if (!KNOWLEDGE_DOMAIN_RE.test(from) || !KNOWLEDGE_DOMAIN_RE.test(to)) {
        throw new RpcError('forbidden', `redomain domains must match [a-z0-9-]+ (from=${JSON.stringify(from)} to=${JSON.stringify(to)})`);
      }
      cmd = `sillyspec tests --redomain --from ${from} --to ${to} --write`;
    }
    const run = this.opts.sillyspecCmd ?? runSillyspecCmd;
    const r = await run(cmd, SILLYSPEC_TIMEOUT_MS, root);
    const output = `${r.stdout}\n${r.stderr}`.trim().slice(-2000);
    if (!r.ok) {
      if (r.timedOut) throw new RpcError('timeout', `action timed out (${SILLYSPEC_TIMEOUT_MS}ms)`);
      throw new RpcError('internal', `action failed: ${output}`);
    }
    return { output };
  }

  /**
   * knowledge.graph：平台图查询唯一 daemon 出口（2026-10-08-platform-knowledge-graph
   * task-01，FR-04/D-001@v2/D-005@v1；2026-10-09-knowledge-graph-fullmap task-02 加
   * dump，FR-02/D-002@v1）。八子命令白名单 → `sillyspec knowledge graph <sub>
   * "<anchor>" ["<anchor2>"] --json`（锚点=CLI 位置参数，引号在黑名单内杜绝
   * 逃逸）；edges 值白名单 16 边型∪{all}；depth 钳 1-3；limit 钳 1-50；search ≤200；
   * summary 固定 `--clusters 50`（缺省全量簇——本仓实测 883 簇）；dump 拼串固定
   * `dump --layout --json`（layout 必须 true，无锚点无 search）且回包全量透传
   * （旁路清单裁剪）。
   *
   * 回码契约（D-001@v2 三态细分）：消毒/校验拒绝 → validation_rejected（backend 译
   * invalid_input）；CLI 全无 graph（stdout 含 'knowledge <' 或 unknown_subcommand，
   * digest 先例同款文本探测）→ cli_subcommand_missing；CLI 有 graph 但缺
   * summary/nodes（后发子命令，graph_usage 信封 echo subcommand 或 usage 列表无
   * 该子命令）→ `cli_feature_missing:<sub>`（backend 前两者均译 upgrade_required）；
   * timedOut → timeout；其余（含 CLI 参数类 ok:false 信封 anchor_required/
   * node_not_found 等）→ internal。**method_unregistered 不是本 handler 能抛的**——
   * 那是 daemon 未注册 knowledge.graph 的平台侧场景（旧 daemon，由 _dispatchRpc 对
   * 未注册 method 回 method_not_found，backend 侧译 upgrade_required）。
   */
  async graph(
    workspaceId: string,
    query: {
      sub?: string;
      anchor?: string;
      anchor2?: string;
      edges?: string;
      depth?: number | string;
      search?: string;
      limit?: number | string;
      layout?: boolean;
    },
    rootPath?: string,
  ): Promise<{ graph: unknown }> {
    void workspaceId; // 签名与 digest/action 对称（CLI 以 cwd=root 定位仓库，不用 id）
    const root = this._guardRoot(rootPath);
    const sub = String(query.sub ?? '');
    if (!KNOWLEDGE_GRAPH_SUBS.has(sub)) {
      throw new RpcError('validation_rejected', `graph subcommand not allowed: ${JSON.stringify(sub)}`);
    }
    // dump 专属旗标校验（task-02，D-002@v1）：dump 是全图导出（--layout 携布局
    // 信息），layout 必须 true——false/缺省一律 validation_rejected 且不 spawn。
    if (sub === 'dump' && query.layout !== true) {
      throw new RpcError('validation_rejected', 'dump requires --layout');
    }
    // 三自由串同函数消毒（R-01）：anchor/anchor2 位置参数、search 旗标值。
    const anchors: string[] = [];
    if (query.anchor !== undefined && query.anchor !== '') {
      anchors.push(sanitizeGraphText('anchor', query.anchor));
    }
    if (query.anchor2 !== undefined && query.anchor2 !== '') {
      anchors.push(sanitizeGraphText('anchor2', query.anchor2));
    }
    const flags: string[] = [];
    if (query.edges !== undefined && query.edges !== '') {
      if (!KNOWLEDGE_GRAPH_EDGES.has(query.edges)) {
        throw new RpcError('validation_rejected', `graph edges not allowed: ${JSON.stringify(query.edges)}`);
      }
      flags.push(`--edges ${query.edges}`);
    }
    const depth = clampGraphInt('depth', query.depth, 1, 3);
    if (depth !== undefined) flags.push(`--depth ${depth}`);
    if (query.search !== undefined && query.search !== '') {
      const search = sanitizeGraphText('search', query.search);
      if (search.length > 200) {
        throw new RpcError('validation_rejected', `graph search too long (${search.length} > 200)`);
      }
      flags.push(`--search "${search}"`);
    }
    const limit = clampGraphInt('limit', query.limit, 1, 50);
    if (limit !== undefined) flags.push(`--limit ${limit}`);
    if (sub === 'summary') flags.push('--clusters 50');
    // dump 拼串固定（task-02）：`dump --layout --json` 无锚点无 search——dump 无
    // 自由串入参（constraints：注入消毒面不新增参数），上方 anchor/search 消毒对
    // dump 只是防御性先行拒绝（恶意串到不了拼串）；其余子命令维持既有拼装零变化。
    const cmd = sub === 'dump'
      ? 'sillyspec knowledge graph dump --layout --json'
      : ['sillyspec knowledge graph', sub, ...anchors.map((a) => `"${a}"`), ...flags, '--json'].join(' ');

    const run = this.opts.sillyspecCmd ?? runSillyspecCmd;
    const r = await run(cmd, SILLYSPEC_TIMEOUT_MS, root);
    if (!r.ok) {
      const probe = this._probeGraphOldCli(r.stdout, sub);
      if (probe) throw probe;
      if (r.timedOut) throw new RpcError('timeout', `graph ${sub} timed out (${SILLYSPEC_TIMEOUT_MS}ms)`);
      throw new RpcError('internal', `graph ${sub} failed: ${`${r.stdout}\n${r.stderr}`.trim().slice(0, 500)}`);
    }
    let j: Record<string, unknown> | undefined;
    try {
      j = JSON.parse(r.stdout) as Record<string, unknown>;
    } catch {
      j = undefined;
    }
    if (!j || j.ok !== true) {
      // 实测 graph_usage/anchor_required 以 exit 0 + ok:false 信封出现——成功路径
      // ok!==true 也走三态探测（cli_subcommand_missing / cli_feature_missing:<sub>）。
      const probe = this._probeGraphOldCli(r.stdout, sub);
      if (probe) throw probe;
      throw new RpcError('internal', 'graph output is not valid CLI JSON envelope');
    }
    // dump 回包旁路裁剪（task-02）：全图导出的语义本位是完整清单，orphans/dangling
    // 键全量透传——top-50 截断只属于同名单命令子（下方 sub 严格等值分支），dump
    // 提前 return 不入裁剪路径；防 WS 大帧由调用侧（backend 分页/落盘）负责。
    if (sub === 'dump') {
      return { graph: j };
    }
    // 清单裁剪（design Phase 1：本仓 dangling 实测 1807 条/675KB——orphans/dangling
    // items 截 top-50、count 保真，防 WS 大帧与前端千行清单；完整治理走 CLI/doctor）。
    if (sub === 'orphans' && Array.isArray(j.orphans)) {
      j.orphans = (j.orphans as unknown[]).slice(0, 50);
    }
    if (sub === 'dangling' && Array.isArray(j.dangling)) {
      j.dangling = (j.dangling as unknown[]).slice(0, 50);
    }
    return { graph: j };
  }

  /**
   * 旧 CLI 三态探测（D-001@v2）：①全无 graph 子命令 → cli_subcommand_missing
   * （stdout 文本含 'knowledge <' usage 或 unknown_subcommand——digest 先例：旧 CLI
   * 子命令缺失走 usage 文本探测，且信封形态 code=unknown_subcommand 同认）；
   * ②有 graph 缺 summary/nodes（后发子命令）→ cli_feature_missing:<sub>——graph_usage
   * 信封 echo subcommand=<sub>，或 usage 列表不含 <sub>（输出无该子命令痕迹）。
   * 第三态 method_unregistered 是 daemon 未注册 handler 的平台侧场景，非 daemon 能抛
   * （见 graph 方法注释）。返回 undefined = 非旧 CLI 形态，走 timeout/internal 兜底。
   */
  private _probeGraphOldCli(stdout: string, sub: string): RpcError | undefined {
    let err: { code?: unknown; subcommand?: unknown; usage?: unknown } | undefined;
    try {
      const parsed: unknown = JSON.parse(stdout);
      if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        const e = (parsed as { error?: unknown }).error;
        if (e && typeof e === 'object') err = e as typeof err;
      }
    } catch {
      // 非信封文本输出（旧 CLI usage 直出）——走文本探测。
    }
    const errCode = err?.code;
    if (stdout.includes('knowledge <') || stdout.includes('unknown_subcommand') || errCode === 'unknown_subcommand') {
      return new RpcError('cli_subcommand_missing', 'sillyspec knowledge graph not supported; upgrade sillyspec');
    }
    if ((sub === 'summary' || sub === 'nodes') && (errCode === 'graph_usage' || stdout.includes('graph_usage'))) {
      const echoed = err?.subcommand === sub;
      const usage = typeof err?.usage === 'string' ? err.usage : stdout;
      if (echoed || !usage.includes(sub)) {
        return new RpcError(
          `cli_feature_missing:${sub}`,
          `sillyspec knowledge graph ${sub} not supported; upgrade sillyspec`,
        );
      }
    }
    return undefined;
  }
}
