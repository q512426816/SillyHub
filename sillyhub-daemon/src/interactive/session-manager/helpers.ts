/**
 * interactive/session-manager/helpers.ts —— 事件字段 duck-type 读取辅助。
 *
 * task-02（2026-09-07-arch-large-file-split）：从原 session-manager.ts 尾部原样
 * 搬移（对齐 claude-events.ts 同款口径），events / background-tasks 子模块共用。
 *
 * @module interactive/session-manager/helpers
 */

import type { AgentEvent } from '../../types.js';

/** 取事件 metadata 开放容器（非对象/缺失 → undefined）。 */
export function eventMetaOf(ev: AgentEvent): Record<string, unknown> | undefined {
  const meta = ev.metadata;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    return meta as Record<string, unknown>;
  }
  return undefined;
}

/** String 化读取（null/undefined/非 string → ''）。 */
export function strOf(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** number 守卫读取（bool 排除；非 number → undefined）。 */
export function numOf(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
