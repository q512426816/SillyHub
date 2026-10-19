/**
 * host-settings-watcher —— 宿主机 ~/.claude/settings.json 的 env 块变化监听。
 *
 * 2026-10-19-host-settings-live-reload：本机默认（未绑平台供应商）会话的 claude 引擎
 * 对宿主 settings.json 的实测行为是「网关（base_url/token）每轮热重读、**模型名一经
 * 确定不再重解析**」——MiniMax 档（显式写 ANTHROPIC_MODEL）期间启动的会话、或被
 * `/model` 钉过模型的会话，模型名被烙死；cc-switch 切回 GLM 后这些会话「停留在旧
 * 供应商」，下一轮还会以旧模型名打新网关（400 modelCode 不存在，ql-20260822-001
 * 同款）。本模块给出变化信号，SessionManager 据此重载本机默认会话引擎（新引擎按
 * 当前档位重新解析网关与模型，/model 钉随旧进程消亡）。
 *
 * 侦测语义（design §做法概述）：
 *   - 轮询（默认 {@link HOST_SETTINGS_POLL_INTERVAL_MS}=1s，setInterval + unref，跨平台
 *     零依赖——CLAUDE.md 规则 13；放弃
 *     fs.watch：Windows 替换写会掉 watch，见 design 死路 2）；
 *   - 指纹 = env 块键排序后的稳定 JSON（非 env 字段变化不触发——permissions/hooks
 *     改动不打扰会话）；
 *   - 去抖 = 新指纹**连续两拍一致且 ≠ 基线**才确认（抵御原子替换/半写的瞬时态）；
 *   - 文件缺失 / JSON 损坏 → 本轮跳过不抛（下拍自愈），不污染候选态；
 *   - 启动第一拍只建基线，不触发。
 *
 * 本模块只负责「读 + 判 + 回调」，不持有任何会话状态；回调异常由调用方兜底。
 *
 * @module interactive/host-settings-watcher
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 宿主 settings.json 默认路径（与 claude-transcript-dir 的 home 侧同根）。 */
export function defaultHostSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

/**
 * env 块稳定指纹：键排序后 `JSON.stringify`。
 *
 * 返回 null = 文件不是合法 JSON 对象（调用方按「本轮跳过」处理，不触发不抛）。
 * 仅看 `env` 子对象——cc-switch 换档改的是 env 块；permissions/hooks 等其余字段
 * 变化对引擎网关/模型无影响，不构成重载理由。
 */
export function envBlockFingerprint(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const env = (parsed as { env?: unknown }).env;
  if (env === undefined || env === null) return 'null-env';
  if (typeof env !== 'object' || Array.isArray(env)) return null;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(env as Record<string, unknown>).sort()) {
    sorted[key] = (env as Record<string, unknown>)[key];
  }
  return JSON.stringify(sorted);
}

/** 监听选项。 */
export interface HostSettingsWatchOptions {
  /** 被监听文件（生产 defaultHostSettingsPath()；测试注入 tmp 路径）。 */
  settingsPath: string;
  /** 轮询间隔毫秒，默认 {@link HOST_SETTINGS_POLL_INTERVAL_MS}（≤0 视为非法按默认处理）。 */
  pollIntervalMs?: number;
  /** 确认变化后的回调（同步签名；重载动作由调用方自行 fire-and-forget）。 */
  onChange: (fingerprint: string) => void;
}

/**
 * 默认轮询节拍（毫秒）——单一源导出，守护测试断言用（防魔数漂移）。
 *
 * 2026-10-19-host-settings-reload-latency：3000 → 1000。端到端延迟（切档 → 引擎重载
 * 完成）由 4-6s 收窄到 2-4s（两拍去抖 6s→2s + 引擎重启 1-3s）；去抖/指纹/容错语义
 * 零变化，收益全部来自节拍。空转成本：每秒读 2-6KB + JSON 解析，微秒级，unref 定时器。
 */
export const HOST_SETTINGS_POLL_INTERVAL_MS = 1000;

/** 监听句柄：stop() 清定时器（幂等）。 */
export interface HostSettingsWatcherHandle {
  stop(): void;
}

/**
 * 起监听。读文件失败（缺失/权限）按「本轮跳过」处理——基线保持，文件恢复后照常比对。
 * 定时器 unref，不阻塞 daemon 退出。
 */
export function startHostSettingsWatcher(
  opts: HostSettingsWatchOptions,
): HostSettingsWatcherHandle {
  const interval = Math.max(1, opts.pollIntervalMs ?? HOST_SETTINGS_POLL_INTERVAL_MS);
  /** 已确认基线（null = 尚未建立——第一拍建立）。 */
  let baseline: string | null = null;
  /** 候选指纹与连续命中拍数（去抖）。 */
  let candidate: string | null = null;
  let candidateCount = 0;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const poll = async (): Promise<void> => {
    if (stopped) return;
    let fingerprint: string | null;
    try {
      fingerprint = envBlockFingerprint(await readFile(opts.settingsPath, 'utf-8'));
    } catch {
      // 文件缺失/不可读：本轮跳过（不推进基线也不清候选——瞬时态按未发生处理）。
      return;
    }
    if (fingerprint === null) {
      // 半写/损坏 JSON：同上，等待下拍自愈。
      return;
    }
    if (baseline === null) {
      // 第一拍：建基线，不触发。
      baseline = fingerprint;
      return;
    }
    if (fingerprint === baseline) {
      // 回到基线：清候选（换档中途又换回来的抖动不触发）。
      candidate = null;
      candidateCount = 0;
      return;
    }
    if (fingerprint === candidate) {
      candidateCount += 1;
    } else {
      candidate = fingerprint;
      candidateCount = 1;
    }
    // 连续两拍一致且异于基线 → 确认变化（去抖：原子替换/半写的瞬时态活不过两拍）。
    if (candidateCount >= 2) {
      baseline = fingerprint;
      candidate = null;
      candidateCount = 0;
      try {
        opts.onChange(fingerprint);
      } catch {
        // 回调异常不杀轮询（调用方重载动作自有兜底；此处保活）。
      }
    }
  };

  timer = setInterval(() => {
    void poll();
  }, interval);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return {
    stop(): void {
      stopped = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
