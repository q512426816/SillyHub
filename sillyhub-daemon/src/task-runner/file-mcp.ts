/**
 * task-runner/file-mcp.ts —— worker sillyhub-file MCP 临时 .mcp.json 簇。
 *
 * task-03（2026-09-07-arch-large-file-split / D-004@v1）：原 task-runner.ts 的
 * FILE_MCP_TMP_PREFIX / FILE_MCP_TMP_MAX_AGE_MS / fileMcpTmpPathFor /
 * cleanupStaleFileMcpConfigs / fileMcpSweepStarted 模块状态与
 * TaskRunner._writeFileMcpTmpConfig 方法体原样搬移（仅 ``this`` → ``runner``
 * 改显式传参，行为零变化）。
 *
 * @module task-runner/file-mcp
 */

import { readdir, rm, stat } from 'node:fs/promises';
import { writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// task-07（2026-08-23-agent-file-upload-mcp / FR-02/FR-07 / D-009@v2）：worker spawn
// 注入 sillyhub-file MCP——buildFileMcpServerConfig 构造 server 条目，凭证经
// per-server env 写入 0600 tmpdir 临时 .mcp.json（唯一已验证可靠通道，spike-01）。
import {
  buildFileMcpServerConfig,
  FILE_MCP_SERVER_NAME,
  type DaemonMcpAuth,
} from '../mcp-config.js';
import type { LeaseCtx } from '../types.js';
import type { TaskRunnerCore } from './runner-types.js';

// ── task-07（2026-08-23-agent-file-upload-mcp / R-09 / D-009@v2）：worker .mcp.json ──

/**
 * worker 临时 .mcp.json 文件名前缀（os.tmpdir() 下；清扫残留按此前缀匹配）。
 * 文件名形态：``sillyhub-file-mcp-<runId>.json``（含 runId 可辨识）。
 */
export const FILE_MCP_TMP_PREFIX = 'sillyhub-file-mcp-';

/**
 * 启动清扫的残留文件年龄阈值（1 小时）。tmpfile 在 run 终态 finally 删除，
 * 仅 daemon 崩溃才会残留；清扫跳过比阈值新的文件——防止误删**并发在跑** run
 *（同机多 daemon / 测试并行构造多个 TaskRunner）的活跃 tmpfile。
 */
export const FILE_MCP_TMP_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * 构造 worker .mcp.json 在 os.tmpdir() 下的绝对路径（node:path join，三平台兼容）。
 * runId 做字符白名单清洗（UUID 天然安全；防 duck-typed payload 注入路径分隔符）。
 */
export function fileMcpTmpPathFor(runId: string): string {
  const safe = runId.replace(/[^A-Za-z0-9._-]/g, '_');
  return join(tmpdir(), `${FILE_MCP_TMP_PREFIX}${safe}.json`);
}

/**
 * 进程级单次守卫：清扫每进程只跑一次（见 TaskRunner 构造器注释）。
 */
let fileMcpSweepStarted = false;

/**
 * task-07（R-09）：TaskRunner 构造器触发的启动清扫入口（进程级单次守卫封装）。
 *
 * 生产 daemon 每进程仅构造一次 TaskRunner，行为不变；测试并行构造多个
 * TaskRunner 时避免重复全量 readdir 系统临时目录造成 IO 风暴，拖慢 spawn
 * 前路径击穿 waitForSpawn 类轮询预算（回归修正，见 writeFileMcpTmpConfig
 * 同步写注释）。清扫失败不影响 TaskRunner 可用性（fire-and-forget）。
 */
export function startFileMcpSweepOnce(): void {
  if (!fileMcpSweepStarted) {
    fileMcpSweepStarted = true;
    void cleanupStaleFileMcpConfigs().catch(() => {});
  }
}

/**
 * 清扫 tmpdir 同前缀残留 .mcp.json（daemon 启动时 fire-and-forget 调用）。
 *
 * 三平台兼容：readdir/stat/rm 全走 node:fs/promises；单文件失败 / tmpdir 不可读
 * 静默继续（清扫是卫生动作，绝不让 daemon 启动失败）。跳过未超年龄阈值的文件
 * （并发保护，见 {@link FILE_MCP_TMP_MAX_AGE_MS}）。
 *
 * @returns 实际删除的文件数（测试断言用）。
 */
export async function cleanupStaleFileMcpConfigs(
  maxAgeMs: number = FILE_MCP_TMP_MAX_AGE_MS,
): Promise<number> {
  let removed = 0;
  const dir = tmpdir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  const now = Date.now();
  for (const name of entries) {
    if (!name.startsWith(FILE_MCP_TMP_PREFIX) || !name.endsWith('.json')) continue;
    const filePath = join(dir, name);
    try {
      const s = await stat(filePath);
      if (!s.isFile()) continue;
      if (now - s.mtimeMs < maxAgeMs) continue;
      await rm(filePath, { force: true });
      removed++;
    } catch {
      // 单文件 stat/rm 失败：继续下一个（清扫 best-effort）
    }
  }
  return removed;
}

/**
 * 写 worker 临时 .mcp.json（仅 claude 租约调用，runLease 步骤 5.5）。
 *
 * - server 条目：``buildFileMcpServerConfig(server_url, {token, apiKey}, {runId,
 *   allowedRoot: workDir})``（task-05 工厂；runId 缺省回落 leaseId，保证文件名可辨识）；
 * - 位置：``os.tmpdir()``（node:path join 三平台兼容；**不进 workDir**——rootPath
 *   模式 workDir=宿主真实仓库，写进去会污染 git status，R-09）；
 * - 权限：writeFile mode 0600 + 显式 chmod 兜底（umask）；Windows 无 POSIX 权限位，
 *   chmod best-effort 不抛错（三平台兼容）；
 * - 凭证（D-009@v2）：daemon token/apiKey 经 per-server env 写入本 0600 文件
 *   （spike-01 验证 per-server env 是 MCP 子进程可靠投递通道）。
 *
 * 写盘异常由调用方 catch（warn 降级，不阻塞 worker 编排）。
 */
export function writeFileMcpTmpConfig(
  runner: TaskRunnerCore,
  leaseId: string,
  ctx: LeaseCtx,
  workDir: string,
): string {
  const backendUrl = runner.config?.server_url ?? '';
  const auth: DaemonMcpAuth = {
    // config 字段可空（null），Duck 类型归一为 undefined（守卫式不写键）。
    token: runner.config?.token ?? undefined,
    apiKey: runner.config?.api_key ?? undefined,
  };
  // runId 优先 AgentRun id（mcp-server 写日志行的锚）；缺失回落 leaseId 只求可辨识。
  const runId = ctx.agentRunId && ctx.agentRunId.trim() ? ctx.agentRunId : leaseId;
  const server = buildFileMcpServerConfig(backendUrl, auth, {
    runId,
    allowedRoot: workDir,
  });
  const path = fileMcpTmpPathFor(runId);
  const payload =
    JSON.stringify({ mcpServers: { [FILE_MCP_SERVER_NAME]: server } }, null, 2) + '\n';
  // 同步写（task-07 回归修正）：spawn 前路径保持零真实异步 IO 间隙——异步写入曾
  // 在并行测试负载下把 spawn 推迟到 waitForSpawn 轮询 / fake-timer 泵预算之外，
  // 子进程事件在监听器注册前发出被丢，35 例既有测试挂死。文件仅数百字节、worker
  // spawn 本就是重操作，同步写开销可忽略。
  writeFileSync(path, payload, { mode: 0o600 });
  // umask 可能把创建权限位收紧以外的位裁掉；显式 chmod 兜底回 0600。
  // Windows chmod 仅映射只读位、不抛错——best-effort（三平台兼容）。
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort：chmod 失败不影响功能（创建时已带 mode）
  }
  return path;
}
