/**
 * pi-settings —— 写 per-session `PI_CODING_AGENT_DIR/{auth.json, models.json, settings.json}`。
 *
 * change 2026-09-10-multi-provider-injection task-02（FR-02 / D-004 / D-005 / D-008 /
 * D-011 / R-04）。
 *
 * 背景（design 接口定义 pi 段 + spike B 实测事实，pi 0.81.1 基线）：
 *   - `PI_CODING_AGENT_DIR` 整体重定向 pi root（spike B root 重定向：模型解析、
 *     auth、settings 全从该目录读），自定义端点注入走该目录三文件（D-004 → D-005
 *     载体 = 会话隔离目录写文件）；
 *   - auth.json 官方形状 `{"<providerKey>": {"type": "api_key", "key": <value>}}`
 *     （golden = spike/b1b-auth.json；b1-auth.json 的 `{"apiKey": ...}` 投影形状
 *     实测被拒——`No API key found for the selected model.`，不采用）；
 *   - models.json providers 段 `api` 按 provider.api_format 映射（anthropic/缺省
 *     → "anthropic-messages" 打 `/v1/messages`；golden = spike/b1-models.json 的
 *     openai-completions 形态仅历史依据——ql-20260911-029 实证 anthropic 端点写
 *     openai-completions 会协议错配全断流，pi docs/models.md:123-128 合法四值）。
 *
 * 与 env 层共存语义（R-04 / spike Pi-3，分层见 D-008）：
 *   - pi 官方 key 解析优先级（官方文档 + spike）：CLI `--api-key` > auth.json >
 *     env > models.json 内联 apiKey——同会话文件层与 env 层并存时 auth.json 文件值
 *     压制 env 同键值，env 层注入的同键值仅为无害冗余，两层叠加不产生歧义路由；
 *   - 官方端点形态（provider.base_url 为空）本写盘器零写入，凭证注入完全归 env 层
 *     （并行变更产物），对 env 层零干扰。
 *
 * 产物形状（与 spike b1 系 golden 逐字段一致）：
 *   auth.json:    providers 键 "sillyhub" upsert {"type": "api_key", "key": api_key}
 *                 ——先读后写保留未知兄弟 provider 键；
 *   models.json:  providers.sillyhub = {name: "SillyHub", api: <按 api_format 映射>,
 *                 baseUrl: provider.base_url, models: [{id: <裸 model id>}]}
 *                 ——托管字段差量替换，兄弟 provider 键 / 未知顶层键 / sillyhub
 *                 条目内未知字段保留；
 *   settings.json: defaultProvider = "sillyhub"、defaultModel = <裸 model id>
 *                 ——未知键保留。
 *   裸 model id 取值（对齐 codex-settings 先例 / D-010）：
 *     provider.default_fallback_model ?? provider.model。
 *
 * 门槛与失败语义（对齐 task-01 writeCodexHome 定式——失败语义唯一化）：
 *   - api_format = 'openai_chat' → 记 warn 跳过（pi × openai_chat 禁配组合：后端
 *     Create/Update 422 校验归 task-05、前端禁选归 task-06，此处仅防御性双保险；
 *     正常流该组合不可能出现）；
 *   - provider.base_url 为空（官方端点形态）→ 零写入正常返回、不告警（env 层负责，
 *     D-008 分层——这是设计内分派而非异常）；
 *   - 必需字段缺失（api_key / 裸 model id）→ 记 warn 跳过写盘、正常返回不抛
 *     （可诊断不静默；写空 key 到 auth.json 是错误形状——pi 会把空串当字面量 key
 *     打给上游，宁可不写）。model 缺失同样跳过：defaultModel 与 models 目录是 pi
 *     侧唯一选型键，无 model 的三文件是 CLI 不可用配置，与半写目录同罪；
 *   - 写 IO 失败 → 记 error 后 throw（reject）；调用方（task-03）捕获后跳过
 *     PI_CODING_AGENT_DIR env 注入仍 spawn（半写目录被 CLI 读到 ≠ 按宿主现状
 *     运行，design Plan 约束 3 双覆盖），不静默吞错；
 *   - 目录不自建：piDir 由调用方 spawn 前创建（design 接口注释），目录缺失走
 *     IO 失败路径（ENOENT → error + reject）。
 *
 * 安全：api_key 明文只进文件不进任何日志（task constraints）。
 *
 * @module pi-settings
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProviderConfig } from './types.js';

/** 写盘器入参（design 接口定义；风格对齐 codex-settings.ts 纯函数 + 显式路径入参）。 */
export interface PiDirWriteInput {
  /** per-session 隔离目录（= PI_CODING_AGENT_DIR；调用方 spawn 前创建、随会话清理；本写盘器不自建）。 */
  piDir: string;
  /** lease 下发 provider_config（调用方已按 agent_kind='pi' 且 base_url 非空分派，design 接线段）。 */
  provider: ProviderConfig;
}

