/**
 * codex-settings —— 写 per-session `CODEX_HOME/{auth.json, config.toml}`。
 *
 * change 2026-09-10-multi-provider-injection task-01（FR-01 / D-003 / D-005 / D-011 / D-012）。
 * change 2026-09-11-session-provider-switch-codex-pi task-02：新增宿主凭证镜像
 * mirrorCodexHostAuth（null 切换镜像，FR-02）与 thread 历史迁移
 * migrateCodexThreadFromHost（宿主起步会话首次切平台供应商时迁 rollout，
 * FR-05 / R-01）——两 helper 对宿主 ~/.codex 只读拷贝、删除/写入动作只发生在
 * 平台 per-session 目录内，IO 失败一律日志收口绝不抛（失败兜底由调用方
 * ForReload 返回值矩阵承接）。
 *
 * 背景（design + spike 实测事实，golden = spike/a2b-config.toml + a2-auth.json）：
 *   - codex 0.147.0 无 base_url env 注入面（spike A1：二进制无 OPENAI_BASE_URL），
 *     端点重定向只能走 config.toml `[model_providers.<id>].base_url`（D-003 → D-005
 *     载体 = 会话隔离目录写文件）；
 *   - `wire_api = "chat"` 已被 0.147.0 移除（spike A2 附：`Error loading config.toml:
 *     wire_api = "chat" is no longer supported`），自定义 provider 唯一合法值
 *     responses——写死为常量并注明 CLI 版本基线（R-03：升级漂移由 task-07 冒烟暴露）；
 *   - 自定义 provider 不强制 key（spike A3a：无 key 请求照发、Authorization 空）。
 *
 * per-form 映射（唯一事实源 = design 接口定义 / Grill B-3，对齐 credential-injector
 * openai_chat 分支先例 credential-injector.ts:152-163）：
 *   anthropic 直连（api_format 缺省 / 'anthropic'）：
 *     auth key = provider.api_key
 *     base_url = provider.base_url
 *     model    = provider.default_fallback_model ?? provider.model（裸 id）
 *   openai_chat（api_format = 'openai_chat'，经 litellm_proxy 通道，D-006）：
 *     auth key = daemonApiKey（master key 不出 backend 铁律——daemon 进程级 apiKey 由
 *                调用方注入，纯函数承接，对齐 setDaemonApiKey 进程级事实）
 *     base_url = provider.litellm_base_url（hub 代理地址）
 *     model    = provider.litellm_model_name（usr-<uid>-<pid>，LiteLLM 路由键）
 *   注意（D-012）：openai_chat 形态 payload 刻意不含 api_key 也无 base_url——该形态
 *   判据不得引用 anthropic 分支字段名。
 *
 * 产物形状（与 spike golden 逐字段一致）：
 *   auth.json:  {"OPENAI_API_KEY": <per-form key>}——先读后写保留未知兄弟键；
 *               key 缺省时整个文件不写（spike A3a keyless 自定义 provider 合法）。
 *   config.toml:
 *     model = <per-form model>        （缺省不写该行，codex 用默认模型）
 *     model_provider = "sillyhub"
 *     [model_providers.sillyhub]
 *     name = "SillyHub"
 *     base_url = <per-form base_url>  （缺省不写该行）
 *     wire_api = "responses"          （唯一合法值，0.147.0 基线）
 *
 * 保守合并（托管段差量替换、非托管行原样保留——ai-toolbox managed-config 模式）：
 *   - 托管段 = 顶层 model / model_provider（含根区 `model_providers = {...}` 内联表行，
 *     防与写出的 [model_providers.sillyhub] 表定义冲突）+ `[model_providers.sillyhub]`
 *     表（含其子表与段内尾随空行/注释）；
 *   - 非托管内容（[projects.xxx]、兄弟 provider 表、顶层未知键、注释）逐行保留；
 *     段间空行规整为单个空行（TOML 根区键必须先于任何表头，托管根键统一重排在
 *     首个表头之前，产出恒为合法 TOML）；
 *   - 手写极小 TOML 序列化（daemon 无 TOML 库且 package.json 不在授权路径、不新增
 *     依赖），仅覆盖本写盘器产出的字符串标量 + 最小完备转义（反斜杠/双引号/控制
 *     字符）。
 *
 * 门槛与失败语义（D-012 + design Plan 约束 3）：
 *   - provider_config 整体缺省（null/undefined）→ 不写不抛（lease absent 边界，
 *     与现状逐字一致——未配置供应商时调用方不注入 CODEX_HOME，codex 按宿主
 *     ~/.codex 现状运行）；
 *   - per-form 必需字段缺失（anthropic：api_key/base_url 至少一项；openai_chat：
 *     litellm_base_url/litellm_model_name 至少一项）→ 记 warn 跳过写盘、正常返回
 *     不抛（可诊断不静默；reject 语义仅保留给写 IO 失败）；
 *   - 写 IO 失败 → 记 error 后 throw（reject）；调用方（task-03）捕获后跳过
 *     CODEX_HOME env 注入仍 spawn（失败语义唯一化：半写目录被 CLI 读到 ≠ 按宿主
 *     现状运行）；
 *   - 目录不自建：codexHome 由调用方 spawn 前创建（design 接口注释），目录缺失走
 *     IO 失败路径（ENOENT → error + reject）。
 *
 * 安全：api_key / daemonApiKey 明文只进文件不进任何日志（task constraints）。
 *
 * @module codex-settings
 */

