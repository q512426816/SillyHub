/**
 * spawn-env —— claude 子进程 env 构造器（task-09 / B1）。
 *
 * 合并四层 env（优先级从高到低）：
 *   0. provider_config（平台下发，injector.toEnv 产 ANTHROPIC_* env）—— task-09 新增
 *   1. tool_config.env（ctx.toolConfig，经 credential.buildEnv 渲染占位符 + 大写）
 *   2. claude token（credentials.json ANTHROPIC_API_KEY / CLAUDE_OAUTH_TOKEN，
 *      process.env 兜底）
 *   3. process.env 副本
 *
 * 附 redactEnv / redactProviderConfig 守卫：遮蔽疑似密钥 value，供日志输出使用。
 *
 * ⚠️ 不泄漏铁律（R-09 / R-02）：
 *   - buildSpawnEnv 返回值**仅本地内存**传给 spawn({ env })，禁止序列化到
 *     日志 / Redis publish / HTTP 回传 / 磁盘 / lease.metadata。
 *   - 任何 env 相关日志**必须**先经 redactEnv，禁止直接 console.log(buildSpawnEnv(...))。
 *   - provider_config 对象含 api_key 明文，直接打对象须先经 redactProviderConfig。
 *   - token 不入 submitMessages（claude 输出链路）、不入 complete_lease payload。
 *
 * design §5（第 0 层注入最高优先级）/ §9（未配兜底零回归 D-007）；requirements FR-04 / FR-05。
 */

import { getInjector, setDaemonApiKey } from './credential-injector.js';
import { CLAUDE_CONFIG_DIR } from './config.js';
import type { ProviderConfig } from './types.js';

/**
 * 有状态的码页探测解码器（ql-20260915-005，ql-20260916-003 重写）：自管字节
 * 缓冲 + 增量 UTF-8 严格校验——扫描每个 chunk 的最长完整合法 UTF-8 前缀，
 * 未决尾字节（跨 chunk 的半个多字节字符）留存续接不误判；遇到非法字节才
 * 切 GBK 流式解码（未决尾字节一并交 GBK 重新解释，不丢字节）。
 *
 * 原实现（0b05fc0f5）依赖 StringDecoder.write 抛错触发切换，但 Node 的
 * StringDecoder 从不抛错——非法/GBK 字节直接替换为 U+FFFD 返回，catch 是
 * 死代码，GBK 流式回退从未生效（task-runner stdout / pi·cursor LfLineFramer
 * 的中文 Windows GBK 输出仍乱码落库；Node v24 实测 D6D0CEC4 → "���"）。
 * 与 decodeProcessOutputMaybe 的立即版互补：流式边界用本类，单块缓冲用函数。
 *
 * 已知启发式边界（与立即版一致）：恰构成合法 UTF-8 的 GBK 双字节序列会被
 * 当 UTF-8 解出（GBK trail 落 ASCII 区时两编码有交集），字节级探测无法区分。
 */
export class CodepageDetectorDecoder {
  /** 已切 GBK 后的流式解码器；null = 仍在 UTF-8 探测态。 */
  private gbk: InstanceType<typeof TextDecoder> | null = null;
  /** UTF-8 探测态的未决尾字节（≤3 字节的不完整多字节前缀，跨 chunk 续接）。 */
  private pending: Buffer = Buffer.alloc(0);
  /** 严格 UTF-8 解码器；输入恒为已校验完整前缀（无 stream 态，可复用）。 */
  private readonly utf8 = new TextDecoder('utf-8', { fatal: true });

  write(chunk: Buffer): string {
    if (this.gbk) {
      return this.gbk.decode(chunk, { stream: true });
    }
    const buf = this.pending.length
      ? Buffer.concat([this.pending, chunk])
      : chunk;
    const completeLen = utf8CompletePrefixLen(buf);
    if (completeLen < 0) {
      // 存在非法 UTF-8 字节 → 切 GBK：未决尾字节 + 本 chunk 全部按 GBK 流式
      // 重解（原实现的「冲刷缓冲」只调了 utf8.end() 丢弃返回值，字节实际丢失）。
      this.pending = Buffer.alloc(0);
      this.gbk = makeGbkStreamDecoder();
      return this.gbk.decode(buf, { stream: true });
    }
    // 拷贝留存未决尾字节（subarray 会钉住整个父 chunk 的底层内存不释放）。
    this.pending = Buffer.from(buf.subarray(completeLen));
    return completeLen > 0
      ? this.utf8.decode(buf.subarray(0, completeLen))
      : '';
  }