/** auth.json 文件名（pi 读 `$PI_CODING_AGENT_DIR/auth.json`）。 */
const AUTH_FILENAME = 'auth.json';
/** models.json 文件名（pi 读 `$PI_CODING_AGENT_DIR/models.json`）。 */
const MODELS_FILENAME = 'models.json';
/** settings.json 文件名（pi 读 `$PI_CODING_AGENT_DIR/settings.json`）。 */
const SETTINGS_FILENAME = 'settings.json';
/** 三文件共用的托管 provider 键名（auth/models/settings 三处一致，golden 同形）。 */
const PROVIDER_KEY = 'sillyhub';
/** models.json providers.sillyhub.name 展示名（仅展示用途，不影响路由）。 */
const PROVIDER_DISPLAY_NAME = 'SillyHub';
/**
 * models.json providers.sillyhub.api 映射（ql-20260911-029）：
 * pi 自定义供应商合法 api 四值（docs/models.md:123-128）——openai-completions /
 * openai-responses / anthropic-messages / google-generative-ai。平台 pi 供应商
 * 自定义端点形态即 anthropic 协议（DB 词表 default 'anthropic'，openai_chat 禁配
 * 已在 writePiDir 前置跳过），映射 'anthropic'/缺省 → 'anthropic-messages'；
 * 其余未知值 → undefined（调用方 warn 跳过，防半配形状写出必断流配置）。
 */
function piApiForFormat(
  apiFormat: string | null | undefined,
): string | undefined {
  if (apiFormat === 'anthropic' || apiFormat === undefined || apiFormat === null || apiFormat === '') {
    return 'anthropic-messages';
  }
  return undefined;
}

/** 空串 / null / undefined 一律视为未设置（对齐 types.ts 空串=未配置语义）。 */
function nonEmpty(v: string | null | undefined): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * 读文件文本；不存在（ENOENT）返回 ''。读失败（EACCES 等）返回 '' 并记 warn——
 * 无法做保守合并时按空文件重建（目标为 per-session 托管目录，无宿主数据损失面）。
 */
async function readTextIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      console.warn('pi_settings_read_failed', { path, code });
    }
    return '';
  }
}

/**
 * 读 JSON 文件并解析为普通对象（preserve unknown 的读侧支撑）。
 * 文件不存在 / 非法 JSON / 非对象形状 → 记 warn（不存在除外）后按 {} 重建。
 */
async function readJsonObject(
  path: string,
  fileLabel: string,
): Promise<Record<string, unknown>> {
  const raw = await readTextIfExists(path);
  if (raw === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    console.warn('pi_settings_unexpected_shape', { file: fileLabel, path });
    return {};
  } catch {
    console.warn('pi_settings_parse_failed', { file: fileLabel, path });
    return {};
  }
}

