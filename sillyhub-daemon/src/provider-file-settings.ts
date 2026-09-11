/**
 * provider 文件层分派共享模块。
 *
 * 2026-09-11-session-provider-switch-codex-pi task-01：本模块自 task-runner.ts
 * （原 :160-305 段）逐字平移——纯移动，行为零变化（函数体/注释/日志标签一字
 * 未改）；原模块私有的三个伴生判定（nonEmptyStr / isCodexFormSufficient /
 * isPiFormSufficient）平移后升为导出（供后续 ForReload 变体复用）。
 * 消费方：daemon.ts（interactive 接线）与 task-runner.ts（batch 接线）。
 * task-02：新增 reload 专用变体 applyProviderFileSettingsForReload（失败兜底
 * 语义完全内聚在返回值矩阵，R-05 落地点）——spawn 版分派零改动、并行导出。
 *
 * @module provider-file-settings
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { daemonStateDir } from './config.js';
import { mirrorCodexHostAuth, writeCodexHome } from './codex-settings.js';
import { writePiDir } from './pi-settings.js';
import type { ProviderConfig } from './types.js';

// ── provider 文件层分派（task-03 / 2026-09-10-multi-provider-injection）──────────

/** 空串 / null / undefined 一律视为未设置（对齐 codex/pi-settings 同名判式）。 */
export function nonEmptyStr(v: string | null | undefined): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * codex 写盘门槛判定（与 codex-settings.ts resolveCodexForm 的 sufficient 判据
 * 同步内联——task-03 allowed_paths 不含 codex-settings.ts，无法导出共享 helper；
 * **判据变更须两处同步**）：
 *   openai_chat：litellm_base_url / litellm_model_name 至少一项；
 *   anthropic（缺省）：api_key / base_url 至少一项。
 */
export function isCodexFormSufficient(provider: ProviderConfig): boolean {
  if (provider.api_format === 'openai_chat') {
    return (
      nonEmptyStr(provider.litellm_base_url) !== undefined ||
      nonEmptyStr(provider.litellm_model_name) !== undefined
    );
  }
  return (
    nonEmptyStr(provider.api_key) !== undefined ||
    nonEmptyStr(provider.base_url) !== undefined
  );
}

/**
 * pi 写盘门槛判定（与 pi-settings.ts writePiDir 内部 gate 同步内联——同上，
 * **判据变更须两处同步**）：非 openai_chat 禁配形态 + base_url 非空（自定义端点，
 * 官方端点归 env 层 D-008）+ api_key 非空 + 裸 model id（default_fallback_model ??
 * model）非空。不足则零 mkdir 零 env（半写/空目录被 pi 读到 ≠ 按宿主现状运行，
 * design Plan 约束 3 同源理由）。
 */
export function isPiFormSufficient(provider: ProviderConfig): boolean {
  return (
    provider.api_format !== 'openai_chat' &&
    nonEmptyStr(provider.base_url) !== undefined &&
    nonEmptyStr(provider.api_key) !== undefined &&
    (nonEmptyStr(provider.default_fallback_model) ?? nonEmptyStr(provider.model)) !==
      undefined
  );
}

/** applyProviderFileSettings 入参（design 接线段；两接线点同构调用）。 */
export interface ProviderFileSettingsInput {
  /**
   * per-session 目录段（D-011）：interactive = agent_sessions.id、
   * batch = leaseId（batch 无会话 id，lease 是唯一稳定执行粒度）。
   */
  sessionKey: string;
  /** lease 下发 provider_config；整体缺省（D-012 absent 边界）→ 不写不注入。 */
  provider: ProviderConfig | null | undefined;
  /** daemon 进程自身 apiKey（config.api_key，cli.ts setDaemonApiKey 同源）；codex openai_chat 形态作 auth key。 */
  daemonApiKey: string | null;
}

