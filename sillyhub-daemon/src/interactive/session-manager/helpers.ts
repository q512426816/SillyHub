/**
 * interactive/session-manager/helpers.ts —— 事件字段 duck-type 读取辅助。
 *
 * task-02（2026-09-07-arch-large-file-split）：从原 session-manager.ts 尾部原样
 * 搬移（对齐 claude-events.ts 同款口径），events / background-tasks 子模块共用。
 *
 * task-04 轻重构①（同变更）：strOf/numOf 实现收敛至 src/payload-utils.ts
 * （与 task-runner/payload.ts 的 pick* 读取器统一为单一实现源）；本模块保留
 * 同名导出转发（对外导出面不变，行为零变化）。
 *
 * @module interactive/session-manager/helpers
 */

import type { AgentEvent } from '../../types.js';
import { numOf, strWithDefault } from '../../payload-utils.js';

export { numOf };

/** 取事件 metadata 开放容器（非对象/缺失 → undefined）。 */
export function eventMetaOf(ev: AgentEvent): Record<string, unknown> | undefined {
  const meta = ev.metadata;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    return meta as Record<string, unknown>;
  }
  return undefined;
}

/** String 化读取（null/undefined/非 string → ''）。task-04 轻重构①：默认值核心在 payload-utils。 */
export function strOf(v: unknown): string {
  return strWithDefault(v, '');
}