  end(): string {
    if (this.gbk) {
      return this.gbk.decode();
    }
    if (this.pending.length === 0) return '';
    // 流结束时仍悬空的 UTF-8 尾字节 = 截断序列，产出替换字符（对齐旧
    // StringDecoder.end 语义，字节不再回流）。
    const tail = this.pending;
    this.pending = Buffer.alloc(0);
    return new TextDecoder('utf-8').decode(tail);
  }
}

/**
 * GBK 流式解码器构造（UTF-8 判定失败后调用）。small-icu 构建
 * TextDecoder('gbk') 构造抛 RangeError 时退非致命 utf-8（输出替换字符，
 * 与立即版 decodeProcessOutputMaybe 的末级兜底一致）。
 */
function makeGbkStreamDecoder(): InstanceType<typeof TextDecoder> {
  try {
    return new TextDecoder('gbk');
  } catch {
    return new TextDecoder('utf-8');
  }
}

/**
 * 扫描 buffer 的最长**完整**合法 UTF-8 前缀长度：返回 -1 = 存在非法字节
 * （裸延续/过短起始 0xC0·0xC1、越界起始 ≥0xF5、连续字节缺失或越出收紧区间）；
 * 否则返回完整序列总字节数——末尾悬空的不完整多字节前缀不计入（调用方留存
 * 跨 chunk 续接）。区间收紧规则对齐 WHATWG UTF-8 解码器（E0 后 ≥0xA0 防过
 * 短、ED 后 ≤0x9F 防代理区、F0 后 ≥0x90 / F4 后 ≤0x8F 防 U+10FFFF 越界）。
 */
function utf8CompletePrefixLen(buf: Buffer): number {
  const n = buf.length;
  let i = 0;
  while (i < n) {
    const b = buf[i]!;
    if (b < 0x80) {
      i += 1;
      continue;
    }
    let need = 0;
    let lo = 0x80;
    let hi = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) {
      need = 1;
    } else if (b === 0xe0) {
      need = 2;
      lo = 0xa0;
    } else if ((b >= 0xe1 && b <= 0xec) || b === 0xee || b === 0xef) {
      need = 2;
    } else if (b === 0xed) {
      need = 2;
      hi = 0x9f;
    } else if (b === 0xf0) {
      need = 3;
      lo = 0x90;
    } else if (b >= 0xf1 && b <= 0xf3) {
      need = 3;
    } else if (b === 0xf4) {
      need = 3;
      hi = 0x8f;
    } else {
      return -1;
    }
    // 连续 need 个字节：首字节用收紧区间 [lo,hi]，其余 [0x80,0xbf]。
    let j = i + 1;
    let first = true;
    while (j <= i + need) {
      if (j >= n) return i; // 尾部悬空 = 不完整前缀，[0,i) 之前均完整
      const c = buf[j]!;
      const low = first ? lo : 0x80;
      const high = first ? hi : 0xbf;
      if (c < low || c > high) return -1;
      first = false;
      j += 1;
    }
    i = j;
  }
  return i;
}

/**
 * 子进程输出按系统码页探测解码（ql-20260915-005 / P2-2 乱码根治的兜底层）。
 *
 * 同 autostart/windows.ts `decodeProcessOutput` 的同构策略（唯一既有先例，记录
 * 同一 bug：中文 Windows 工具子进程按 OEM 码页 GBK 输出、Node 默认 utf-8 解码成
 * 替换字符）：严格 utf-8 fatal 解码优先（英文系统原样通过）→ 失败回退 GBK
 * （TextDecoder 全量 ICU 内建，零 npm 依赖）→ 再兜底 Node 默认（替换字符）。
 *
 * 与既有 helper 的差异：这里返回**可选**——调用点自己决定 byte→string 边界
 * （stderr 累积 / stdout 行分帧 / LfLineFramer），故函数签名保持纯（不吞 string
 * 输入：已解码 chunk 原样回传，仅 Buffer 走探测）。
 */