/**
 * 按 provider.agent_kind 分派配置写盘层 + 产待注入 env（task-03 单点定义，
 * daemon.ts interactive / task-runner.ts batch 两接线点共用）：
 *
 *   - codex：门槛前置判定（isCodexFormSufficient，与 writeCodexHome 同判据）通过
 *     → mkdir per-session 目录 → writeCodexHome（auth.json + config.toml）→
 *     返回 `{CODEX_HOME: <dir>}`；门槛缺 → warn 跳过（零 mkdir 零写入零 env）；
 *   - pi：base_url 非空（自定义端点）且必需字段齐（isPiFormSufficient）→
 *     mkdir → writePiDir（三文件）→ 返回 `{PI_CODING_AGENT_DIR: <dir>}`；
 *     官方端点（base_url 空）静默跳过（env 层负责，D-008 分层）；
 *   - claude / 缺省 / 未知 kind → 返回 {}（claude settings.json 归调用侧
 *     applyClaudeSettings kind 守卫，不在此处）。
 *
 * per-session 目录（D-011）：`<daemonStateDir()>/codex/<sessionKey>/` 与
 * `<daemonStateDir()>/pi/<sessionKey>/`——与 CLAUDE_CONFIG_DIR 同根（平台管理的
 * 会话配置根旁挂 per-session 子目录，非 TEMP，R-06）。
 *
 * 失败语义（design Plan 约束 3「失败语义唯一化」）：mkdir / 写盘 IO 失败（含
 * writeCodexHome/writePiDir reject）→ 记 error 后该 kind 的 env 注入一并跳过、
 * 正常返回 {}，**绝不抛**——调用方 spawn 主路径不阻断（子进程按宿主 ~/.codex、
 * ~/.pi 现状运行 = 行为等同未配置，log 可归因）。终态清理与热切换重写归 task-04。
 *
 * 日志安全：warn/error 载荷只含 sessionKey / kind / 字段名 / 错误 message，
 * 永不含 api_key / daemonApiKey 明文（对齐两写盘器约束）。
 */
export async function applyProviderFileSettings(
  input: ProviderFileSettingsInput,
): Promise<Record<string, string>> {
  const { sessionKey, provider, daemonApiKey } = input;

  // D-012 absent 边界：provider_config 整体缺省 → 不写不注入（与现状逐字一致）。
  if (!provider) return {};

  if (provider.agent_kind === 'codex') {
    // 门槛前置判定先于 mkdir：门槛缺 → 零 mkdir 零写入零 env（可诊断不静默）。
    if (!isCodexFormSufficient(provider)) {
      console.warn('provider_file_dispatch_codex_skipped_missing_fields', {
        session_key: sessionKey,
        api_format: provider.api_format ?? 'anthropic',
      });
      return {};
    }
    const codexHome = join(daemonStateDir(), 'codex', sessionKey);
    try {
      // spawn 前创建 per-session 目录（写盘器不自建，目录缺失走 IO 失败路径）。
      await mkdir(codexHome, { recursive: true });
      await writeCodexHome({ codexHome, provider, daemonApiKey });
      return { CODEX_HOME: codexHome };
    } catch (e) {
      // writeCodexHome 已记 codex_home_write_failed；此处收口 mkdir 失败 + 统一
      // 跳过 env（失败语义唯一化：半写目录被 CLI 读到 ≠ 按宿主现状运行）。
      console.error('provider_file_dispatch_codex_failed', {
        session_key: sessionKey,
        error: (e as Error)?.message ?? String(e),
      });
      return {};
    }
  }

  if (provider.agent_kind === 'pi') {
    // 官方端点形态（base_url 空）：零写盘零 env 静默跳过——凭证注入归 env 层
    //（并行变更产物，D-008 分层，这是设计内分派而非异常）。
    if (nonEmptyStr(provider.base_url) === undefined) return {};
    if (!isPiFormSufficient(provider)) {
      console.warn('provider_file_dispatch_pi_skipped_missing_fields', {
        session_key: sessionKey,
        api_format: provider.api_format ?? 'anthropic',
      });
      return {};
    }
    const piDir = join(daemonStateDir(), 'pi', sessionKey);
    try {
      await mkdir(piDir, { recursive: true });
      await writePiDir({ piDir, provider });
      return { PI_CODING_AGENT_DIR: piDir };
    } catch (e) {
      // writePiDir 已记 pi_dir_write_failed；此处收口 mkdir 失败 + 统一跳过 env。
      console.error('provider_file_dispatch_pi_failed', {
        session_key: sessionKey,
        error: (e as Error)?.message ?? String(e),
      });
      return {};
    }
  }

  // claude / 缺省 / 未知 kind：无文件层 env（claude settings.json 由调用侧
  // applyClaudeSettings kind 守卫处理）。
  return {};
}

