/**
 * credential-injector —— provider-neutral 凭证注入器（task-08 / Wave3）。
 *
 * 把后端 lease 下发的 ProviderConfig（中性 snake_case 结构）翻译成各 agent 认得的
 * env 字典。第一版只实现 claude（ClaudeCredentialInjector），接口最小化预留 codex /
 * gemini / pi 扩展（D-006 抽象边界，对齐 adapters/index.ts:52 协议抽象风格）。
 *
 * design §7（注入器 TS 块 6 条映射规则）/ §5 架构（spawn-env 第 0 层注入最高优先级）。
 *
 * spike-01 结论（2026-07-25 官方文档实测确认，X-11 / X-12 双通过）：
 *   - ANTHROPIC_DEFAULT_FABLE_MODEL 官方文档已收录（fallback Fable 5），与
 *     HAIKU/SONNET/OPUS 同族四角色 env 全部实证（X-11 通过，无需降级走 default_fallback）。
 *     来源：https://code.claude.com/docs/en/env-vars
 *   - [1m] 后缀触发 1M 上下文窗口，官方 model-config 文档明确示例
 *     `export ANTHROPIC_DEFAULT_OPUS_MODEL='claude-opus-4-8[1m]'`（X-12 通过）。
 *     来源：https://code.claude.com/docs/en/model-config#extended-context
 *
 * toEnv 为纯函数（无 fs / 网络 / 全局态），便于单测（task-10，constraints 铁律）。
 */

import type { ProviderConfig } from './types.js';

/**
 * provider-neutral 凭证注入器接口（D-006 抽象边界，最小化）。
 *
 * 加新 agent（codex / gemini / pi）时：新增 XxxCredentialInjector 实现本接口 +
 * 在 getInjector 注册表登记，后端 / lease 协议 / spawn-env 不变（D-006）。
 * 接口不得加 provider 专属字段（task-08 constraints）。
 */
export interface CredentialInjector {
  /** agent 种类（如 'claude'），与 ProviderConfig.agent_kind 对齐。 */
  readonly agentKind: string;
  /**
   * 把中性 ProviderConfig 翻译成该 agent 认得的 env 字典。
   *
   * 纯函数：无 fs / 网络 / 全局态，相同输入相同输出（task-10 单测前提）。
   * 返回值仅本地内存使用，禁止序列化到日志 / HTTP / 磁盘（R-02 不泄漏铁律）。
   */
  toEnv(config: ProviderConfig): Record<string, string>;
}

/**
 * claude code 专属注入器（agentKind='claude'）。
 *
 * 按 design §7 TS 块的 6 条映射规则产 ANTHROPIC_* env：
 *   1. base_url → ANTHROPIC_BASE_URL（空不写）
 *   2. api_key → env[auth_field ?? 'ANTHROPIC_AUTH_TOKEN']（不再两个都写，D-010 / X-13）
 *   3. default_fallback_model ?? model → ANTHROPIC_MODEL（两者皆空不写）
 *   4. model_role_mappings → ANTHROPIC_DEFAULT_{ROLE}_MODEL（仅 model 非空注入；未知角色忽略，D-011）
 *   5. one_m=true → 角色模型名追加 [1m] 后缀（X-12 官方文档实测，触发 1M 上下文）
 *   6. extra_env → Object.assign 注入（可覆盖角色 env，design §7 Object.assign 顺序）
 *   7. settings_config.env → Object.assign 注入（最后，覆盖优先级最高，D-007 / task-05）
 */
export class ClaudeCredentialInjector implements CredentialInjector {
  readonly agentKind = 'claude';

  /**
   * 4 角色 → claude code 的默认模型 env 名。
   *
   * deploy/.env.example 实证 HAIKU/SONNET/OPUS；
   * spike-01（2026-07-25）官方文档 code.claude.com/docs/en/env-vars 收录全部四项
   *（HAIKU→Haiku 4.5 / SONNET→Sonnet 4.6 / OPUS→Opus 4.8 / FABLE→Fable 5），
   * X-11 通过，Fable 角色无需降级走 default_fallback_model。
   */
  static readonly ROLE_ENV: Readonly<Record<string, string>> = Object.freeze({
    sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    fable: 'ANTHROPIC_DEFAULT_FABLE_MODEL',
    haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  });

  toEnv(c: ProviderConfig): Record<string, string> {
    const env: Record<string, string> = {};

    // 1. base_url → ANTHROPIC_BASE_URL（空串 / undefined 不写该 key）
    if (c.base_url) env.ANTHROPIC_BASE_URL = c.base_url;

    // 2. api_key → auth_field 指定的 env（缺省 ANTHROPIC_AUTH_TOKEN；不再两个都写，X-13）
    if (c.api_key) {
      const authField = c.auth_field ?? 'ANTHROPIC_AUTH_TOKEN';
      env[authField] = c.api_key;
    }

    // 3. default_fallback_model 优先于 model → ANTHROPIC_MODEL（两者皆空不写）
    const fallback = c.default_fallback_model ?? c.model;
    if (fallback) env.ANTHROPIC_MODEL = fallback;

    // 4. 角色映射 → ANTHROPIC_DEFAULT_{ROLE}_MODEL（仅 model 非空注入；未知角色忽略，D-011）
    // 5. one_m=true → 模型名追加 [1m] 后缀（X-12 官方文档实测确认触发 1M 上下文）
    for (const [role, m] of Object.entries(c.model_role_mappings ?? {})) {
      const envName = ClaudeCredentialInjector.ROLE_ENV[role];
      const model = m?.model;
      if (envName && model) {
        env[envName] = m.one_m ? `${model}[1m]` : model;
      }
    }

    // 6. extra_env → Object.assign（可覆盖角色 env，design §7 Object.assign 顺序）
    Object.assign(env, c.extra_env ?? {});

    // 7. settings_config.env → Object.assign（最后，覆盖优先级最高，D-007 / task-05）
    //    仅 env 子键在 toEnv 处理；attribution/enabledPlugins/model/skipDangerousModePermissionPrompt
    //    顶层键归 task-06（settings.json 生成处）。api_key 永不从 settings_config 取（安全）。
    Object.assign(env, c.settings_config?.env ?? {});

    return env;
  }
}

/**
 * 注入器注册表（agent_kind → injector 单例）。
 *
 * 第一版只认 claude；未知 agentKind 返回 undefined（task-09 buildSpawnEnv 第 0 层
 * 据此判跳过，零回归 D-007）。
 *
 * 加 codex 时：新增 CodexCredentialInjector（toEnv → OPENAI_API_KEY 等）+ 在此登记，
 * 后端表 / lease 协议 / spawn-env 不变（D-006 抽象边界）。
 */
const REGISTRY: Readonly<Record<string, CredentialInjector>> = Object.freeze({
  claude: new ClaudeCredentialInjector(),
});

/**
 * 按 agent_kind 取注入器实例。
 *
 * @param agentKind ProviderConfig.agent_kind（如 'claude'）
 * @returns 已注册的 injector 实例；未知 agentKind / undefined / 空串返回 undefined
 *   （不抛异常，task-09 buildSpawnEnv 第 0 层据此跳过，零回归 D-007）。
 */
export function getInjector(
  agentKind: string | undefined,
): CredentialInjector | undefined {
  if (!agentKind) return undefined;
  return REGISTRY[agentKind];
}