export function decodeProcessOutputMaybe(chunk: Buffer | string): string {
  if (typeof chunk === 'string') return chunk;
  const buf = chunk;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // 非 utf-8 字节序列 → 回退 GBK（中文 Windows OEM 码页 cp936）
  }
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch {
    return buf.toString('utf-8');
  }
}

/**
 * buildSpawnEnv 需要的凭据管理器接口子集（对齐 src/credential.ts 的
 * CredentialManager 的 get/buildEnv 两方法）。
 *
 * 用本地接口而非直接 import CredentialManager 类，避免 task-runner.ts
 * 注入 RunnerCredentialManager 时的类型耦合（鸭子类型，G-04）。
 */
export interface SpawnCredentialManager {
  /** 读 credentials.json 顶层键（如 ANTHROPIC_API_KEY），未配置返回 undefined。 */
  get(key: string): string | undefined;
  /** 渲染 tool_config 占位符 + key 大写，过滤未解析项。 */
  buildEnv(config: Record<string, unknown>): Record<string, string>;
}

/**
 * buildSpawnEnv 的 ctx 子集（结构兼容 LeaseCtx，避免循环依赖 types.ts）。
 * toolConfig 来自 task-05 fetch execution-context 注入的 tool_config.env。
 */
export interface SpawnEnvCtx {
  toolConfig?: Record<string, unknown> | null;
  /**
   * task-09（D-004@v1 / D-007@v1）：平台下发的 LLM 供应商配置（最高优先级第 0 层）。
   * 存在 + agent_kind 已注册 → injector.toEnv 产 env 盖过三层；
   * absent / null / agent_kind 未注册 → 第 0 层跳过，env 与现状三层逐字一致（零回归）。
   */
  provider_config?: ProviderConfig | null;
  /**
   * task-02（2026-08-23-agent-activity-sessions / D-008）：平台会话 id
   * （agent_sessions.id，非 agent 侧 resume key）。非空 → 注入
   * SILLYHUB_SESSION_ID（层 1 之上，见 buildSpawnEnv 内注释），让会话内跑的
   * sillyspec CLI 上报 hub_session_id 关联 platform_agent_logs（design §3.2）。
   * undefined / 空串 → 不注入（非平台会话派发不含该键，零回归）。
   */
  agentSessionId?: string;
}

/** spawn env 构造选项。 */
export interface BuildSpawnEnvOpts {
  /** 凭据管理器（读 credentials.json token + 渲染 tool_config 占位符）。 */
  credential: SpawnCredentialManager;
  /**
   * task-04（security-audit-remediation / Grill M-2）：daemon 自身 apiKey，
   * litellm_proxy 形态下盖过 injector 从模块级 _daemonApiKey 取的值（调用方
   * 显式传 config.api_key 的最短路径）。undefined → injector 用启动期
   * setDaemonApiKey 注入的进程级值（见 credential-injector.ts）。
   */
  daemonApiKey?: string | null;
}

/**
 * claude 凭据在 credentials.json 中的约定键名（明文存储，credentials.json 已 0600）。
 * API key 模式与 OAuth 模式二选一；两者并存时 claude CLI 自身决定优先级（实测 API key 优先），
 * buildSpawnEnv 不做选择，两者都注入。
 */
export const ANTHROPIC_API_KEY_FIELD = 'ANTHROPIC_API_KEY';
export const CLAUDE_OAUTH_TOKEN_FIELD = 'CLAUDE_OAUTH_TOKEN';

/**
 * task-02（2026-08-23-agent-activity-sessions / D-008）：平台会话身份 env 键。
 * daemon 派生 agent 子进程注入该键（值 = 平台 agent_sessions.id），sillyspec CLI
 * 读它作上报 hub_session_id（协议 v1.1，design §3.1/§3.2）。
 */
