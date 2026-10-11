// tests/interactive/session-live-task-ids.test.ts
// 2026-10-11-task-sweep-daemon-truth：sessionLiveTaskIds 只读快照——backend
// `session_live_tasks` RPC 的数据源（任务清扫死活判定的唯一真相源）。钉死：
//   1. 注册表内的 task_id 全量返回；
//   2. 未注册会话 = 空数组（不建条目、无写副作用）；
//   3. 注销（task_notification 删除条目）后不再返回。
//
// helper 只读 mgr._backgroundTasks，用最小 stub core 直测（无需 fake driver
// 全家桶——对齐本目录「按被测面选夹具」惯例）。

import { describe, it, expect } from 'vitest';
import {
  getOrCreateTaskMap,
  sessionLiveTaskIds,
} from '../../src/interactive/session-manager/background-tasks.js';
import type { SessionManagerCore } from '../../src/interactive/session-manager/types.js';

function stubCore(): SessionManagerCore {
  return { _backgroundTasks: new Map() } as unknown as SessionManagerCore;
}

describe('sessionLiveTaskIds（2026-10-11-task-sweep-daemon-truth）', () => {
  it('注册表内的 task_id 全量返回', () => {
    const mgr = stubCore();
    const tasks = getOrCreateTaskMap(mgr, 'sess-1');
    tasks.set('t-1', { taskName: 'A', async: true, startedAt: 1 });
    tasks.set('t-2', { taskName: 'B', async: true, startedAt: 2 });

    expect(sessionLiveTaskIds(mgr, 'sess-1').sort()).toEqual(['t-1', 't-2']);
  });

  it('未注册会话 = 空数组，且不建条目（只读无副作用）', () => {
    const mgr = stubCore();

    expect(sessionLiveTaskIds(mgr, 'sess-none')).toEqual([]);
    expect(mgr._backgroundTasks.has('sess-none')).toBe(false);
  });

  it('注销后不再返回（task_notification 删除条目 = daemon 判死）', () => {
    const mgr = stubCore();
    const tasks = getOrCreateTaskMap(mgr, 'sess-1');
    tasks.set('t-1', { taskName: 'A', async: true, startedAt: 1 });
    tasks.delete('t-1');

    expect(sessionLiveTaskIds(mgr, 'sess-1')).toEqual([]);
  });
});
