/**
 * zcode-settings —— 写 per-session `<ZCODE_DATA_BASE_DIR>/.zcode/v2/provider_config.json`。
 *
 * 2026-10-15-zcode-engine-appserver task-05（D-002 / D-003）。风格对齐 codex-settings /
 * pi-settings（纯函数 + 显式路径入参；写盘器不自建根目录，调用方 spawn 前创建）。
 *
 * 背景（2026-10-15 实测钉板，decisions.md D-003 evidence）：
 *   - ZCODE_DATA_BASE_DIR 重定向 ZCode 配置面根（实测：value=T 时引擎读 T/.zcode/v2/
 *     下 provider_config.json / credentials.json / setting.json 等）；
 *   - 个人 Provider 体系形状（本机实证实例）：{schemaVersion:1, config:{providerOrder,
 *     providerConfigRules:[{providerId, providerName, config:{group, access:{type:'api-key',
 *     apiKey}, api:{type:'anthropic-messages'|'openai-chat-completions', baseUrl},
 *     personalModelIds, modelOrder}}]}}——注入该文件后模型轮真实跑在注入 Provider 上（实测）；
 *   - 会话数据库（~/.zcode/cli/db）不受 ZCODE_DATA_BASE_DIR 重定向（机器级共享，D-002
 *     接受），本写盘器只负责配置面。
 *
 * 门槛与失败语义（对齐 codex/pi 写盘器定式——失败语义唯一化，宁可不写不写坏形状）：
 *   - 所需字段（有效 baseUrl / 有效密钥 / 裸 model id）缺任一 → 记 warn 跳过写盘、
 *     正常返回不抛（调用方不注入 ZCODE_DATA_BASE_DIR，引擎回落机器默认配置/登录态，
 *     与 codex/pi 无配置先例一致）；
 *   - 写 IO 失败 → 记 error 后 throw（reject）；调用方捕获后跳过 env 注入仍 spawn；
 *   - `.zcode/v2` 子目录由本写盘器 mkdir（根目录由调用方建；实测引擎布局 = 根 + /.zcode/v2）。
 *
 * 安全：apiKey 明文只进文件不进任何日志（对齐 pi-settings）。
 *
 * @module zcode-settings
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { writeFileAtomic } from './atomic-write.js';
import type { ProviderConfig } from './types.js';

/** 写盘器入参（风格对齐 codex-settings / pi-settings）。 */
export interface ZcodeDirWriteInput {
  /** per-session 隔离目录（= ZCODE_DATA_BASE_DIR；调用方 spawn 前创建、随会话清理）。 */
  zcodeDir: string;
  /** lease 下发 provider_config（agent_kind='zcode'）。 */
  provider: ProviderConfig;
  /** daemon 自身 API key（openai_chat + litellm_proxy 形态的代理凭据；其余形态不消费）。 */
  daemonApiKey?: string | null;
}

/** 配置面相对路径（实测布局：ZCODE_DATA_BASE_DIR 下 `.zcode/v2/`）。 */
const CONFIG_REL_DIR = join('.zcode', 'v2');
const CONFIG_FILENAME = 'provider_config.json';

/** 托管 provider 键名（provider_config.json 内 providerId，展示名 SillyHub）。 */
export const PROVIDER_ID = 'sillyhub';
const PROVIDER_DISPLAY_NAME = 'SillyHub';

/** 空串 / null / undefined 一律视为未设置（对齐 types.ts 空串=未配置语义）。 */
function nonEmpty(v: string | null | undefined): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * 有效 baseUrl：openai_chat 形态走 LiteLLM/hub 代理地址；否则直连 base_url。
 */
function effectiveBaseUrl(provider: ProviderConfig): string | undefined {
  if (provider.api_format === 'openai_chat') {
    return nonEmpty(provider.litellm_base_url);
  }
  return nonEmpty(provider.base_url);
}

/**
 * 有效密钥：openai_chat + litellm_proxy 形态用 daemon 自身 key（hub 代理凭据）；
 * 其余形态用 provider.api_key。
 */
function effectiveApiKey(
  provider: ProviderConfig,
  daemonApiKey: string | null | undefined,
): string | undefined {
  if (provider.api_format === 'openai_chat' && provider.litellm_proxy === true) {
    return nonEmpty(daemonApiKey);
  }
  return nonEmpty(provider.api_key);
}