import { copyFile, mkdir, open, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import type { ProviderConfig } from './types.js';

/** 写盘器入参（design 接口定义；风格对齐 claude-settings.ts 纯函数 + 显式路径入参）。 */
export interface CodexHomeWriteInput {
  /** per-session 隔离目录（调用方 spawn 前创建、随会话清理；本写盘器不自建）。 */
  codexHome: string;
  /**
   * lease 下发 provider_config。整体缺省（null/undefined）= 未配置 codex 供应商
   * （D-012 absent 边界）→ 不写不抛。design 原型为 `provider: ProviderConfig`，
   * 此处放宽为可空以承接调用方直传 `ctx.provider_config`（对齐 claude-settings
   * 先例的 absent 语义）。
   */
  provider: ProviderConfig | null | undefined;
  /** daemon 进程级 apiKey（进程启动时注入）；openai_chat 形态作 auth key。 */
  daemonApiKey: string | null;
}

/** auth.json 文件名（codex 读 `$CODEX_HOME/auth.json`）。 */
const AUTH_FILENAME = 'auth.json';
/** config.toml 文件名（codex 读 `$CODEX_HOME/config.toml`）。 */
const CONFIG_FILENAME = 'config.toml';
/** 托管 provider 表键名（顶层 model_provider 与 [model_providers.<key>] 一致，golden 同形）。 */
const PROVIDER_TABLE_KEY = 'sillyhub';
/** 托管 provider 表 display name（仅展示用途，不影响路由）。 */
const PROVIDER_DISPLAY_NAME = 'SillyHub';
/**
 * wire_api 固定值。codex CLI 0.147.0 已移除 "chat"（spike A2 附实测），自定义
 * provider 唯一合法值为 "responses"——升级 CLI 若恢复 chat 也不自动启用（R-03：
 * 格式漂移由 task-07 冒烟暴露，此处为显式事实源）。
 */
const WIRE_API = 'responses';

/**
 * per-form 映射解析结果（纯数据，无 IO）。
 * key/baseUrl/model 为 undefined 表示该值缺省——auth.json 整文件不写 / 对应行不写。
 */
interface CodexFormValues {
  key: string | undefined;
  baseUrl: string | undefined;
  model: string | undefined;
  /** per-form 必需字段是否满足（D-012 门槛：必需字段「至少一项」非「全部」）。 */
  sufficient: boolean;
  /** 门槛不满足时缺失的 per-form 必需字段名（仅字段名，不含值，日志安全）。 */
  missingFields: string[];
}

/** 空串 / null / undefined 一律视为未设置（对齐 types.ts 空串=未配置语义）。 */
function nonEmpty(v: string | null | undefined): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * 解析 per-form 映射（唯一事实源 = design 接口定义，见模块头注释表）。
 * 缺省 / 'anthropic' → anthropic 分支；'openai_chat' → litellm 分支（判据分支与
 * credential-injector.ts:152 同构）。
 */
function resolveCodexForm(
  provider: ProviderConfig,
  daemonApiKey: string | null,
): CodexFormValues {
  if (provider.api_format === 'openai_chat') {
    const baseUrl = nonEmpty(provider.litellm_base_url);
    const model = nonEmpty(provider.litellm_model_name);
    return {
      key: nonEmpty(daemonApiKey),
      baseUrl,
      model,
      sufficient: baseUrl !== undefined || model !== undefined,
      missingFields:
        baseUrl === undefined && model === undefined
          ? ['litellm_base_url', 'litellm_model_name']
          : [],
    };
  }
  const key = nonEmpty(provider.api_key);
  const baseUrl = nonEmpty(provider.base_url);
  const model =
    nonEmpty(provider.default_fallback_model) ?? nonEmpty(provider.model);
  return {
    key,
    baseUrl,
    model,
    sufficient: key !== undefined || baseUrl !== undefined,
    missingFields:
      key === undefined && baseUrl === undefined ? ['api_key', 'base_url'] : [],
  };
}

/**
 * TOML 基本字符串序列化（最小完备转义）。
 * 覆盖 TOML spec basic string 必须转义的全集：反斜杠、双引号、控制字符
 * （\b \t \n \f \r + 其余 \u00XX）。本写盘器只产出字符串标量，无需
 * 整数/布尔/多行/字面量字符串等更全的序列化能力。
 */
function tomlString(v: string): string {
  const escaped = v
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\u0000-\u001f]/g, (c) => {
      switch (c) {
        case '\b':
          return '\\b';
        case '\t':
          return '\\t';
        case '\n':
          return '\\n';
        case '\f':
          return '\\f';
        case '\r':
          return '\\r';
        default: {
          const hex = c.charCodeAt(0).toString(16).padStart(4, '0');
          return `\\u${hex}`;
        }
      }
    });
  return `"${escaped}"`;
}