/** 值是否为普通对象（数组不算——数组 providers / 数组条目按损坏形状重建）。 */
function asObject(v: unknown): Record<string, unknown> | undefined {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

/**
 * 写 auth.json：providers 键 "sillyhub" upsert `{"type": "api_key", "key": key}`。
 * 先读后写保留未知兄弟 provider 键（官方形状，golden=spike/b1b-auth.json）。
 */
async function writeAuthJson(piDir: string, apiKey: string): Promise<void> {
  const authPath = join(piDir, AUTH_FILENAME);
  const auth = await readJsonObject(authPath, AUTH_FILENAME);
  auth[PROVIDER_KEY] = { type: 'api_key', key: apiKey };
  await writeFile(authPath, JSON.stringify(auth, null, 2), 'utf-8');
}

/**
 * 写 models.json：providers.sillyhub 托管条目差量替换
 * `{name, api, baseUrl, models: [{id}]}`，兄弟 provider 键 / 未知顶层键 /
 * sillyhub 条目内未知字段保留（golden=spike/b1-models.json）。
 */
async function writeModelsJson(
  piDir: string,
  baseUrl: string,
  modelId: string,
  api: string,
): Promise<void> {
  const modelsPath = join(piDir, MODELS_FILENAME);
  const doc = await readJsonObject(modelsPath, MODELS_FILENAME);
  const providers = asObject(doc.providers);
  if (doc.providers !== undefined && providers === undefined) {
    // 既有 providers 键非对象（损坏形状）→ warn 后重建该键。
    console.warn('pi_settings_unexpected_shape', {
      file: MODELS_FILENAME,
      path: modelsPath,
      key: 'providers',
    });
  }
  const target = providers ?? {};
  // 条目内未知字段保留、托管字段（name/api/baseUrl/models）覆盖——含旧值清除。
  const existingEntry = asObject(target[PROVIDER_KEY]);
  if (target[PROVIDER_KEY] !== undefined && existingEntry === undefined) {
    console.warn('pi_settings_unexpected_shape', {
      file: MODELS_FILENAME,
      path: modelsPath,
      key: `providers.${PROVIDER_KEY}`,
    });
  }
  target[PROVIDER_KEY] = {
    ...(existingEntry ?? {}),
    name: PROVIDER_DISPLAY_NAME,
    api,
    baseUrl,
    models: [{ id: modelId }],
  };
  doc.providers = target;
  await writeFile(modelsPath, JSON.stringify(doc, null, 2), 'utf-8');
}

/**
 * 写 settings.json：defaultProvider = "sillyhub"、defaultModel = 裸 model id，
 * 未知键保留（golden=spike/b1-settings.json）。
 */
async function writeSettingsJson(piDir: string, modelId: string): Promise<void> {
  const settingsPath = join(piDir, SETTINGS_FILENAME);
  const settings = await readJsonObject(settingsPath, SETTINGS_FILENAME);
  settings.defaultProvider = PROVIDER_KEY;
  settings.defaultModel = modelId;
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

/**
 * 把 lease 供应商凭证写进 per-session PI_CODING_AGENT_DIR 三文件
 * （auth.json + models.json + settings.json）。
 *
 * 行为（门槛与失败语义详见模块头）：
 *   1. api_format='openai_chat'（禁配组合防御）→ console.warn 后 return（零写入）；
 *   2. base_url 为空（官方端点形态）→ 静默 return（零写入，env 层负责，D-008）；
 *   3. api_key / 裸 model id 缺失 → console.warn 后 return（零文件写入，不写空 key）；
 *   4. 三文件依序先读后写（preserve unknown）；
 *   5. 任一写 IO 失败 → console.error 后 throw（reject），交调用方跳过
 *      PI_CODING_AGENT_DIR env 注入仍 spawn。
 *
 * 日志安全：warn/error 载荷只含路径 / 字段名 / api_format / 错误 message，
 * 永不含 api_key 明文。
 */
export async function writePiDir(input: PiDirWriteInput): Promise<void> {
  const { piDir, provider } = input;

  // 禁配组合防御性双保险（后端 422 归 task-05 / 前端禁选归 task-06）。
  if (provider.api_format === 'openai_chat') {
    console.warn('pi_dir_write_skipped_openai_chat', { piDir });
    return;
  }

  // 官方端点形态：零写入正常返回（env 层负责，D-008 分层，非异常不告警）。
  const baseUrl = nonEmpty(provider.base_url);
  if (baseUrl === undefined) return;

  // api_format → pi api 映射（ql-20260911-029）：未知格式 warn 跳过——写错协议
  // 的 models.json 会让 pi 拿错误 SDK 打端点全断流（线上实证），宁可不写。
  const api = piApiForFormat(provider.api_format);
  if (api === undefined) {
    console.warn('pi_dir_write_skipped_unknown_api_format', {
      piDir,
      api_format: provider.api_format ?? '',
    });
    return;
  }

  // 必需字段校验：api_key 不写空值（空串 key 会被 pi 当字面量打给上游）；
  // 裸 model id 缺失同样跳过（defaultModel/models 目录是 pi 侧唯一选型键）。
  const apiKey = nonEmpty(provider.api_key);
  const modelId =
    nonEmpty(provider.default_fallback_model) ?? nonEmpty(provider.model);
  if (apiKey === undefined || modelId === undefined) {
    // 可诊断不静默：warn 载荷含缺失字段名列表（无值）；不抛——reject 语义仅保留给
    // 写 IO 失败（task-01 定式两分法）。
    const missing: string[] = [];
    if (apiKey === undefined) missing.push('api_key');
    if (modelId === undefined) missing.push('model');
    console.warn('pi_dir_write_skipped_missing_fields', { piDir, missing });
    return;
  }

  try {
    await writeAuthJson(piDir, apiKey);
    await writeModelsJson(piDir, baseUrl, modelId, api);
    await writeSettingsJson(piDir, modelId);
  } catch (e) {
    console.error('pi_dir_write_failed', {
      piDir,
      error: (e as Error)?.message ?? String(e),
    });
    throw e;
  }
}