/**
 * 裸 model id（对齐 codex/pi 先例 / D-010 取值链）：
 * default_fallback_model ?? model ?? litellm_model_name。
 */
function effectiveModel(provider: ProviderConfig): string | undefined {
  return (
    nonEmpty(provider.default_fallback_model) ??
    nonEmpty(provider.model) ??
    nonEmpty(provider.litellm_model_name)
  );
}

/** api.type 映射：openai_chat → 'openai-chat-completions'；anthropic/缺省 → 'anthropic-messages'。 */
function zcodeApiType(provider: ProviderConfig): 'anthropic-messages' | 'openai-chat-completions' {
  return provider.api_format === 'openai_chat'
    ? 'openai-chat-completions'
    : 'anthropic-messages';
}

/**
 * 门槛判定（provider-file-settings 分派层调用，单参——对齐 codex/pi 写盘器接口）：
 * 有效 baseUrl + 裸 model id 齐备，且（非 litellm_proxy 形态时）api_key 齐备。
 * litellm_proxy 形态的密钥来自 daemon 进程注入（write 路径 daemonApiKey 入参），
 * 门槛不预判其存在（缺失时写盘抛错走分派层 error 路径）。
 */
export function isZcodeFormSufficient(provider: ProviderConfig): boolean {
  const baseUrlOk = effectiveBaseUrl(provider) !== undefined;
  const modelOk = effectiveModel(provider) !== undefined;
  const keyOk =
    provider.api_format === 'openai_chat' && provider.litellm_proxy === true
      ? true
      : nonEmpty(provider.api_key) !== undefined;
  return baseUrlOk && modelOk && keyOk;
}

/**
 * 生成 provider_config.json 内容对象（导出供单测钉形状；写入主路径见
 * writeZcodeProviderConfig）。
 *
 * @throws {Error} 所需字段缺失（调用方应先过 isZcodeFormSufficient 门槛）
 */
export function buildZcodeProviderConfig(
  input: ZcodeDirWriteInput,
): Record<string, unknown> {
  const { provider, daemonApiKey } = input;
  const baseUrl = effectiveBaseUrl(provider);
  const apiKey = effectiveApiKey(provider, daemonApiKey);
  const model = effectiveModel(provider);
  if (baseUrl === undefined || apiKey === undefined || model === undefined) {
    throw new Error(
      'zcode provider_config 所需字段缺失（baseUrl/apiKey/model 三项齐备才可写盘）',
    );
  }
  return {
    schemaVersion: 1,
    config: {
      providerOrder: [PROVIDER_ID],
      providerConfigRules: [
        {
          providerId: PROVIDER_ID,
          providerName: PROVIDER_DISPLAY_NAME,
          config: {
            group: 'standard-personal',
            access: { type: 'api-key', apiKey },
            api: { type: zcodeApiType(provider), baseUrl },
            personalModelIds: [model],
            modelOrder: [model],
          },
        },
      ],
    },
  };
}

/**
 * 写 per-session provider_config.json（含 `.zcode/v2` 子目录 mkdir）。
 *
 * @throws {Error} 字段缺失（防御性，调用方应前置门槛）或 IO 失败
 */
export async function writeZcodeProviderConfig(
  input: ZcodeDirWriteInput,
): Promise<void> {
  const content = buildZcodeProviderConfig(input);
  const configDir = join(input.zcodeDir, CONFIG_REL_DIR);
  try {
    await mkdir(configDir, { recursive: true });
    await writeFileAtomic(
      join(configDir, CONFIG_FILENAME),
      JSON.stringify(content, null, 2) + '\n',
    );
  } catch (e) {
    // 写盘器本体记 error 后抛出；调用方（provider-file-settings 分派层）捕获后
    // 跳过 ZCODE_DATA_BASE_DIR 注入仍 spawn（半写目录被 CLI 读到 ≠ 按宿主现状运行）。
    console.error('zcode_settings_write_failed', {
      dir: input.zcodeDir,
      error: (e as Error)?.message ?? String(e),
    });
    throw e;
  }
}