/**
 * 解析 TOML 表头行（`[a.b]` / `[[a]]`），返回点分路径（段内引号剥除）。
 * 非表头行返回 null。段名含引号内点号的极端形态不识别（超出本合并器
 * 最小范围，托管段键名 sillyhub 不含点号）。
 */
function parseHeaderPath(line: string): string[] | null {
  const m = /^\s*\[+([^\]]+)\]+/.exec(line);
  if (!m) return null;
  const raw = m[1];
  if (raw === undefined) return null;
  return raw.split('.').map((p) => p.trim().replace(/^"(.*)"$/, '$1'));
}

/** 根区（首个表头之前）托管键：model / model_provider / model_providers 内联表。 */
const ROOT_MANAGED_KEYS = new Set(['model', 'model_provider', 'model_providers']);

/** 解析根区赋值行的键名（裸键或引号键）；非赋值行（注释/空行）返回 null。 */
function parseRootKey(line: string): string | null {
  const m = /^\s*(?:"([^"]+)"|([A-Za-z0-9_-]+))\s*=/.exec(line);
  const k = m?.[1] ?? m?.[2];
  return k ?? null;
}

/** 路径是否落在托管命名空间 `[model_providers.sillyhub]`（含其子表）下。 */
function isManagedSillyhubSection(path: string[]): boolean {
  return (
    path.length >= 2 &&
    path[0] === 'model_providers' &&
    path[1] === PROVIDER_TABLE_KEY
  );
}

/**
 * 保守合并：existing config.toml 内容 + 托管段 → 新文件全文（纯函数，无 IO）。
 *
 * 规则（见模块头「保守合并」）：托管段（根区 model/model_provider/model_providers
 * 行 + [model_providers.sillyhub] 段）丢弃重写；其余行原样保留；块间以单个空行
 * 拼装，结尾单个换行。existing 为空串等价于全新写。
 */
function mergeConfigToml(existing: string, v: CodexFormValues): string {
  const lines = existing.split(/\r?\n/);
  // split 尾部空行是分隔产物，由下方块拼装统一重建。
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();

  const rootKept: string[] = [];
  const tailKept: string[] = [];
  let inManagedSection = false;
  for (const line of lines) {
    const path = parseHeaderPath(line);
    if (path !== null) {
      inManagedSection = isManagedSillyhubSection(path);
      if (!inManagedSection) tailKept.push(line);
      continue;
    }
    if (inManagedSection) continue; // 托管段内（含尾随空行/注释）整段丢弃
    if (tailKept.length === 0) {
      // 根区：仅丢托管键行，注释/空行/未知键保留。
      const k = parseRootKey(line);
      if (k === null || !ROOT_MANAGED_KEYS.has(k)) rootKept.push(line);
    } else {
      tailKept.push(line);
    }
  }
  // 块尾空行规整（块间由拼装统一给单个空行）。
  while (rootKept.length > 0 && rootKept[rootKept.length - 1]?.trim() === '') {
    rootKept.pop();
  }
  while (tailKept.length > 0 && tailKept[tailKept.length - 1]?.trim() === '') {
    tailKept.pop();
  }

  const managedRoot: string[] = [];
  if (v.model !== undefined) managedRoot.push(`model = ${tomlString(v.model)}`);
  managedRoot.push(`model_provider = ${tomlString(PROVIDER_TABLE_KEY)}`);

  const managedSection: string[] = [
    `[model_providers.${PROVIDER_TABLE_KEY}]`,
    `name = ${tomlString(PROVIDER_DISPLAY_NAME)}`,
  ];
  if (v.baseUrl !== undefined) {
    managedSection.push(`base_url = ${tomlString(v.baseUrl)}`);
  }
  managedSection.push(`wire_api = ${tomlString(WIRE_API)}`);

  const blocks = [rootKept, managedRoot, managedSection, tailKept].filter(
    (b) => b.length > 0,
  );
  return `${blocks.map((b) => b.join('\n')).join('\n\n')}\n`;
}

