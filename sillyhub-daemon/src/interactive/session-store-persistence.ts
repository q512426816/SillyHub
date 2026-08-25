/**
 * interactive/session-store-persistence.ts —— sessions.json 元数据持久化（task-10 §4.2）。
 *
 * 职责：
 *   - load：从 ~/.sillyhub/daemon/sessions.json 加载可恢复 interactive session 元数据。
 *     文件不存在 → []（不创建）。损坏 JSON / version 不支持 → quarantine + []（不崩 daemon）。
 *     单条记录 schema 非法 → 该条丢弃（损坏隔离），其余保留。
 *     ql-20260825-f6#1：目标缺失 / 为空时先尝试从同目录 tmp 残留恢复（mtime 最新
 *     合法者，rename 落位），无合法 tmp 才返回 []——防 Windows unlink→rename 崩溃
 *     窗口导致全部会话不可恢复。
 *   - save：原子写（同目录 tmp + rename）整批记录；单一 promise queue 串行化，保证
 *     并发 save 顺序与最终一致性（最后一条 win）。0o600 权限（Windows 无效但保留）。
 *     ql-20260825-f6#1：成功后顺手清理超过 1h 的过期 tmp 残留。
 *   - quarantine：把当前文件重命名为 sessions.json.corrupt-<epoch>（隔离损坏文件，
 *     下次 load 不再触发损坏路径）。
 *
 * **白名单**：仅写 PersistedSessionRecord（sessionId/leaseId/agentSessionId/cwd/
 * provider/currentRunId?/turnCount/lastActiveAt/model?/pathToClaudeCodeExecutable?/
 * pathToAgentExecutable?/manualApproval?/askUserOnly?/stage?/worker_depth?/
 * mcpRefs?/skillRefs?/effectiveAllowedRoots?/systemPrompt?/providerConfig?）。
 * 禁止写 claim token / credential / prompt 轮次内容 / agent 输出 / Query 句柄 /
 * InputQueue（不可序列化或敏感）。
 * task-08（sessions-portal）例外：record.providerConfig 含 api_key——design §5 Wave2
 * 要求「daemon 重启 resume 不丢配置」，本文件 0600 与 credentials.json 同信任域。
 *
 * **SDK 自动持久化**：~/.claude/projects/<encoded-cwd>/<sid>.jsonl 由 SDK 写，
 * daemon 不读不写该 jsonl，resume 靠 SDK 内部加载（spike D3）。
 *
 * 来源：design.md §5 Wave3 / §10 R-cwd；task-10 §4.1/§4.2/§7 边界 3/13；
 * credential.ts:103-113（0600 原子写模式参考）。
 *
 * @module interactive/session-store-persistence
 */

import { existsSync, readFileSync } from 'node:fs';
import {
  chmod,
  mkdir,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  SESSION_FILE_VERSION,
  type PersistedSessionFile,
  type PersistedSessionRecord,
} from './types.js';

/** 默认文件路径：~/.sillyhub/daemon/sessions.json（task-10 §4.1 / config.ts）。 */
export const DEFAULT_SESSION_FILE = join(
  // 延迟 import 避免与 config.ts 循环（config.ts 仅导出常量，运行时无副作用）。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  homedir(),
  '.sillyhub',
  'daemon',
  'sessions.json',
);

/** 持久化错误（稳定 code 供 daemon 启动日志/测试识别）。 */
export class SessionPersistenceError extends Error {
  readonly code:
    | 'SESSION_FILE_CORRUPT'
    | 'SESSION_FILE_VERSION'
    | 'SESSION_FILE_IO';
  constructor(
    code: 'SESSION_FILE_CORRUPT' | 'SESSION_FILE_VERSION' | 'SESSION_FILE_IO',
    message: string,
  ) {
    super(`${message} (${code})`);
    this.name = 'SessionPersistenceError';
    this.code = code;
  }
}

const VALID_PROVIDERS = new Set(['claude', 'codex']);

/**
 * P0-1：字符串数组字段守卫（mcpRefs/skillRefs/effectiveAllowedRoots 用）。
 * Array.isArray 且元素全为 string 才通过；空数组合法（profile 显式空集语义）。
 */
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((e) => typeof e === 'string');
}

