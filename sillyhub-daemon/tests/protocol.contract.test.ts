// tests/protocol.contract.test.ts
// 契约单测：断言 protocol.ts 导出的每个字符串值与 backend Python 对端逐字相等。
// 任一字符漂移即失败（对应 design.md R-02「WS 消息类型/lease 状态机漂移」）。
// 期望值硬编码自 backend/app/modules/daemon/protocol.py（撰写 task-03 蓝图时已 Read 确认）。

import { describe, it, expect } from 'vitest';
import { MSG, LEASE_STATE, WS_PATH, REST_PREFIX } from '../src/protocol';

describe('protocol.MSG — 逐字对齐 backend/app/modules/daemon/protocol.py', () => {
  it('Server → Daemon 消息', () => {
    expect(MSG.TASK_AVAILABLE).toBe('daemon:task_available');
    expect(MSG.HEARTBEAT).toBe('daemon:heartbeat');
  });

  it('Daemon → Server 消息', () => {
    expect(MSG.REGISTER).toBe('daemon:register');
    expect(MSG.HEARTBEAT_ACK).toBe('daemon:heartbeat_ack');
    expect(MSG.LEASE_CLAIM).toBe('daemon:lease_claim');
    expect(MSG.LEASE_START).toBe('daemon:lease_start');
    expect(MSG.LEASE_COMPLETE).toBe('daemon:lease_complete');
    expect(MSG.LEASE_MESSAGES).toBe('daemon:lease_messages');
  });

  it('全部 8 个 MSG 以 daemon: 为前缀', () => {
    for (const v of Object.values(MSG)) {
      expect(v.startsWith('daemon:')).toBe(true);
    }
  });
});

describe('protocol.LEASE_STATE — 逐字对齐 daemon protocol.py STATE_*', () => {
  it('5 个状态值', () => {
    expect(LEASE_STATE.PENDING).toBe('pending');
    expect(LEASE_STATE.RUNNING).toBe('running');
    expect(LEASE_STATE.COMPLETED).toBe('completed');
    expect(LEASE_STATE.FAILED).toBe('failed');
    expect(LEASE_STATE.CANCELLED).toBe('cancelled');
  });
});

describe('protocol 端点路径', () => {
  it('WS_PATH 对齐 daemon.py:160 _build_ws_url', () => {
    expect(WS_PATH).toBe('/api/daemon/ws');
  });
  it('REST_PREFIX 对齐 backend router.py:44 + main.py:237', () => {
    expect(REST_PREFIX).toBe('/api/daemon');
  });
});

describe('protocol 类型守卫（编译期保证字面量类型）', () => {
  it('MsgType 是字面量联合而非 string', () => {
    // 此处的赋值若 MSG 未声明 as const，TS 会推断为 string 而非字面量
    const t: 'daemon:register' = MSG.REGISTER;
    expect(t).toBe(MSG.REGISTER);
  });
  it('LeaseState 是字面量联合而非 string', () => {
    const s: 'running' = LEASE_STATE.RUNNING;
    expect(s).toBe(LEASE_STATE.RUNNING);
  });
});