export const SILLYHUB_SESSION_ID_FIELD = 'SILLYHUB_SESSION_ID';

/**
 * ql-20260907-007：sillyspec CLI spec-sync 总预算熔断的 env 开关（sillyspec ≥3.28.1
 * resolveSyncTotalTimeoutMs 读取，CLI 默认 8s）。平台执行环境实测 manifest 端点忙时
 * 偶发 >8s 触发熔断 warn（数据不丢但噪音吓人），此处注入放宽默认值 20s。
 * 语义 = 填补缺省（非覆盖）：process.env / tool_config.env 已预设（含用户显式
 * 调回 8000）时保留原值。与 daemon 侧 sillyspec-manager runProgressJsonDefault
 * 共用本常量（两路 sillyspec 命令同一缺省值，改值只改这里）。
 * 背景：docs/sillyspec/2026-09-07-spec-sync-abort-classification.md §3 行动项 1。
 */
export const SILLYSPEC_SYNC_TIMEOUT_MS_FIELD = 'SILLYSPEC_SYNC_TIMEOUT_MS';
export const SILLYSPEC_SYNC_TIMEOUT_DEFAULT_MS = '20000';

const TOKEN_FIELDS: readonly string[] = [
  ANTHROPIC_API_KEY_FIELD,
  CLAUDE_OAUTH_TOKEN_FIELD,
];

/** tool_config.env 覆盖会破坏子进程的系统键（仅 warning，不阻断）。 */
const SYSTEM_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'LANG',
  'LC_ALL',
  'PWD',
]);

/**
 * 子进程源端 UTF-8 缺省 env（ql-20260915-005 / P2-2）：buildSpawnEnv 出口
 * 仅在键**缺失/空串**时填入——用户显式值与 tool_config.env/provider_config
 * 下发值优先级更高（见函数尾注）。
 */
const UTF8_DEFAULT_ENV: Readonly<Record<string, string>> = {
  PYTHONIOENCODING: 'utf-8',
  PYTHONUTF8: '1',
};

/**
 * redactEnv 匹配的疑似密钥 key 名（大小写不敏感）。
 *
 * 每个词加词边界 ``\b``：``PAT\b`` 不匹配 ``PATH``（PAT 后跟 H 非边界），
 * 但匹配 ``GIT_PAT``（PAT 后是结尾边界）；同理 ``KEY\b`` 匹配
 * ``ANTHROPIC_API_KEY`` 但不误伤 ``MONKEY_NAME`` 之类。规范 §边界（R-09）：
 * 遮蔽密钥类 key，保留 PATH/HOME/SHELL 等系统键供日志可读。
 */
const SENSITIVE_KEY = /KEY\b|TOKEN\b|SECRET\b|PASSWORD\b|PAT\b|CREDENTIAL\b/i;

/**
 * 构造 claude 子进程 env（spawn 的 SpawnOptions.env）。
 *
 * 四层合并（优先级从高到低）：provider_config（第 0 层）> tool_config.env（层 1）
 * > claude token（层 2）> process.env（层 3）。
 * token 绝不写空串（避免误判已配置）；credentials.json 与 process.env 都无则不写入。
 * task-02（2026-08-23-agent-activity-sessions）：ctx.agentSessionId 非空时在
 * 层 1 之上、层 0 之下注入 SILLYHUB_SESSION_ID（平台会话身份，见下方内联注释）。
 *
 * 第 0 层（task-09 / D-004）：provider_config 存在 + agent_kind 已注册 injector
 * → injector.toEnv 产 env **最后赋值**盖过三层同名 key（最高优先级）。
 * provider_config absent / null / agent_kind 未注册（getInjector 返回 undefined）
 * → 第 0 层整体跳过，env 与原三层合并逐字一致（D-007 brownfield 零回归，绝不抛异常）。
 *
 * @returns env 仅本地内存使用，禁止序列化到日志/Redis/HTTP/磁盘
 */
