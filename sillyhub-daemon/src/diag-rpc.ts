/**
 * diag-rpc.ts — daemon 诊断 RPC 纯逻辑（2026-10-13-daemon-log-config-view）。
 *
 * 两个只读诊断能力，供 daemon.ts 注册 WS RPC handler（daemon_log_tail /
 * daemon_config_get），backend 转发端点调用（design §Phase 1 / 接口定义）：
 *
 * - readLogTail(filePath, tailLines)：daemon.log 尾部 N 行——64KB 块从文件末尾
 *   向前扫描换行符，行上限（clamp 1..5000，默认 500）与尾部字节上限 262144B
 *   （256KB，与 backend agent-logs 先例同值，D-002@v1 故障面）先到先截；
 *   窗口起点不在文件头时丢弃不完整首行（同时天然修剪被切断的 UTF-8 多字节
 *   序列），行数因此不足请求时 truncated=true。
 * - getMaskedConfig(config, { reveal })：生效配置脱敏（D-001@v2）——清单仅
 *   token/api_key（新增凭据字段时须同步维护 SENSITIVE_CONFIG_FIELDS）；
 *   公式 len<16 → '***'，len≥16 → 前4位+'***'+后4位；reveal=true 返回明文。
 *
 * 零第三方依赖（仅 node:fs/promises / node:path）；正常路径不抛 RpcError
 * （文件不存在等全部结构化返回，由前端渲染边界态提示条）。
 */

import { open, stat } from 'node:fs/promises';

/** daemon_log_tail 默认/上限行数（design 接口定义）。 */
export const LOG_TAIL_DEFAULT_LINES = 500;
export const LOG_TAIL_MAX_LINES = 5000;

/** 尾部读取字节上限（262144B = 256KB，先例 platform_sync/router.py 同值）。 */
export const LOG_TAIL_MAX_BYTES = 262_144;

/** 单次向前读取的块大小。 */
const READ_CHUNK_BYTES = 64 * 1024;

/**
 * 敏感配置字段清单（D-001@v2 明文枚举）。
 * ⚠️ DaemonConfig 新增凭据类字段时必须同步维护本清单（漏加 = 明文泄露）。
 */
export const SENSITIVE_CONFIG_FIELDS: readonly string[] = ['token', 'api_key'];

export interface LogTailResult {
  path: string;
  size: number;
  mtime: string;
  exists: boolean;
  lines: string[];
  line_count: number;
  truncated: boolean;
}

export interface MaskedConfigResult {
  config: Record<string, unknown>;
  masked_fields: string[];
}

/** 单值掩码（D-001@v2）：len<16 全掩；len≥16 前4位+'***'+后4位。 */
export function maskValue(value: string): string {
  if (value.length < 16) return '***';
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

/**
 * 读日志文件尾部 N 行（行/字节双上限先到先截）。
 *
 * 文件不存在返回 exists:false 且全部字段兜底（size:0 / mtime:'' / lines:[] /
 * line_count:0 / truncated:false），不抛错——前台 TTY 运行不落盘 daemon.log 是
 * 已知场景，由前端提示。
 */
export async function readLogTail(filePath: string, tailLines: number): Promise<LogTailResult> {
  // clamp 1..5000：非数/0/负数 → 默认 500；超上限 → 5000。
  let n = Math.floor(Number(tailLines));
  if (!Number.isFinite(n) || n <= 0) n = LOG_TAIL_DEFAULT_LINES;
  if (n > LOG_TAIL_MAX_LINES) n = LOG_TAIL_MAX_LINES;

  let stats;
  try {
    stats = await stat(filePath);
  } catch {
    return {
      path: filePath,
      size: 0,
      mtime: '',
      exists: false,
      lines: [],
      line_count: 0,
      truncated: false,
    };
  }
  if (!stats.isFile()) {
    return {
      path: filePath,
      size: 0,
      mtime: '',
      exists: false,
      lines: [],
      line_count: 0,
      truncated: false,
    };
  }

  const size = stats.size;
  const mtime = stats.mtime.toISOString();
  const base = { path: filePath, size, mtime, exists: true };

  if (size === 0) {
    return { ...base, lines: [], line_count: 0, truncated: false };
  }

  const fh = await open(filePath, 'r');
  try {
    const chunks: Buffer[] = [];
    let position = size;
    let bytesCollected = 0;
    let newlineCount = 0;
    // 向前逐块读：行数够（newlineCount > n，即窗口内已有超过 n 个行尾）/
    // 字节到上限 / 到文件头，三者先到即停。
    while (position > 0 && newlineCount <= n && bytesCollected < LOG_TAIL_MAX_BYTES) {
      const readSize = Math.min(READ_CHUNK_BYTES, position, LOG_TAIL_MAX_BYTES - bytesCollected);
      position -= readSize;
      const buf = Buffer.alloc(readSize);
      await fh.read(buf, 0, readSize, position);
      chunks.unshift(buf);
      bytesCollected += readSize;
      for (let i = 0; i < readSize; i++) {
        if (buf[i] === 0x0a) newlineCount++;
      }
    }

    const atFileHead = position === 0;
    let text = Buffer.concat(chunks).toString('utf8');
    if (!atFileHead) {
      // 窗口首行不完整（读取起点落在行中间）：丢弃到第一个换行符之后——
      // 同时天然消除被切断的 UTF-8 多字节序列（后续行均完整）。
      const firstNl = text.indexOf('\n');
      text = firstNl >= 0 ? text.slice(firstNl + 1) : '';
    }
    let lines = text.length > 0 ? text.split('\n') : [];
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    // Windows 行尾稳健性：剥离行尾 \r（daemon 写日志用 \n，但 tee 场景不排除 \r\n）。
    lines = lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));

    const truncated = !atFileHead && lines.length < n;
    if (lines.length > n) lines = lines.slice(lines.length - n);
    return { ...base, lines, line_count: lines.length, truncated };
  } finally {
    await fh.close();
  }
}

/**
 * 生效配置脱敏（D-001@v2）：清单字段掩码、其余原样；reveal=true 整体明文。
 *
 * 值为空串/缺失的清单字段不掩、不列入 masked_fields（空值无泄露面）。
 * 不修改传入对象（浅拷贝）。
 */
export function getMaskedConfig(
  config: Record<string, unknown>,
  opts: { reveal: boolean },
): MaskedConfigResult {
  if (opts.reveal) {
    return { config: { ...config }, masked_fields: [] };
  }
  const masked: Record<string, unknown> = { ...config };
  const maskedFields: string[] = [];
  for (const key of SENSITIVE_CONFIG_FIELDS) {
    const v = masked[key];
    if (typeof v === 'string' && v.length > 0) {
      masked[key] = maskValue(v);
      maskedFields.push(key);
    }
  }
  return { config: masked, masked_fields: maskedFields };
}