/**
 * ql-20260825-f6#1：tmp 残留过期时长（ms）。flush 成功后顺手清理超过此时长的
 * `.tmp-*` 残留（并发在写的新鲜 tmp 不会被误删——save 队列串行，在写 tmp 仅数秒龄）。
 */
const STALE_TMP_MS = 60 * 60 * 1000;

/**
 * ql-20260825-f6#1：文件内容解析结果（load 主路径与 tmp 恢复共用）。
 * ok=false 时 reason 供 load 主路径决定 quarantine 语义；tmp 恢复视任何 !ok 为
 * 「解析失败则忽略」（换下一个候选）。
 */
type ParseOutcome =
  | { ok: true; records: PersistedSessionRecord[] }
  | {
      ok: false;
      reason:
        | 'corrupt_json'
        | 'invalid_root'
        | 'unsupported_version'
        | 'invalid_sessions_array';
    };

/** ql-20260825-f6#1：解析 + 逐条校验文件文本（load / tmp 恢复共用，无副作用）。 */
function parseContent(raw: string): ParseOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'corrupt_json' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'invalid_root' };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== SESSION_FILE_VERSION) {
    return { ok: false, reason: 'unsupported_version' };
  }
  if (!Array.isArray(obj.sessions)) {
    return { ok: false, reason: 'invalid_sessions_array' };
  }
  // 损坏隔离：单条 schema 非法 → 丢弃该条，其余保留。
  const records: PersistedSessionRecord[] = [];
  for (const item of obj.sessions) {
    const rec = validateRecord(item);
    if (rec !== null) {
      records.push(rec);
    }
  }
  return { ok: true, records };
}

/**
 * 单条记录 schema 校验（白名单字段 + 类型）。非法 → 返回 null（load 时丢弃该条）。
 *
 * 不抛错（损坏隔离：单条坏不影响其他条目）。仅校验可恢复必需字段：
 * sessionId / leaseId / agentSessionId（非空）/ cwd（非空）/ provider（枚举）/
 * turnCount（有限数）/ lastActiveAt（有限数）；可选字段 model /
 * pathToClaudeCodeExecutable / currentRunId / manualApproval / askUserOnly 仅校验类型。
 *
 * task-06（D-007@v1）Codex 语义说明（不新增列，字段复用）：
 *   - provider='codex' 时 agentSessionId 即 Codex thread id（resume key）。
 *     缺失（空串）→ validateRecord 返回 null 丢弃，不伪造新 thread（D-007）。
 *   - pathToClaudeCodeExecutable 对 codex 即 codex app-server 可执行路径（兼容名，
 *     SessionManager.restoreAndReconnect 内 fallback 到 pathToAgentExecutable）；
 *     codex session 落盘时优先写 pathToAgentExecutable（task-02 snapshotPersistable）。
 *   - provider 枚举含 'codex'（VALID_PROVIDERS），codex record 正常通过校验。
 */