export function buildSpawnEnv(
  ctx: SpawnEnvCtx,
  opts: BuildSpawnEnvOpts,
): NodeJS.ProcessEnv {
  // 层 3：process.env 副本（基础层，不删任何键）
  const env: NodeJS.ProcessEnv = { ...process.env };

  // 层 2：claude token（credentials.json > process.env 兜底）
  for (const field of TOKEN_FIELDS) {
    const credValue = opts.credential.get(field);
    const fallback = process.env[field];
    // 空串视为未配置（绝不写入空串），credentials.json 优先于 process.env
    const value = credValue || fallback;
    if (value) {
      env[field] = value;
    }
  }

  // 层 1：tool_config.env（覆盖下层 process.env / token）
  // 复用 credential.buildEnv：渲染 {{USER_*}} 占位符 + key 大写 + 过滤未解析项
  const toolEnv = opts.credential.buildEnv(ctx.toolConfig ?? {});
  for (const [k, v] of Object.entries(toolEnv)) {
    if (SYSTEM_ENV_KEYS.has(k)) {
      // 仅 warning key 名（不含 value），dispatch 侧应避免下发系统键
      console.warn(
        `spawn_env_system_key_override key=${k} may affect subprocess`,
      );
    }
    env[k] = v;
  }

  // task-02（2026-08-23-agent-activity-sessions / D-008）：平台会话身份注入。
  // 注入层级放在 tool_config（层 1）之上——写在层 1 赋值之后，后写覆盖 tool_config
  // 大写后同名键（防 lease tool_config 下发 SILLYHUB_SESSION_ID 遮蔽平台会话身份，
  // Grill 建议）；同时写在 provider_config（层 0）赋值之前——极端场景 injector 产
  // 同名键时第 0 层生效（可接受：供应商配置属平台更高意志，正常不会下发此键）。
  // 值仅内存传递随 spawn env 进子进程，禁落盘/日志（R-09 同款约束）。
  // 空串视为未注入（永不写空会话 id）；不注入时清掉层 3 可能继承的残留同名键
  // （如 daemon 自身在平台会话终端内启动），确保非平台会话派发不含该键。
  if (ctx.agentSessionId) {
    env[SILLYHUB_SESSION_ID_FIELD] = ctx.agentSessionId;
  } else if (env[SILLYHUB_SESSION_ID_FIELD] !== undefined) {
    delete env[SILLYHUB_SESSION_ID_FIELD];
  }

  // ql-20260907-007：spec-sync 熔断预算缺省放宽（20s）。填补缺省而非覆盖——
  // 放在层 1（tool_config）赋值之后：process.env（层 3）/ tool_config.env（层 1）
  // 已预设时保留原值（用户显式配置优先）；空串视同未配置（对齐 token 约定，CLI
  // 对空串也会回退自身 8s 默认，不如直接给有效值）。非敏感配置值，redactEnv 不遮蔽。
  if (!env[SILLYSPEC_SYNC_TIMEOUT_MS_FIELD]) {
    env[SILLYSPEC_SYNC_TIMEOUT_MS_FIELD] = SILLYSPEC_SYNC_TIMEOUT_DEFAULT_MS;
  }

  // 层 0：provider_config（最高优先级，task-09 / D-004）
  // 平台下发的 LLM 供应商配置盖过 tool_config.env（层 1）/ token（层 2）/ process.env（层 3）。
  // 放在最后赋值保证同名 key 第 0 层生效。provider_config absent / null / agent_kind 未注册
  // → getInjector 返回 undefined，第 0 层跳过，env 与现状三层逐字一致（D-007 零回归）。
  // task-04（security-audit-remediation）：opts.daemonApiKey 显式传值时同步到 injector
  // 的进程级状态（litellm_proxy 形态下 injector 由此产 ANTHROPIC_AUTH_TOKEN；见
  // credential-injector.ts setDaemonApiKey 注释）。空串不注入（永不写空 AUTH_TOKEN）。
  if (ctx.provider_config) {
    if (opts.daemonApiKey) setDaemonApiKey(opts.daemonApiKey);
    const inj = getInjector(ctx.provider_config.agent_kind);
    if (inj) {
      Object.assign(env, inj.toEnv(ctx.provider_config));
    }
  }

  // ql-20260726-002-1180：隔离 claude 配置目录（避免宿主机 ~/.claude/settings.json
  // 如 cc-switch 的 model/env 污染平台注入）。daemon 启动确保 CLAUDE_CONFIG_DIR 存在。
  //
  // ql-20260729-002：仅当有平台注入的 provider_config（启用供应商）时才隔离 —— 让平台
  // 注入的 env 不被宿主机 cc-switch 污染。无 provider_config（未配/未启用供应商）时不设
  // CLAUDE_CONFIG_DIR，claude CLI 回退读默认 ~/.claude/settings.json（cc-switch/手配生效），
  // 避免"未配供应商 → 隔离空目录 → Not logged in"。
  if (ctx.provider_config) {
    env.CLAUDE_CONFIG_DIR = CLAUDE_CONFIG_DIR
  } else if (env.CLAUDE_CONFIG_DIR !== undefined) {
    // process.env 可能继承残留 CLAUDE_CONFIG_DIR（如 daemon 自身被设过），未隔离场景清掉，
    // 确保 claude CLI 读默认 ~/.claude 而非旧隔离目录。
    delete env.CLAUDE_CONFIG_DIR
  }

  // ql-20260915-005 后续项（P2-2 Claude SDK 链治本）：子进程源端 UTF-8 缺省注入。
  // Claude SDK 链的 Bash 工具输出字节在上游 SDK setEncoding('utf8') 已固化，daemon
  // 侧探测救不回——唯一治本路径是让工具子进程（python 等）从源端吐 UTF-8：
  //   - PYTHONIOENCODING=utf-8：python stdio 编码（用户实证有效，known-issues 条目）；
  //   - PYTHONUTF8=1：python 3.7+ UTF-8 模式（连 fs 编码一并覆盖，比前者更彻底）。
  // 语义 = 填补缺省（键已存在则不动）：用户/宿主显式设置或 tool_config.env/
  // provider_config 显式下发的同名键优先，绝不覆盖（三层合并已写完，这里只补洞）。
  // claude 子进程 → Bash → 工具孙进程全链继承，Windows/Linux/macOS 皆安全无副作用。
  for (const [key, value] of Object.entries(UTF8_DEFAULT_ENV)) {
    if (env[key] === undefined || env[key] === '') {
      env[key] = value;
    }
  }

  return env;
}