/**
 * 读文件文本；不存在（ENOENT）或读失败（EACCES 等）返回 ''。
 * 读失败时无法做保守合并——目标为 per-session 托管目录（非宿主配置），记 warn
 * 后按空文件重建（无宿主数据损失面）。
 */
async function readTextIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      console.warn('codex_settings_read_failed', { path, code });
    }
    return '';
  }
}

/**
 * 写 auth.json：先读后写保留未知兄弟键，顶层 OPENAI_API_KEY = key。
 * 既有文件非法 JSON / 非对象形状 → warn 后整体重建（per-session 托管目录语义）。
 */
async function writeAuthJson(dir: string, key: string): Promise<void> {
  const authPath = join(dir, AUTH_FILENAME);
  let obj: Record<string, unknown> = {};
  const raw = await readTextIfExists(authPath);
  if (raw !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>;
      } else {
        console.warn('codex_settings_auth_unexpected_shape', { path: authPath });
      }
    } catch {
      console.warn('codex_settings_auth_parse_failed', { path: authPath });
    }
  }
  obj.OPENAI_API_KEY = key;
  await writeFile(authPath, JSON.stringify(obj, null, 2), 'utf-8');
}

/**
 * 把 lease 供应商凭证写进 per-session CODEX_HOME 两文件（auth.json + config.toml）。
 *
 * 行为（门槛与失败语义详见模块头）：
 *   1. provider 缺省 → 直接 return（absent 边界，不写不抛）；
 *   2. per-form 必需字段缺失 → console.warn 后 return（零文件写入）；
 *   3. key 有值先写 auth.json，再保守合并写 config.toml；
 *   4. 任一 IO 失败 → console.error 后 throw（reject），交调用方跳过 CODEX_HOME
 *      env 注入仍 spawn。
 *
 * 日志安全：warn/error 载荷只含路径 / 字段名 / api_format / 错误 message，
 * 永不含 api_key / daemonApiKey 明文。
 */
export async function writeCodexHome(input: CodexHomeWriteInput): Promise<void> {
  const { codexHome, provider, daemonApiKey } = input;

  // D-012 absent 边界：provider_config 整体缺省 → 不写不抛（与现状逐字一致）。
  if (!provider) return;

  const values = resolveCodexForm(provider, daemonApiKey);
  if (!values.sufficient) {
    // 可诊断不静默：warn 载荷含 api_format 与缺失字段名列表（无值）。
    // 不抛——reject 语义仅保留给写 IO 失败（task-01 acceptance 两分法）。
    console.warn('codex_home_write_skipped_missing_fields', {
      codexHome,
      api_format: provider.api_format ?? 'anthropic',
      missing: values.missingFields,
    });
    return;
  }

  try {
    // key 缺省不写 auth.json（spike A3a：keyless 自定义 provider 合法，请求无 Authorization）。
    if (values.key !== undefined) {
      await writeAuthJson(codexHome, values.key);
    }
    const configPath = join(codexHome, CONFIG_FILENAME);
    const existing = await readTextIfExists(configPath);
    await writeFile(configPath, mergeConfigToml(existing, values), 'utf-8');
  } catch (e) {
    console.error('codex_home_write_failed', {
      codexHome,
      error: (e as Error)?.message ?? String(e),
    });
    throw e;
  }
}

// ── 宿主镜像 / thread 迁移（2026-09-11-session-provider-switch-codex-pi task-02）──

/** 宿主 codex 配置根（~/.codex；os.homedir() 读 USERPROFILE，Windows 行为一致）。 */
function hostCodexHome(): string {
  return join(homedir(), '.codex');
}