function validateRecord(raw: unknown): PersistedSessionRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const sessionId = typeof r.sessionId === 'string' ? r.sessionId : '';
  const leaseId = typeof r.leaseId === 'string' ? r.leaseId : '';
  const agentSessionId = typeof r.agentSessionId === 'string' ? r.agentSessionId : '';
  const cwd = typeof r.cwd === 'string' ? r.cwd : '';
  const provider = typeof r.provider === 'string' ? r.provider : '';
  const turnCount = typeof r.turnCount === 'number' && Number.isFinite(r.turnCount) ? r.turnCount : null;
  const lastActiveAt =
    typeof r.lastActiveAt === 'number' && Number.isFinite(r.lastActiveAt)
      ? r.lastActiveAt
      : null;

  if (!sessionId || !leaseId || !agentSessionId || !cwd || !VALID_PROVIDERS.has(provider)) {
    return null;
  }
  if (turnCount === null || lastActiveAt === null) {
    return null;
  }

  const out: PersistedSessionRecord = {
    sessionId,
    leaseId,
    agentSessionId,
    cwd,
    provider: provider as 'claude' | 'codex',
    turnCount,
    lastActiveAt,
  };
  if (typeof r.currentRunId === 'string' && r.currentRunId) {
    out.currentRunId = r.currentRunId;
  }
  if (typeof r.model === 'string' && r.model) {
    out.model = r.model;
  }
  if (typeof r.pathToClaudeCodeExecutable === 'string' && r.pathToClaudeCodeExecutable) {
    out.pathToClaudeCodeExecutable = r.pathToClaudeCodeExecutable;
  }
  // task-02 R8（D-002）：provider-neutral executable path（codex path 恢复用）。
  // 与 pathToClaudeCodeExecutable 并存；仅校验非空字符串才写入，其余丢弃（向后兼容旧文件）。
  if (typeof r.pathToAgentExecutable === 'string' && r.pathToAgentExecutable) {
    out.pathToAgentExecutable = r.pathToAgentExecutable;
  }
  // scan 真阻塞（恢复路径用）：manualApproval / askUserOnly 落盘白名单。
  // manualApproval 仅校验布尔（create 路径只在 true 时写）；askUserOnly 同理
  //（manualApproval=true 时写 true/false，false 也写以区分 chat vs scan）。
  if (typeof r.manualApproval === 'boolean') {
    out.manualApproval = r.manualApproval;
  }
  if (typeof r.askUserOnly === 'boolean') {
    out.askUserOnly = r.askUserOnly;
  }
  // P0-1（2026-08-25 team-subsession 路线图）：stage / profile 三字段回填。
  // 落盘侧 snapshotPersistable 写、恢复侧 restoreAndReconnect 读，本函数此前漏拷
  // → 重启后 mission_worker 会话 stage 变 undefined，isMainAgentSession 谓词
  // stage ?? '' 命中空串分支被注入派工 MCP 工具（防递归防线失效），profile 的
  // mcpRefs 过滤 / effectiveAllowedRoots 写守卫收紧恢复后也全部丢失。
  // 容错风格与可选字段一致：类型非法 → 丢字段保记录（损坏隔离，不丢整条）。
  if (typeof r.stage === 'string' && r.stage) {
    out.stage = r.stage;
  }
  // task-04（2026-08-26-team-subsession-recursion / design §5.C / Grill M3）：
  // 分身深度回填——P0-1 修复的四字段链同款容错（Number.isFinite 才写，0 合法；
  // 类型非法 → 丢字段保记录，损坏隔离不丢整条）。此处漏拷则重启后非叶分身
  // worker_depth 变 undefined，task-05 的叶档兜底会把派工工具静默降级（宁少
  // 勿多防越权，但非叶误降叶会砍掉合法递归派工能力）。
  if (typeof r.worker_depth === 'number' && Number.isFinite(r.worker_depth)) {
    out.worker_depth = r.worker_depth;
  }
  if (isStringArray(r.mcpRefs)) {
    out.mcpRefs = r.mcpRefs;
  }
  if (isStringArray(r.skillRefs)) {
    out.skillRefs = r.skillRefs;
  }
  if (isStringArray(r.effectiveAllowedRoots)) {
    out.effectiveAllowedRoots = r.effectiveAllowedRoots;
  }
  // task-08（2026-08-14-sessions-portal / design §5 Wave2）：会话级配置快照容错透传。
  // systemPrompt 非空字符串才写；providerConfig 仅校验 object（结构由 backend 下发，
  // daemon 不逐字段校验——恢复失败由 restoreAndReconnect 的 driver.start try/catch 收敛）。
  // 旧 sessions.json 无这些字段 → 缺省容错（不写 = 恢复走本机默认链，design §9）。
  if (typeof r.systemPrompt === 'string' && r.systemPrompt) {
    out.systemPrompt = r.systemPrompt;
  }
  if (r.providerConfig && typeof r.providerConfig === 'object') {
    out.providerConfig = r.providerConfig as PersistedSessionRecord['providerConfig'];
  }
  return out;
}

/**
 * JSON 文件持久化实现。
 *
 * 行为：
 *   - load：不存在 / 空文件 → 尝试 tmp 残留恢复（ql-20260825-f6#1），无合法 tmp → []；
 *     损坏 → quarantine + []；version 不支持 → quarantine + []；
 *     单条 schema 非法 → 该条丢弃（其余保留）。
 *   - save：tmp + rename 原子写；单一 promise queue 串行；0o600（Windows no-op）；
 *     成功后清理 >1h 过期 tmp 残留（ql-20260825-f6#1）。
 *   - quarantine：把当前文件重命名为 sessions.json.corrupt-<epoch>，不存在则 no-op。
 */