/**
 * 遮蔽 env 中的疑似密钥 value（用于日志输出）。
 *
 * 规则：key 名匹配 `/KEY|TOKEN|SECRET|PASSWORD|PAT|CREDENTIAL/i` → value 替换为
 * `***REDACTED***`；其他 key 保留原值。
 *
 * 主路径已覆盖 provider_config 注入的认证 key（ANTHROPIC_AUTH_TOKEN /
 * ANTHROPIC_API_KEY 等，均匹配 SENSITIVE_KEY 正则）；本函数对 buildSpawnEnv 产出
 * 自动脱敏，无需改正则（R-02）。
 *
 * 不修改入参 env（返回新对象）。
 */
export function redactEnv(
  env: NodeJS.ProcessEnv,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = SENSITIVE_KEY.test(k) ? '***REDACTED***' : v;
  }
  return out;
}

/**
 * 遮蔽 ProviderConfig 的 api_key 字段（防御性 helper，R-02 不泄漏）。
 *
 * 适用场景：daemon 日志 / 调试路径**直接打 provider_config 对象本身**（含 api_key
 * 明文字段，不经 buildSpawnEnv → env key 路径，redactEnv 抓不到）。
 *
 * 主链路（buildSpawnEnv → env）已被 redactEnv 覆盖（认证 env key 匹配 SENSITIVE_KEY），
 * 本 helper 留作防御性工具应对直接打对象场景。不修改入参（返回浅拷贝）。
 *
 * design §10 R-02 / task-09 constraints（防御性日志脱敏）。
 */
export function redactProviderConfig(config: ProviderConfig): ProviderConfig {
  const out: ProviderConfig = { ...config };
  if (out.api_key) {
    out.api_key = '***REDACTED***';
  }
  return out;
}