// ── reload 变体（2026-09-11-session-provider-switch-codex-pi task-02，R-05）────

/** applyProviderFileSettingsForReload 入参（design 接口定义）。 */
export interface ProviderFileSettingsReloadInput extends ProviderFileSettingsInput {
  /**
   * reload 前会话 env 快照（取 CODEX_HOME / PI_CODING_AGENT_DIR 判「此前是否
   * 平台供应商」+ 失败兜底键来源）。restore 路径传 undefined（恢复时无旧 env）。
   */
  priorEnv: Record<string, string> | undefined;
}

/**
 * reload/restore 专用的 provider 文件层分派（task-03 reload 内核 / task-04
 * restore 自愈接线；spawn 版 applyProviderFileSettings 零改动，并行导出）。
 *
 * **失败兜底语义与 spawn 版刻意不同**（Grill P1-1）：spawn 版失败一律返 {}（新
 * 进程按宿主现状起步 = 等同未配置）；reload 版失败返 priorEnv 对应文件层键
 * （新进程沿用旧供应商目录 = 等同未切，可归因）——失败语义完全内聚在本函数
 * 返回值，调用方只管 `Object.assign(newEnv, fileEnv)`，reload 主路径不阻断。
 *
 * 返回值矩阵（task-02 TaskCard implementation 分支一~五）：
 *   分支一（非 null 成功）——与 spawn 版同分派同产物：
 *     codex 门槛足 → 写盘返 {CODEX_HOME}；pi 自定义端点且门槛足 → {PI_CODING_AGENT_DIR}；
 *     pi 官方端点（base_url 空）→ {}（env 层负责，D-008）；claude/缺省/未知 kind → {}；
 *   分支二（非 null 且 mkdir/写盘 IO 失败）——返 priorEnv 对应文件层键（codex 回
 *     CODEX_HOME、pi 回 PI_CODING_AGENT_DIR；priorEnv undefined 取不到键 → {}，
 *     restore 路径按宿主现状降级，与 create 失败语义对齐——Grill 复审 P2-2）；
 *   分支三（非 null 且 codex 门槛缺）——warn 跳过写盘但返 priorEnv 的 CODEX_HOME
 *     键（若有，无则 {}）——异常配置场景等同未切而非丢文件层 env（Grill 复审 P2-1）；
 *     pi 门槛缺同口径返 priorEnv 的 PI_CODING_AGENT_DIR 键（同 P2-1 理由）；
 *   分支四（provider 显式 null 切回本机且 priorEnv 带 CODEX_HOME）——调
 *     mirrorCodexHostAuth 镜像宿主凭证，**无论镜像成败都返 {CODEX_HOME: <prior>}**
 *     （镜像失败则目录里旧供应商凭证仍在 = 等同未切，env 保住 = thread 历史保住）；
 *   分支五（null 且无 prior CODEX_HOME——含 pi kind，或 provider undefined
 *     absent）——返 {}（env 不带文件层键 = 回宿主 ~/.pi / 宿主起步 ~/.codex）。
 *
 * null/undefined 口径与 daemon 路由「缺席不归一为 null」同源：显式 null 才是
 * 切回本机（触发镜像分支）；undefined = D-012 absent 边界，零动作返 {}。
 *
 * 全矩阵任何分支均不抛（IO 异常一律捕获转返回值）。日志铁律：warn/error 载荷
 * 只含 sessionKey / kind / 字段名 / 错误 message，永不含 api_key / daemonApiKey
 * 明文。
 */
