/**
 * interactive/session-manager/thinking-level.ts —— 会话思考档位查询/切换守卫 + 分派簇。
 *
 * task-03（2026-09-14-session-thinking-level / FR-02 / D-002@v1 单点接线）：
 * backend 经 ws_rpc `session_get_thinking_levels` / `session_set_thinking_level`
 * 到达 daemon 后的**最终防线**——守卫全过才分派 driver 两方法，回执
 * {@link ThinkingLevels} / {@link ThinkingLevelResult} 原样透传为 RPC result。
 *
 * 两档守卫强度（照 compact.ts 六守卫先例落子模块，D-002@v1 前轮拍板）：
 *
 * getThinkingLevels（**轻守卫**，R-04 切换后查询刷新依赖——running 期间可查现值
 * 不打断在跑轮）：
 *   ① store 无该 session → `SessionNotFoundError`
 *   ② status=ended / failed → `SessionNotActiveError`（终态拒绝；running /
 *      reconnecting 放行——查询无副作用，handle 失效时驱动错误原样上抛）
 *   ③ driver 未实现 getThinkingLevels 方法 → throw（caps=true 但版本错位的
 *      防御性双保险）
 *   ④ getProviderCaps(provider).thinking_level=false → throw（cursor 等无思考
 *      档位通道的引擎，providers.ts PROVIDER_CAPS 取值依据）
 *
 * setThinkingLevel（**六守卫照 compact**，D-002 仅空闲切换——切换与进行中 turn
 * 并发会交错写引擎 session 态）+ 入参词表校验：
 *   ⓪ level 词表外（isValidPlatformLevel=false）→ throw（平台七档单源
 *      thinking-levels.ts；handler 层已校验，此处防御性双保险）
 *   ① store 无该 session → `SessionNotFoundError`
 *   ② status=running → `SessionBusyError`（「稍后重试」语义，compact 守卫②同类）
 *   ③ status=reconnecting → `SessionNotActiveError`（inject 守卫同集）
 *   ④ status=ended / failed → `SessionNotActiveError`（inject 守卫同集）
 *   ⑤ driver 未实现 setThinkingLevel 方法 → throw（caps 声明与 driver 实现各自
 *      独立演进的双保险）
 *   ⑥ getProviderCaps(provider).thinking_level=false → throw
 *
 * driver / handle 定位照 compact.ts（interruptInternal 先例）：
 *   - driver：`state.driver`（session 归属）fallback `mgr._drivers.claude`
 *     （task-02 前旧内存 state 兼容，FR-10 不回退）；
 *   - handle：claude → `state.query`（SDK Query） / 其余 provider →
 *     `state.driverHandle`（互斥字段，types.ts D-001 注释）。
 *
 * 分派语义：get 传 `state.model` 给 driver（claude supportedModels 按当前模型
 * 过滤，Grill P1-5；SessionState.model 由本任务补建——create 时从
 * CreateSessionInput.model 写入，types.ts）；set 传**平台档位串原样**（引擎映射
 * mapPlatformLevelToEngine 归各 driver，task-04），result 含 ok=false 的驱动侧
 * 失败原样透传，不转译不吞。
 *
 * @module interactive/session-manager/thinking-level
 */

import type {
  InteractiveDriverHandle,
  ThinkingLevelResult,
  ThinkingLevels,
} from '../driver.js';
import { getProviderCaps } from '../providers.js';
import { isValidPlatformLevel } from '../thinking-levels.js';
import type { SessionState } from '../types.js';
import {
  SessionBusyError,
  SessionNotActiveError,
  SessionNotFoundError,
} from '../types.js';
import type { SessionManagerCore } from './types.js';

/**
 * 查询会话当前可用思考档位（facade SessionManager.getThinkingLevels 一行委托到此）。
 *
 * @throws {SessionNotFoundError} 轻守卫①：store 无该 session。
 * @throws {SessionNotActiveError} 轻守卫②：status ∈ {ended, failed}。
 * @throws {Error} 轻守卫③④：driver 未实现 getThinkingLevels /
 *   caps.thinking_level=false；以及 handle 互斥字段缺失的内部不变量防御
 *   （不向 driver 传空句柄）。
 */