/** 统一错误 message 提取（日志安全：只进 message，不进文件内容/凭证）。 */
function errMessage(e: unknown): string {
  return (e as Error)?.message ?? String(e);
}

/**
 * null 切换镜像（FR-02 / D-001）：把宿主 `~/.codex/{auth.json, config.toml}`
 * 的登录态如实反映进 per-session codexHome——
 *   - 宿主文件存在 → 拷入覆盖（平台供应商产物被宿主登录态替换）；
 *   - 宿主文件不存在 → 删除 codexHome 同名文件（宿主未登录 = 镜像后同样未登录，
 *     残留平台供应商 auth.json 会顶掉「回本机」语义）。
 *
 * 逐文件独立 best-effort：单文件 IO 失败 console.error 后继续另一文件，**绝不
 * 抛**（调用方 ForReload 分支四无论镜像成败都返回 prior CODEX_HOME——失败 =
 * 目录里旧供应商凭证仍在 = 等同未切，thread 历史保住）。
 *
 * 宿主侧只读（copyFile 单向），删除/写入动作只发生在平台 per-session 目录内。
 * 日志载荷只含文件名 / 路径 / 错误 message，不含凭证内容。
 */
export async function mirrorCodexHostAuth(codexHome: string): Promise<void> {
  const hostHome = hostCodexHome();
  // 拷入分支前置建目录（restore 探测路径 / 镜像目标尚未建的防御；rm 分支无需）。
  try {
    await mkdir(codexHome, { recursive: true });
  } catch (e) {
    console.error('codex_host_mirror_mkdir_failed', {
      codexHome,
      error: errMessage(e),
    });
  }
  for (const filename of [AUTH_FILENAME, CONFIG_FILENAME]) {
    const src = join(hostHome, filename);
    const dest = join(codexHome, filename);
    try {
      await copyFile(src, dest);
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
        // 宿主无该文件：删 per-session 同名文件（force 容忍本就不存在）。
        try {
          await rm(dest, { force: true });
        } catch (e2) {
          console.error('codex_host_mirror_delete_failed', {
            file: filename,
            codexHome,
            error: errMessage(e2),
          });
        }
      } else {
        console.error('codex_host_mirror_copy_failed', {
          file: filename,
          codexHome,
          error: errMessage(e),
        });
      }
    }
  }
}

/**
 * 单文件首行读取上限：宿主 rollout 首行为 session_meta（含 base_instructions
 * 全文，本机实测 13-22KB），1MB 上限留足余量；超限无换行按整行处理（JSON.parse
 * 失败即跳过该候选）。不全文件读取——控制宿主大目录扫描成本（R-01）。
 */
const ROLLOUT_FIRST_LINE_MAX_BYTES = 1024 * 1024;
/** 首行分块读取粒度（64KB 一次读齐典型首行，避免逐字节 sysctl 开销）。 */
const ROLLOUT_FIRST_LINE_CHUNK_BYTES = 64 * 1024;

/**
 * 只读文件首行（遇首个 `\n` 截断；EOF/超上限仍无换行则返回已读全文）。
 * 不抛——打开/读取失败交调用方逐文件 try/catch 收口。
 */
async function readFirstLine(path: string): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    while (total < ROLLOUT_FIRST_LINE_MAX_BYTES) {
      const buf = Buffer.alloc(
        Math.min(ROLLOUT_FIRST_LINE_CHUNK_BYTES, ROLLOUT_FIRST_LINE_MAX_BYTES - total),
      );
      const { bytesRead } = await handle.read(buf, 0, buf.length, total);
      if (bytesRead === 0) break; // EOF
      const view = buf.subarray(0, bytesRead);
      const nl = view.indexOf(0x0a);
      if (nl >= 0) {
        chunks.push(view.subarray(0, nl));
        return Buffer.concat(chunks).toString('utf-8');
      }
      chunks.push(view);
      total += bytesRead;
    }
    return Buffer.concat(chunks).toString('utf-8');
  } finally {
    await handle.close();
  }
}

/**
 * 从 rollout 首行解析会话 id：`payload.session_id` 优先（TaskCard fixture 锚），
 * 兼容 `session_meta.id`——本机实际 rollout 首行为
 * `{"type":"session_meta","payload":{"id":"<uuid>",...}}`（codex 0.121.0+ 实测，
 * 「以实际 rollout 首行为准」），故兼容读 payload.id 与顶层 id 双形态。
 */
