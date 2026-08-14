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
