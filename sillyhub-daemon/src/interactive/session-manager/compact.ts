/**
 * interactive/session-manager/compact.ts —— 会话级上下文压缩守卫 + 分派簇。
 *
 * task-03（2026-09-14-session-ctx-compact / FR-02 / D-002@v3 单点接线）：
 * backend 经 ws_rpc `session_compact` 到达 daemon 后的**最终防线**（R-04 窗口
 * 收窄）——六守卫全过才分派 driver.compact，回执 {@link CompactResult} 原样
 * 透传为 RPC result。
 *
 * 六守卫（拒绝形态照 turn-control.ts inject 三态先例：throw 结构化错误类，
 * 使 RPC handler 上抛 → ws-client RpcError → backend 收 DaemonRpcRemoteError
 * 映射（task-02 责任），handler 不吞异常）：
 *   ① store 无该 session → `SessionNotFoundError`
 *   ② status=running → `SessionBusyError`（压缩与进行中 turn 并发会交错写
 *      上下文；「稍后重试」语义，与恢复链驱逐前置守卫同类）
 *   ③ status=reconnecting → `SessionNotActiveError`（inject 守卫同集）
 *   ④ status=ended / failed → `SessionNotActiveError`（inject 守卫同集）
 *   ⑤ driver 未实现 compact 方法 → throw（caps=true 但版本错位，D-002 防御
 *      性双保险：caps 声明与 driver 实现各自独立演进）
 *   ⑥ getProviderCaps(provider).compact=false → throw（cursor 等无原生压缩
 *      通道的引擎，见 providers.ts PROVIDER_CAPS 取值依据）
 *
 * driver / handle 定位照 interruptInternal 先例（turn-control.ts:457）：
 *   - driver：`state.driver`（session 归属）fallback `mgr._drivers.claude`
 *     （task-02 前旧内存 state 兼容，FR-10 不回退）；
 *   - handle：claude → `state.query`（SDK Query） / 其余 provider →
 *     `state.driverHandle`（互斥字段，types.ts D-001 注释）。
 *
 * @module interactive/session-manager/compact
 */

import type { CompactResult, InteractiveDriverHandle } from '../driver.js';
import { getProviderCaps } from '../providers.js';
import type { SessionState } from '../types.js';
import {
  SessionBusyError,
  SessionNotActiveError,
  SessionNotFoundError,
} from '../types.js';
import type { SessionManagerCore } from './types.js';

/**
 * compact 入口（facade SessionManager.compact 一行委托到此）。
 *
 * @throws {SessionNotFoundError} 守卫①：store 无该 session。
 * @throws {SessionBusyError} 守卫②：status=running（turn 进行中）。
 * @throws {SessionNotActiveError} 守卫③④：status ∈ {reconnecting, ended, failed}。
 * @throws {Error} 守卫⑤⑥：driver 未实现 compact / caps.compact=false；
 *   以及 handle 互斥字段缺失的内部不变量防御（不向 driver 传空句柄）。
 */
export async function compact(
  mgr: SessionManagerCore,
  sessionId: string,
): Promise<CompactResult> {
  // 守卫①：session 不存在。
  const state: SessionState | undefined = mgr._store.get(sessionId);
  if (!state) {
    throw new SessionNotFoundError(sessionId);
  }

  // 守卫②：turn 进行中——压缩与 running turn 并发会交错写上下文（provider 的
  // 压缩通道按「当前上下文」快照），拒绝并让 backend 引导用户稍后重试。
  if (state.status === 'running') {
    throw new SessionBusyError(sessionId, state.status);
  }
  // 守卫③④：非 active（照 inject 守卫同集：reconnecting / ended / failed）。
  if (
    state.status === 'reconnecting' ||
    state.status === 'ended' ||
    state.status === 'failed'
  ) {
    throw new SessionNotActiveError(sessionId, state.status);
  }

  // 守卫⑤：driver 归属照 interruptInternal（state.driver 优先，旧 state fallback
  // _drivers.claude）；未解析出 driver 或 driver 未实现可选方法 compact? 都拒绝
  // ——caps 声明（providers.ts）与 driver 实现（task-04/05 逐引擎落地）独立
  // 演进，版本错位时此处兜底（D-002 防御性双保险）。
  const driver = state.driver ?? mgr._drivers.claude;
  if (!driver || typeof driver.compact !== 'function') {
    throw new Error(`compact not supported by driver: provider=${state.provider}`);
  }
  // 守卫⑥：provider 能力矩阵拒绝（cursor 无原生压缩通道；未知 provider 回退
  // false 默认拒绝，providers.ts getProviderCaps 契约）。
  if (!getProviderCaps(state.provider).compact) {
    throw new Error(`compact not supported for provider: ${state.provider}`);
  }

  // handle 定位照 interruptInternal：claude → state.query / 其余 → state.driverHandle。
  // 互斥字段缺失 = 内部不变量破坏（create 写 store 与 start 写句柄之间被观察到，
  // 或旧 state 字段残缺）——防御性 throw，不把空句柄传给 driver。
  const rawTarget =
    state.provider === 'claude' ? state.query : state.driverHandle;
  const handle = rawTarget as InteractiveDriverHandle | undefined;
  if (!handle) {
    throw new Error(
      `compact handle unavailable: ${sessionId} (provider=${state.provider})`,
    );
  }

  // 全守卫通过：分派 driver.compact，CompactResult（含 ok=false 的驱动侧失败）
  // 原样透传，不转译不吞。
  return driver.compact(handle);
}