function extractRolloutSessionId(lineObj: unknown): string | undefined {
  if (lineObj === null || typeof lineObj !== 'object') return undefined;
  const payload = (lineObj as { payload?: unknown }).payload;
  if (payload !== null && typeof payload === 'object') {
    const p = payload as { session_id?: unknown; id?: unknown };
    if (typeof p.session_id === 'string' && p.session_id.length > 0) return p.session_id;
    if (typeof p.id === 'string' && p.id.length > 0) return p.id;
  }
  const topId = (lineObj as { id?: unknown }).id;
  return typeof topId === 'string' && topId.length > 0 ? topId : undefined;
}

/** 递归收集 dir 下全部 .jsonl 文件（相对路径随收集保留）；子目录不可读静默跳过。 */
async function collectJsonlFiles(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // 宿主目录缺/无权限：跳过（只读宿主，不阻断）
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectJsonlFiles(full, out); // 符号链接不入 isDirectory，天然防环
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
}

/**
 * thread 历史迁移（FR-05 / R-01，对齐 claude migrateClaudeTranscriptToIsolated
 * 降级语义）：递归扫描宿主 `~/.codex/sessions` 下 .jsonl rollout，仅读**首行**
 * 解析会话 id（见 extractRolloutSessionId）匹配 threadId，命中文件按 sessions/
 * 下相对路径拷入 `$codexHome/sessions/`（宿主日期分层结构原样保留）。
 *
 * 返回是否迁到 ≥1 个文件。宿主目录不存在 / 无命中 → console.warn 返 false
 * （reload 不阻断；不迁则新 CODEX_HOME 下 resume 找不到 thread 由 codex 真实
 * 报错收敛，对齐 R-01）。**绝不抛**：逐文件 IO 失败 console.error 后继续。
 *
 * 宿主文件只读不删（copyFile 单向）；写入只发生在平台 per-session 目录内。
 */
export async function migrateCodexThreadFromHost(
  threadId: string,
  codexHome: string,
): Promise<boolean> {
  const hostSessionsDir = join(hostCodexHome(), 'sessions');
  const candidates: string[] = [];
  await collectJsonlFiles(hostSessionsDir, candidates);
  if (candidates.length === 0) {
    // 宿主目录缺 / 空：宿主起步前提不成立（或宿主从未跑过 codex 会话）。
    console.warn('codex_thread_migrate_no_match', {
      thread_id: threadId,
      host_sessions_dir: hostSessionsDir,
      scanned: 0,
    });
    return false;
  }
  let migrated = 0;
  for (const src of candidates) {
    try {
      const firstLine = await readFirstLine(src);
      let lineObj: unknown;
      try {
        lineObj = JSON.parse(firstLine);
      } catch {
        continue; // 首行非 JSON / 超限截断：非 rollout 常规形态，跳过
      }
      if (extractRolloutSessionId(lineObj) !== threadId) continue;
      // 命中：按 sessions/ 下相对路径拷入（宿主 YYYY/MM/DD 分层原样保留）。
      const dest = join(codexHome, 'sessions', relative(hostSessionsDir, src));
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(src, dest);
      migrated += 1;
    } catch (e) {
      console.error('codex_thread_migrate_file_failed', {
        path: src,
        error: errMessage(e),
      });
    }
  }
  if (migrated === 0) {
    console.warn('codex_thread_migrate_no_match', {
      thread_id: threadId,
      host_sessions_dir: hostSessionsDir,
      scanned: candidates.length,
    });
    return false;
  }
  return true;
}

/**
 * codex 写盘门槛判定（2026-09-11-provider-adapter-registry task-02 自
 * provider-file-settings.ts 迁入——与 writeCodexHome 同文件更内聚，且打断
 * providers.ts ↔ provider-file-settings.ts import 环；聚合表 codex writer 的
 * isSufficient 与 spawn/reload 分派共用本判据）：
 *   openai_chat：litellm_base_url / litellm_model_name 至少一项；
 *   anthropic（缺省）：api_key / base_url 至少一项。
 */
export function isCodexFormSufficient(provider: ProviderConfig): boolean {
  if (provider.api_format === 'openai_chat') {
    return (
      nonEmpty(provider.litellm_base_url) !== undefined ||
      nonEmpty(provider.litellm_model_name) !== undefined
    );
  }
  return (
    nonEmpty(provider.api_key) !== undefined ||
    nonEmpty(provider.base_url) !== undefined
  );
}
