/**
 * spawn-env —— claude 子进程 env 构造器（task-09 / B1）。
 *
 * 合并三层 env（优先级从高到低）：
 *   1. tool_config.env（ctx.toolConfig，经 credential.buildEnv 渲染占位符 + 大写）
 *   2. claude token（credentials.json ANTHROPIC_API_KEY / CLAUDE_OAUTH_TOKEN，
 *      process.env 兜底）
 *   3. process.env 副本
 *
 * 附 redactEnv 守卫：遮蔽疑似密钥 value，供日志输出使用。
 *
 * ⚠️ 不泄漏铁律（R-09）：
 *   - buildSpawnEnv 返回值**仅本地内存**传给 spawn({ env })，禁止序列化到
 *     日志 / Redis publish / HTTP 回传 / 磁盘 / lease.metadata。
 *   - 任何 env 相关日志**必须**先经 redactEnv，禁止直接 console.log(buildSpawnEnv(...))。
 *   - token 不入 submitMessages（claude 输出链路）、不入 complete_lease payload。
 *
 * design §4.2.3（用户密钥不离开本机）；requirements FR-05。
 */

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
}

/** spawn env 构造选项。 */
export interface BuildSpawnEnvOpts {
  /** 凭据管理器（读 credentials.json token + 渲染 tool_config 占位符）。 */
  credential: SpawnCredentialManager;
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
 * 三层合并（优先级从高到低）：tool_config.env > claude token > process.env。
 * token 绝不写空串（避免误判已配置）；credentials.json 与 process.env 都无则不写入。
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

  // 层 1：tool_config.env（最高优先级，覆盖下层）
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

  return env;
}

/**
 * 遮蔽 env 中的疑似密钥 value（用于日志输出）。
 *
 * 规则：key 名匹配 `/KEY|TOKEN|SECRET|PASSWORD|PAT|CREDENTIAL/i` → value 替换为
 * `***REDACTED***`；其他 key 保留原值。
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