export class JsonSessionPersistence {
  private readonly _filePath: string;
  /** 串行化 promise queue：save 调用按顺序排队（最后一条 win，防并发写损坏）。 */
  private _saveQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string = DEFAULT_SESSION_FILE) {
    this._filePath = filePath;
  }

  /** 文件路径（测试 / daemon 日志用）。 */
  get filePath(): string {
    return this._filePath;
  }

  async load(): Promise<PersistedSessionRecord[]> {
    // ql-20260825-f6#1：目标缺失 / 空文件（Windows unlink→rename 两步窗口崩溃 /
    // rename 兜底直写中途死）→ 尝试从同目录 tmp 残留恢复（mtime 最新优先），
    // 而非直接 []（旧行为下全部会话不可恢复）。
    let raw: string | null = null;
    if (existsSync(this._filePath)) {
      try {
        raw = readFileSync(this._filePath, 'utf8');
      } catch {
        // 读失败（权限等）：当损坏隔离，quarantine + 空集合。
        await this.quarantine('read_failed').catch(() => undefined);
        return [];
      }
      if (raw.trim() === '') {
        // 空文件视同缺失（写入未完成），不当损坏 quarantine（避免产 .corrupt 垃圾）。
        raw = null;
      }
    }
    if (raw === null) {
      return this._recoverFromTmp();
    }

    const outcome = parseContent(raw);
    if (!outcome.ok) {
      // 损坏 JSON / 根非法 / version 不支持 / sessions 非数组：quarantine + 空集合
      //（不抛、不崩 daemon）。
      await this.quarantine(outcome.reason).catch(() => undefined);
      return [];
    }
    return outcome.records;
  }

  /**
   * 原子写整批记录。
   *
   * 单一 promise queue 串行化：所有 save 调用排队，前一个完成才执行下一个，
   * 保证并发 save 的最终一致（最后一条 win，不出现交错损坏）。
   * 原子替换：写到同目录临时文件 → rename 到目标（POSIX rename 原子；Windows
   * rename 也覆盖目标，调用前删目标避免 EXDEV/EBUSY）。0o600 权限（POSIX）。
   */
  save(records: readonly PersistedSessionRecord[]): Promise<void> {
    const run = async (): Promise<void> => {
      const file: PersistedSessionFile = {
        version: SESSION_FILE_VERSION,
        savedAt: new Date().toISOString(),
        sessions: records.slice(),
      };
      const payload = JSON.stringify(file, null, 2);
      const dir = dirname(this._filePath);
      await mkdir(dir, { recursive: true });
      // 同目录临时文件：与 rename 跨设备无关（同分区）。
      const tmpPath = `${this._filePath}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(tmpPath, payload, 'utf8');
      try {
        await chmod(tmpPath, 0o600);
      } catch {
        // POSIX chmod 失败 / Windows NTFS 无 0600 语义 → 降级不中断（R-05）。
      }
      // Windows rename 目标存在会失败 → 先 unlink 再 rename。
      if (existsSync(this._filePath)) {
        try {
          await unlink(this._filePath);
        } catch {
          // 并发场景下另一进程刚写：忽略，rename 仍尝试。
        }
      }
      try {
        await rename(tmpPath, this._filePath);
      } catch {
        // rename 失败兜底：直接写目标（牺牲原子性但保证最终落盘）。
        try {
          await writeFile(this._filePath, payload, 'utf8');
          await chmod(this._filePath, 0o600).catch(() => undefined);
          await unlink(tmpPath).catch(() => undefined);
        } catch {
          // 最终落盘也失败 → 抛 SessionPersistenceError，让调用方记录（不吞错）。
          throw new SessionPersistenceError(
            'SESSION_FILE_IO',
            `failed to persist sessions.json at ${this._filePath}`,
          );
        }
      }
      // ql-20260825-f6#1：flush 成功后顺手清理过期 tmp 残留（>STALE_TMP_MS）。
      // 失败忽略（下次 flush 再试）；不会误删在写 tmp（save 队列串行 + 时长阈值）。
      await this._cleanupStaleTmp().catch(() => undefined);
    };
    // 串行化：每次 save 排到 queue 尾，前一个 settle 后才执行。
    const next = this._saveQueue.then(run, run);
    // 不让 queue 因单次失败永久 reject（catch 后续可继续）。
    this._saveQueue = next.catch(() => undefined);
    return next;
  }

  /**
   * 隔离：把当前文件重命名为 sessions.json.corrupt-<epoch>。
   *
   * 原文件不再存在（下次 load 视为不存在 → []）。文件不存在时 no-op。
   * 重命名失败（权限/占用）→ 静默吞（load 已决定返回空集合，不崩 daemon）。
   */
  async quarantine(reason: string): Promise<void> {
    if (!existsSync(this._filePath)) return;
    const corruptName = `sessions.json.corrupt-${Date.now()}`;
    const corruptPath = join(dirname(this._filePath), corruptName);
    try {
      await rename(this._filePath, corruptPath);
    } catch {
      // rename 失败兜底：删原文件（仍隔离下次 load 不再读损坏内容）。
      try {
        await unlink(this._filePath);
      } catch {
        // 都失败：load 已决定返回 []，daemon 不崩；记录在控制台。
        // eslint-disable-next-line no-console
        console.warn(
          `[session-persistence] quarantine failed reason=${reason} path=${this._filePath}`,
        );
      }
    }
  }

  /** 当前目录下的 sessions.json.corrupt-* 文件清单（测试 / 运维清理用）。 */
  async listQuarantined(): Promise<string[]> {
    const dir = dirname(this._filePath);
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir);
    return entries.filter((e) => e.startsWith('sessions.json.corrupt-'));
  }

  // ── ql-20260825-f6#1：tmp 残留恢复 / 回收 ────────────────────────────────────

  /**
   * 同目录 tmp 残留清单（mtime 新→旧）。目录不存在 / stat 失败（并发消失等）→ 跳过。
   * 仅匹配本文件自己的 `<basename>.tmp-` 前缀（save 产出的命名），不碰其他文件。
   */
  private async _listTmpEntries(): Promise<
    Array<{ path: string; mtimeMs: number }>
  > {
    const dir = dirname(this._filePath);
    if (!existsSync(dir)) return [];
    const prefix = `${basename(this._filePath)}.tmp-`;
    const entries = await readdir(dir);
    const out: Array<{ path: string; mtimeMs: number }> = [];
    for (const e of entries) {
      if (!e.startsWith(prefix)) continue;
      const p = join(dir, e);
      try {
        const st = await stat(p);
        if (st.isFile()) {
          out.push({ path: p, mtimeMs: st.mtimeMs });
        }
      } catch {
        // 竞态消失 / 权限：跳过该条（不影响其余候选）。
      }
    }
    out.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return out;
  }

  /**
   * ql-20260825-f6#1：目标缺失 / 为空时从 tmp 残留恢复。
   *
   * 取 mtime 最新的**合法** tmp（完整解析 + 逐条校验通过），rename 到目标完成落位
   *（顺手回收该 tmp）；解析失败的候选忽略、继续尝试更旧的。无合法候选 → []。
   * 落位失败（rename + 直写都失败）不抛——记录已解析可返回，落位留给下次 load 重试。
   */
  private async _recoverFromTmp(): Promise<PersistedSessionRecord[]> {
    const candidates = await this._listTmpEntries().catch(() => []);
    for (const cand of candidates) {
      let content: string;
      try {
        content = readFileSync(cand.path, 'utf8');
      } catch {
        continue;
      }
      const outcome = parseContent(content);
      if (!outcome.ok) continue; // 损坏 tmp：忽略（残留待过期清理）
      // 落位：目标为空时先删（对齐 save 的 Windows unlink→rename 模式）再 rename。
      if (existsSync(this._filePath)) {
        await unlink(this._filePath).catch(() => undefined);
      }
      try {
        await rename(cand.path, this._filePath);
      } catch {
        try {
          await writeFile(this._filePath, content, 'utf8');
          await chmod(this._filePath, 0o600).catch(() => undefined);
          await unlink(cand.path).catch(() => undefined);
        } catch {
          // 落位失败：记录仍可返回（下次 load 重试恢复），不抛。
        }
      }
      return outcome.records;
    }
    return [];
  }

  /** ql-20260825-f6#1：清理超过 STALE_TMP_MS 的 tmp 残留（失败忽略，幂等）。 */
  private async _cleanupStaleTmp(): Promise<void> {
    const candidates = await this._listTmpEntries();
    const now = Date.now();
    for (const cand of candidates) {
      if (now - cand.mtimeMs > STALE_TMP_MS) {
        await unlink(cand.path).catch(() => undefined);
      }
    }
  }
}