export async function getThinkingLevels(
  mgr: SessionManagerCore,
  sessionId: string,
): Promise<ThinkingLevels> {
  // 轻守卫①：session 不存在。
  const state: SessionState | undefined = mgr._store.get(sessionId);
  if (!state) {
    throw new SessionNotFoundError(sessionId);
  }
  // 轻守卫②：仅终态拒绝（ended / failed）。running 期间可查（切换后前端 refetch
  // 档位列表刷新现值，R-04，不打断在跑轮）；reconnecting 放行——查询无副作用，
  // handle 恰在重建期失效时驱动错误原样上抛（不伪造成功）。
  if (state.status === 'ended' || state.status === 'failed') {
    throw new SessionNotActiveError(sessionId, state.status);
  }

  // 轻守卫③：driver 归属照 compact（state.driver 优先，旧 state fallback
  // _drivers.claude）；未解析出 driver 或未实现可选方法 getThinkingLevels? 都拒绝
  // ——caps 声明（providers.ts）与 driver 实现（task-04 逐引擎落地）独立演进，
  // 版本错位时此处兜底（D-002 防御性双保险）。
  const driver = state.driver ?? mgr._drivers.claude;
  if (!driver || typeof driver.getThinkingLevels !== 'function') {
    throw new Error(
      `getThinkingLevels not supported by driver: provider=${state.provider}`,
    );
  }
  // 轻守卫④：provider 能力矩阵拒绝（cursor CLI 无思考档位通道；未知 provider
  // 回退 false 默认拒绝，providers.ts getProviderCaps 契约）。
  if (!getProviderCaps(state.provider).thinking_level) {
    throw new Error(
      `getThinkingLevels not supported for provider: ${state.provider}`,
    );
  }

  // handle 定位照 compact：claude → state.query / 其余 → state.driverHandle。
  // 互斥字段缺失 = 内部不变量破坏——防御性 throw，不把空句柄传给 driver。
  const rawTarget =
    state.provider === 'claude' ? state.query : state.driverHandle;
  const handle = rawTarget as InteractiveDriverHandle | undefined;
  if (!handle) {
    throw new Error(
      `getThinkingLevels handle unavailable: ${sessionId} (provider=${state.provider})`,
    );
  }

  // 全守卫通过：分派 driver.getThinkingLevels，传 state.model 供 claude
  // supportedModels 按当前模型过滤（Grill P1-5；缺省 undefined 由 driver 回退
  // 默认档表，R-03）。ThinkingLevels 原样透传，不转译不吞。
  return driver.getThinkingLevels(handle, state.model);
}

/**
 * 切换会话思考档位（facade SessionManager.setThinkingLevel 一行委托到此）。
 *
 * @throws {Error} 守卫⓪：level 词表外（isValidPlatformLevel=false）。
 * @throws {SessionNotFoundError} 守卫①：store 无该 session。
 * @throws {SessionBusyError} 守卫②：status=running（turn 进行中，D-002 仅空闲切换）。
 * @throws {SessionNotActiveError} 守卫③④：status ∈ {reconnecting, ended, failed}。
 * @throws {Error} 守卫⑤⑥：driver 未实现 setThinkingLevel /
 *   caps.thinking_level=false；以及 handle 互斥字段缺失的内部不变量防御。
 */
export async function setThinkingLevel(
  mgr: SessionManagerCore,
  sessionId: string,
  level: string,
): Promise<ThinkingLevelResult> {
  // 守卫⓪：平台七档词表校验（thinking-levels.ts 单源，大小写敏感精确匹配）。
  // handler 层（daemon.ts）已校验一次，此处为 RPC 到达后的最终防线双保险。
  if (!isValidPlatformLevel(level)) {
    throw new Error(
      `invalid thinking level: ${level} (expected one of THINKING_LEVELS)`,
    );
  }

  // 守卫①：session 不存在。
  const state: SessionState | undefined = mgr._store.get(sessionId);
  if (!state) {
    throw new SessionNotFoundError(sessionId);
  }
  // 守卫②：turn 进行中——切换与 running turn 并发会交错写引擎 session 态
  //（claude applyFlagSettings / codex thread settings / pi rpc 均为 session 级
  // 写），拒绝并让 backend 引导用户稍后重试（D-002 仅空闲切换）。
  if (state.status === 'running') {
    throw new SessionBusyError(sessionId, state.status);
  }
  // 守卫③④：非 active（照 inject / compact 守卫同集：reconnecting / ended / failed）。
  if (
    state.status === 'reconnecting' ||
    state.status === 'ended' ||
    state.status === 'failed'
  ) {
    throw new SessionNotActiveError(sessionId, state.status);
  }

  // 守卫⑤：driver 未实现可选方法 setThinkingLevel?（caps 声明与 driver 实现
  // 独立演进的版本错位兜底，D-002 防御性双保险）。
  const driver = state.driver ?? mgr._drivers.claude;
  if (!driver || typeof driver.setThinkingLevel !== 'function') {
    throw new Error(
      `setThinkingLevel not supported by driver: provider=${state.provider}`,
    );
  }
  // 守卫⑥：provider 能力矩阵拒绝（cursor CLI 无思考档位通道；未知 provider
  // 回退 false 默认拒绝）。
  if (!getProviderCaps(state.provider).thinking_level) {
    throw new Error(
      `setThinkingLevel not supported for provider: ${state.provider}`,
    );
  }

  // handle 定位照 compact：claude → state.query / 其余 → state.driverHandle。
  const rawTarget =
    state.provider === 'claude' ? state.query : state.driverHandle;
  const handle = rawTarget as InteractiveDriverHandle | undefined;
  if (!handle) {
    throw new Error(
      `setThinkingLevel handle unavailable: ${sessionId} (provider=${state.provider})`,
    );
  }

  // 全守卫通过：平台档位串原样分派（引擎映射 mapPlatformLevelToEngine 归各
  // driver，task-04），ThinkingLevelResult（含 ok=false 的驱动侧失败）原样透传，
  // 不转译不吞。
  return driver.setThinkingLevel(handle, level);
}
