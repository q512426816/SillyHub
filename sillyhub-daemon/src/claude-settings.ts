/**
 * claude-settings —— 写 `$CLAUDE_CONFIG_DIR/settings.json`（task-06 / spike-01 修正）。
 *
 * spike-01 硬发现：daemon 全源码此前**无 settings.json 写入**——`spawn-env.ts:151-155`
 * + `config.ts:55-60` 注释证实 CLAUDE_CONFIG_DIR 刻意留空（env-only 隔离，
 * ql-20260726-002-1180）。本 helper 是平台 daemon **新增**的写盘能力，让
 * `provider_config.settings_config` 中无 env 等价物的顶层开关（attribution 等）
 * 通过 claude code 读 `$CLAUDE_CONFIG_DIR/settings.json` 真正生效。
 *
 * 与隔离意图一致：隔离是为「不读宿主机 ~/.claude/settings.json」（避免 cc-switch
 * 污染），不是禁止平台自己写隔离目录内的 settings.json。
 *
 * 写盘范围（design §5.2 / D-008 / D-009，白名单显式枚举）：
 *   - attribution / enabledPlugins / model / skipDangerousModePermissionPrompt
 *   - **不写 env**（env 子键归 task-05 `credential-injector.toEnv` 处理，D-007 最高覆盖）
 *   - **不写 api_key**（永远只走 `provider_config.api_key` + `auth_field`，D-009 安全；
 *     且 api_key 本就不在 settings_config 顶层键里，白名单枚举天然排除）
 *
 * 零回归铁律（D-007 brownfield）：
 *   - provider_config / settings_config 为 absent / null / undefined → 不写文件、不抛、
 *     不删已存文件（claude 走默认 + 注入 env，行为与 spike-01 前逐字一致）。
 *   - settings_config 仅含 env（无任一白名单顶层键）→ 同样不写文件（env 已由 toEnv 注入）。
 *
 * 写盘时机 = spawn 前（两处 buildSpawnEnv 调用点旁），非 daemon 启动；daemon 单实例
 * 假设下单写同一 CLAUDE_CONFIG_DIR，无需并发锁。
 *
 * @module claude-settings
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CLAUDE_CONFIG_DIR } from './config.js';
import type { ProviderConfig } from './types.js';

/**
 * settings.json 允许合并的顶层键白名单（design §5.2 / D-008 / D-009）。
 *
 * 显式枚举而非「展开 settings_config 全部键」：① 排除 env（task-05 toEnv 处理）；
 * ② 排除任何未知键（防未来 settings_config 结构扩展时误泄漏到 settings.json）；
 * ③ api_key 天然不在列（settings_config 顶层本就无此键）。
 */
const TOP_LEVEL_KEYS = [
  'attribution',
  'enabledPlugins',
  'model',
  'skipDangerousModePermissionPrompt',
] as const;

/** settings.json 目标文件名（claude code 读 `$CLAUDE_CONFIG_DIR/settings.json`）。 */
const SETTINGS_FILENAME = 'settings.json';

/**
 * 把 `provider_config.settings_config` 的白名单顶层键合并成 settings.json 对象。
 *
 * 纯函数（无 IO，不读不入参），导出供 task-13 单测覆盖：
 *   - absent / null → 空对象（调用方据此判不写盘）
 *   - 仅 env → 空对象（env 不在白名单）
 *   - 含 attribution/model 等 → 仅白名单键 + 非 null/undefined 值
 *
 * 值过滤：`undefined` / `null` 视为未设置不写入；`false` / 空串 / 空对象按 JSON
 * 语义保留（例：cc-switch 的 `attribution:{commit:"",pr:"}` 表示隐藏署名，空对象合法）。
 */
function buildSettingsObject(
  provider_config: ProviderConfig | null | undefined,
): Record<string, unknown> {
  const sc = provider_config?.settings_config;
  if (!sc) return {};

  const out: Record<string, unknown> = {};
  const src = sc as Record<string, unknown>;
  for (const key of TOP_LEVEL_KEYS) {
    const v = src[key];
    if (v !== undefined && v !== null) {
      out[key] = v;
    }
  }
  return out;
}

/**
 * 合并 `provider_config.settings_config` 顶层键写 `$CLAUDE_CONFIG_DIR/settings.json`。
 *
 * 行为：
 *   1. buildSettingsObject 取白名单顶层键；结果为空（absent/null/仅 env/值全 null）
 *      → 直接 return，不写文件（零回归）。
 *   2. best-effort mkdir（`recursive:true` 忽略已存在；cli.ts:287 writePid 已保证目录
 *      存在，本步仅兜底运行期被清空场景）。
 *   3. `writeFile(join(dir,'settings.json'), JSON.stringify(obj,null,2), 'utf-8')`。
 *
 * 失败策略（best-effort，不阻断 spawn 主路径）：
 *   - 写盘抛错（EACCES / ENOSPC 等）→ console.warn 后吞掉，**绝不 rethrow**。
 *   - 理由：settings.json 是增强项（attribution 是 5 开关里唯一无 env 等价物项），
 *     写失败时 claude 仍可走默认 + 注入 env 跑完任务；让 cosmetic 开关写盘失败
 *     阻断整个 lease 违反「零回归」。与 daemon 既有 spawn-prep 副作用（如
 *     `linkSkillsToWorkdir` try/catch + warn）同模式。
 *
 * @param provider_config lease 下发的供应商配置；absent / 无 settings_config / 仅 env → 不写
 * @param dir 写入目录，默认 CLAUDE_CONFIG_DIR（测试可注入 tmpdir，task-13）
 */
export async function applyClaudeSettings(
  provider_config: ProviderConfig | null | undefined,
  dir: string = CLAUDE_CONFIG_DIR,
): Promise<void> {
  const obj = buildSettingsObject(provider_config);
  // 无任一白名单顶层键 → 不写文件（claude 走默认 + 注入 env，零回归 D-007）。
  if (Object.keys(obj).length === 0) return;

  try {
    // best-effort 建目录：recursive 忽略 EEXIST；其他错误让 writeFile 再抛一次后统一收口。
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, SETTINGS_FILENAME), JSON.stringify(obj, null, 2), 'utf-8');
  } catch (e) {
    // 写盘失败不阻断 spawn（settings.json 是增强项，非必需）；记 warn 供运维感知。
    console.warn(
      'claude_settings_write_failed',
      { dir, error: (e as Error)?.message ?? String(e) },
    );
  }
}
