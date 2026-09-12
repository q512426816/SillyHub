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
import { writeFileAtomic } from './atomic-write.js';
import { daemonStateDir } from './config.js';
import { mirrorCodexHostAuth } from './codex-settings.js';
// task-02（2026-09-11-provider-adapter-registry）：分派数据源——聚合表
// INTERACTIVE_PROVIDERS（值引用全在函数体内，与 providers.ts 对本模块写盘器
// 的引用互为 import 环安全形态，见 credential-injector.ts REGISTRY 注释同款）。
import {
  INTERACTIVE_PROVIDERS,
  type ProviderAdapter,
} from './interactive/providers.js';
import type { ProviderConfig } from './types.js';

// ── 生效标记（2026-09-12-provider-file-tx D-004@v2）─────────────────────────

/** per-session 目录的「切换曾真实生效」标记文件名（点前缀对 CLI 透明）。 */
export const MANAGED_MARKER_FILENAME = '.sillyhub-managed';

/**
 * 落生效标记（内容仅排障用非契约：envKey + switchedAt）。
 *
 * 返回是否成功——分支四（codex-null 镜像）以返回值决定是否执行镜像（标记先行，
 * 删除类动作只发生在标记持久化之后，R-03 双失败从根消除）；分支一（非 null 写盘）
 * 后置调用、失败仅 warn（写盘主体已成功，legacy 探测判据可兜）。
 */
async function writeManagedMarker(dir: string, envKey: string): Promise<boolean> {
  try {
    // 目录可能尚未建（镜像路径的 mkdir 原在 mirrorCodexHostAuth 内部，标记先行
    // 后由本处负责建）。
    await mkdir(dir, { recursive: true });
    await writeFileAtomic(
      join(dir, MANAGED_MARKER_FILENAME),
      JSON.stringify({ envKey, switchedAt: new Date().toISOString() }),
    );
    return true;
  } catch (e) {
    console.warn('provider_file_marker_write_failed', {
      dir,
      error: (e as Error)?.message ?? String(e),
    });
    return false;
  }
}

// ── provider 文件层分派（task-03 / 2026-09-10-multi-provider-injection）──────────