export async function applyProviderFileSettingsForReload(
  input: ProviderFileSettingsReloadInput,
): Promise<Record<string, string>> {
  const { sessionKey, provider, daemonApiKey, priorEnv } = input;

  /** priorEnv 文件层键兜底：取得到非空值返单键对象，否则返 {}（分支二/三/五共用）。 */
  const priorFileEnv = (
    key: 'CODEX_HOME' | 'PI_CODING_AGENT_DIR',
  ): Record<string, string> => {
    const prior = nonEmptyStr(priorEnv?.[key]);
    return prior !== undefined ? { [key]: prior } : {};
  };

  // 分支四 / 五：provider 显式 null = 切回本机（D-001）。undefined absent 不入
  // 此列（见函数注释 null/undefined 口径段）。
  if (provider === null) {
    const priorCodexHome = nonEmptyStr(priorEnv?.CODEX_HOME);
    if (priorCodexHome !== undefined) {
      // 分支四：此前在平台供应商上——镜像宿主凭证进 per-session 目录（目标 =
      // 与 spawn 版同口径的确定性派生路径；prior 值正常流即同一路径）。
      // mirrorCodexHostAuth 自身绝不抛；防御性兜底保证本函数铁律。
      try {
        await mirrorCodexHostAuth(join(daemonStateDir(), 'codex', sessionKey));
      } catch (e) {
        console.error('provider_file_reload_codex_mirror_failed', {
          session_key: sessionKey,
          error: (e as Error)?.message ?? String(e),
        });
      }
      // 无论镜像成败：env 保住旧目录（失败=目录留旧供应商产物=等同未切）。
      return { CODEX_HOME: priorCodexHome };
    }
    // 分支五：宿主起步会话（无 prior CODEX_HOME）或 pi kind（prior 只带
    // PI_CODING_AGENT_DIR）——回宿主 ~/.codex / ~/.pi。
    return {};
  }

  // D-012 absent 边界：provider 整体缺省 → 不写不注入（与 spawn 版逐字一致）。
  if (provider === undefined) return {};

  if (provider.agent_kind === 'codex') {
    // 分支三：门槛缺 → warn 跳过写盘但保 prior CODEX_HOME（P2-1：异常配置
    // 等同未切而非丢文件层 env——reload 已在途，丢 env = 静默回宿主凭证）。
    if (!isCodexFormSufficient(provider)) {
      console.warn('provider_file_reload_codex_skipped_missing_fields', {
        session_key: sessionKey,
        api_format: provider.api_format ?? 'anthropic',
      });
      return priorFileEnv('CODEX_HOME');
    }
    const codexHome = join(daemonStateDir(), 'codex', sessionKey);
    try {
      // 分支一：与 spawn 版同分派同产物（mkdir → writeCodexHome → 单键 env）。
      await mkdir(codexHome, { recursive: true });
      await writeCodexHome({ codexHome, provider, daemonApiKey });
      return { CODEX_HOME: codexHome };
    } catch (e) {
      // 分支二：目录里旧供应商产物未动 = 新进程沿用旧供应商，行为等同未切。
      console.error('provider_file_reload_codex_failed', {
        session_key: sessionKey,
        error: (e as Error)?.message ?? String(e),
      });
      return priorFileEnv('CODEX_HOME');
    }
  }

  if (provider.agent_kind === 'pi') {
    // 官方端点（base_url 空）：设计内分派而非失败——返 {} 走 env 层（D-008），
    // 无 prior 键兜底（切换语义本身 = 丢文件层凭证回 env 注入接管，R-06）。
    if (nonEmptyStr(provider.base_url) === undefined) return {};
    // pi 门槛缺：同分支三口径（P2-1 理由对 pi 同构）。
    if (!isPiFormSufficient(provider)) {
      console.warn('provider_file_reload_pi_skipped_missing_fields', {
        session_key: sessionKey,
        api_format: provider.api_format ?? 'anthropic',
      });
      return priorFileEnv('PI_CODING_AGENT_DIR');
    }
    const piDir = join(daemonStateDir(), 'pi', sessionKey);
    try {
      // 分支一：与 spawn 版同分派同产物。
      await mkdir(piDir, { recursive: true });
      await writePiDir({ piDir, provider });
      return { PI_CODING_AGENT_DIR: piDir };
    } catch (e) {
      // 分支二。
      console.error('provider_file_reload_pi_failed', {
        session_key: sessionKey,
        error: (e as Error)?.message ?? String(e),
      });
      return priorFileEnv('PI_CODING_AGENT_DIR');
    }
  }

  // claude / 缺省 / 未知 kind：分支一内空对象（同 spawn 版）。
  return {};
}