/** 空串 / null / undefined 一律视为未设置（对齐 codex/pi-settings 同名判式）。 */
export function nonEmptyStr(v: string | null | undefined): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
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

  // task-02（2026-09-11-provider-adapter-registry / FR-02）：kind 分派改按聚合表
  // INTERACTIVE_PROVIDERS 的 fileSettings writer 派发（原 codex/pi 两段 if 硬编码；
  // writer 接口五要素 = dirName/envKey/isSufficient/write/skipsOfficialEndpoint，
  // codex/pi writer 实现挂聚合条目，见 providers.ts）。行为逐字等价：门槛缺 warn
  // 跳过返 {}、官方端点 skip、mkdir→write→单键 env、IO 失败 error 返 {}（原
  // per-kind 分支语义全保留，仅数据源换 writer）。claude/缺省/未知 kind 表查无
  // writer → {} 与原 fallthrough 一致。
  const adapter = (INTERACTIVE_PROVIDERS as Record<
    string,
    ProviderAdapter | undefined
  >)[provider.agent_kind ?? ''];
  if (adapter !== undefined && 'write' in adapter.fileSettings) {
    const writer = adapter.fileSettings;
    // 官方端点形态（pi base_url 空）：零写盘零 env 静默跳过——凭证注入归 env 层
    //（D-008 分层，这是设计内分派而非异常）。
    if (writer.skipsOfficialEndpoint(provider)) return {};
    // 门槛前置判定先于 mkdir：门槛缺 → 零 mkdir 零写入零 env（可诊断不静默）。
    if (!writer.isSufficient(provider)) {
      console.warn(`provider_file_dispatch_${writer.dirName}_skipped_missing_fields`, {
        session_key: sessionKey,
        api_format: provider.api_format ?? 'anthropic',
      });
      return {};
    }
    const dir = join(daemonStateDir(), writer.dirName, sessionKey);
    try {
      // spawn 前创建 per-session 目录（写盘器不自建，目录缺失走 IO 失败路径）。
      await mkdir(dir, { recursive: true });
      await writer.write({ dir, provider, daemonApiKey });
      return { [writer.envKey]: dir };
    } catch (e) {
      // 写盘器本体已记 per-kind 失败日志；此处收口 mkdir 失败 + 统一跳过 env
      //（失败语义唯一化：半写目录被 CLI 读到 ≠ 按宿主现状运行）。
      console.error(`provider_file_dispatch_${writer.dirName}_failed`, {
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
  const priorFileEnv = (key: string): Record<string, string> => {
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
      //（task-02：null 分支无 agent_kind 可查表，codex 镜像目标为 per-engine
      // 差异按 design 非目标保留原 'codex' 字面量——仅 codex 有「丢目录=断
      // resume」的镜像语义，pi null = 回宿主即语义本身。）
      const codexHome = join(daemonStateDir(), 'codex', sessionKey);
      // D-004@v2 标记先行：标记写失败则跳过整个镜像（含删除动作）直接返 prior
      //（「镜像失败=等同未切」语义延伸）——删除类动作只发生在标记持久化之后。
      const markerOk = await writeManagedMarker(codexHome, 'CODEX_HOME');
      if (!markerOk) {
        return { CODEX_HOME: priorCodexHome };
      }
      try {
        await mirrorCodexHostAuth(codexHome);
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

  // task-02（2026-09-11-provider-adapter-registry / FR-02）：内部 codex/pi 分派
  // 改按聚合表 fileSettings writer 派发（priorEnv 兜底矩阵逻辑逐字保留，仅
  // 分派来源换 writer；分支编号与语义见函数头注释）。
  const adapter = (INTERACTIVE_PROVIDERS as Record<
    string,
    ProviderAdapter | undefined
  >)[provider.agent_kind ?? ''];
  if (adapter !== undefined && 'write' in adapter.fileSettings) {
    const writer = adapter.fileSettings;
    // 官方端点（pi base_url 空）：设计内分派而非失败——返 {} 走 env 层（D-008），
    // 无 prior 键兜底（切换语义本身 = 丢文件层凭证回 env 注入接管，R-06）。
    if (writer.skipsOfficialEndpoint(provider)) return {};
    // 分支三：门槛缺 → warn 跳过写盘但保 prior 文件层键（P2-1：异常配置
    // 等同未切而非丢文件层 env——reload 已在途，丢 env = 静默回宿主凭证）。
    if (!writer.isSufficient(provider)) {
      console.warn(`provider_file_reload_${writer.dirName}_skipped_missing_fields`, {
        session_key: sessionKey,
        api_format: provider.api_format ?? 'anthropic',
      });
      return priorFileEnv(writer.envKey);
    }
    const dir = join(daemonStateDir(), writer.dirName, sessionKey);
    try {
      // 分支一：与 spawn 版同分派同产物（mkdir → write → 单键 env）。
      await mkdir(dir, { recursive: true });
      await writer.write({ dir, provider, daemonApiKey });
      // D-004@v2 标记后置 best-effort：写盘主体已成功，标记失败仅 warn（helper
      // 内部吞错），legacy 探测判据（auth/config 存在）可兜住无标记场景。
      await writeManagedMarker(dir, writer.envKey);
      return { [writer.envKey]: dir };
    } catch (e) {
      // 分支二：目录里旧供应商产物未动 = 新进程沿用旧供应商，行为等同未切。
      console.error(`provider_file_reload_${writer.dirName}_failed`, {
        session_key: sessionKey,
        error: (e as Error)?.message ?? String(e),
      });
      return priorFileEnv(writer.envKey);
    }
  }

  // claude / 缺省 / 未知 kind：分支一内空对象（同 spawn 版）。
  return {};
}
