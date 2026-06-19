// tests/protocol-session-contract.test.ts
// 契约单测（task-03）：断言 protocol.ts 新增的 5 个 session/permission 控制消息常量
// 与 4 类 payload interface，与 backend Python 对端
// (backend/app/modules/daemon/protocol.py) 逐字对齐。
//
// 任一字符串漂移（大小写/下划线/前缀冒号/连字符/驼峰）即双侧契约单测失败
// （design.md R-02 + NFR-05 + 蓝图 §4.1 对齐硬规则）。
//
// 期望值硬编码自 backend protocol.py（撰写本任务时已 Read 确认）。
// 与对端 backend/tests/modules/daemon/test_protocol_session_contract.py
// 中的预期字符串字面量逐字相等。

import { describe, it, expect } from 'vitest';
import {
  MSG,
  type MsgType,
  type SessionInjectPayload,
  type SessionControlPayload,
  type PermissionRequestPayload,
  type PermissionResponsePayload,
} from '../src/protocol';

// ── 跨语言对齐对照表（与 Python 单测 hardcode 同一份字符串字面量） ────────────
// 5 个新增常量的字符串值，daemon↔backend 逐字相等。
const EXPECTED = {
  SESSION_INJECT: 'daemon:session_inject',
  SESSION_INTERRUPT: 'daemon:session_interrupt',
  SESSION_END: 'daemon:session_end',
  PERMISSION_REQUEST: 'daemon:permission_request',
  PERMISSION_RESPONSE: 'daemon:permission_response',
} as const;

describe('protocol.MSG — 5 个 session/permission 控制消息（task-03，逐字对齐 backend）', () => {
  it('常量字符串值逐字对齐 backend protocol.py DAEMON_MSG_*', () => {
    // 与 backend protocol.py 中以下常量逐字相等：
    //   DAEMON_MSG_SESSION_INJECT / _INTERRUPT / _END /
    //   DAEMON_MSG_PERMISSION_REQUEST / _RESPONSE
    expect(MSG.SESSION_INJECT).toBe(EXPECTED.SESSION_INJECT);
    expect(MSG.SESSION_INTERRUPT).toBe(EXPECTED.SESSION_INTERRUPT);
    expect(MSG.SESSION_END).toBe(EXPECTED.SESSION_END);
    expect(MSG.PERMISSION_REQUEST).toBe(EXPECTED.PERMISSION_REQUEST);
    expect(MSG.PERMISSION_RESPONSE).toBe(EXPECTED.PERMISSION_RESPONSE);
  });

  it('5 个常量均以 daemon: 为前缀（与 batch 协议风格一致）', () => {
    expect(MSG.SESSION_INJECT.startsWith('daemon:')).toBe(true);
    expect(MSG.SESSION_INTERRUPT.startsWith('daemon:')).toBe(true);
    expect(MSG.SESSION_END.startsWith('daemon:')).toBe(true);
    expect(MSG.PERMISSION_REQUEST.startsWith('daemon:')).toBe(true);
    expect(MSG.PERMISSION_RESPONSE.startsWith('daemon:')).toBe(true);
  });

  it('全部新常量值全小写 + 下划线（禁止连字符/驼峰漂移）', () => {
    const sessionValues = [
      MSG.SESSION_INJECT,
      MSG.SESSION_INTERRUPT,
      MSG.SESSION_END,
      MSG.PERMISSION_REQUEST,
      MSG.PERMISSION_RESPONSE,
    ];
    for (const v of sessionValues) {
      // 去掉 "daemon:" 前缀后必须全小写 + 下划线（无连字符、无大写字母）
      const tail = v.slice('daemon:'.length);
      expect(tail).toMatch(/^[a-z][a-z_]*$/);
    }
  });

  it('5 个新常量值两两不同', () => {
    const values = [
      MSG.SESSION_INJECT,
      MSG.SESSION_INTERRUPT,
      MSG.SESSION_END,
      MSG.PERMISSION_REQUEST,
      MSG.PERMISSION_RESPONSE,
    ];
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('protocol.MSG — MsgType 联合成员（运行时 + 类型层）', () => {
  it('5 个新常量均属 MsgType 字面量联合（运行时 Object.values 包含）', () => {
    const allValues = Object.values(MSG);
    expect(allValues).toContain(EXPECTED.SESSION_INJECT);
    expect(allValues).toContain(EXPECTED.SESSION_INTERRUPT);
    expect(allValues).toContain(EXPECTED.SESSION_END);
    expect(allValues).toContain(EXPECTED.PERMISSION_REQUEST);
    expect(allValues).toContain(EXPECTED.PERMISSION_RESPONSE);
  });

  it('MsgType 字面量类型层覆盖（编译期赋值通过）', () => {
    // 若 MSG 未声明 as const 或常量缺失，下方赋值触发 TS 编译错误
    const a: MsgType = MSG.SESSION_INJECT;
    const b: MsgType = MSG.SESSION_INTERRUPT;
    const c: MsgType = MSG.SESSION_END;
    const d: MsgType = MSG.PERMISSION_REQUEST;
    const e: MsgType = MSG.PERMISSION_RESPONSE;
    expect([a, b, c, d, e]).toHaveLength(5);
  });
});

describe('protocol — batch 协议常量值不回归（FR-09 / AC-08）', () => {
  it('现有 10 个 batch/RPC 常量值零变化', () => {
    expect(MSG.TASK_AVAILABLE).toBe('daemon:task_available');
    expect(MSG.HEARTBEAT).toBe('daemon:heartbeat');
    expect(MSG.REGISTER).toBe('daemon:register');
    expect(MSG.HEARTBEAT_ACK).toBe('daemon:heartbeat_ack');
    expect(MSG.LEASE_CLAIM).toBe('daemon:lease_claim');
    expect(MSG.LEASE_START).toBe('daemon:lease_start');
    expect(MSG.LEASE_COMPLETE).toBe('daemon:lease_complete');
    expect(MSG.LEASE_MESSAGES).toBe('daemon:lease_messages');
    expect(MSG.RPC).toBe('daemon:rpc');
    expect(MSG.RPC_RESULT).toBe('daemon:rpc_result');
  });

  it('MSG 总数 = 15（10 旧 + 5 新），互不干扰', () => {
    expect(Object.keys(MSG)).toHaveLength(15);
  });
});

// ── Payload 字段存在性（编译期通过）+ 缺字段 / 错值类型层拦截 ──────────────────

describe('SessionInjectPayload — 字段对齐 backend SessionInjectPayload', () => {
  it('合法实例通过 TS 类型检查', () => {
    const p: SessionInjectPayload = {
      session_id: '11111111-1111-1111-1111-111111111111',
      lease_id: '22222222-2222-2222-2222-222222222222',
      run_id: '33333333-3333-3333-3333-333333333333',
      prompt: '请把这段代码再优化一下',
      claim_token: 'ctoken-abc',
    };
    expect(p.session_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(p.prompt).toBe('请把这段代码再优化一下');
    expect(p.claim_token).toBe('ctoken-abc');
  });

  it('缺必填字段触发 TS 编译错误（@ts-expect-error）', () => {
    // 缺 run_id
    // @ts-expect-error run_id 缺失应触发类型错误
    const _bad1: SessionInjectPayload = {
      session_id: 's-1',
      lease_id: 'l-1',
      prompt: 'p',
      claim_token: 'ct',
    };
    // 缺 prompt
    // @ts-expect-error prompt 缺失应触发类型错误
    const _bad2: SessionInjectPayload = {
      session_id: 's-1',
      lease_id: 'l-1',
      run_id: 'r-1',
      claim_token: 'ct',
    };
    // gap-2：缺 claim_token 也应触发类型错误
    // @ts-expect-error claim_token 缺失应触发类型错误
    const _bad3: SessionInjectPayload = {
      session_id: 's-1',
      lease_id: 'l-1',
      run_id: 'r-1',
      prompt: 'p',
    };
    expect(true).toBe(true); // 仅类型层断言，无运行时检查
  });
});

describe('SessionControlPayload — 字段对齐 backend SessionControlPayload', () => {
  it('合法实例通过 TS 类型检查', () => {
    const p: SessionControlPayload = {
      session_id: '11111111-1111-1111-1111-111111111111',
      lease_id: '22222222-2222-2222-2222-222222222222',
    };
    expect(p.session_id).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('缺 lease_id 触发 TS 编译错误', () => {
    // @ts-expect-error lease_id 缺失
    const _bad: SessionControlPayload = {
      session_id: 's-1',
    };
    expect(true).toBe(true);
  });
});

describe('PermissionRequestPayload — 字段对齐 backend PermissionRequestPayload', () => {
  it('合法实例（含可选 tool_use_id）通过 TS 类型检查', () => {
    const p: PermissionRequestPayload = {
      session_id: '11111111-1111-1111-1111-111111111111',
      run_id: '33333333-3333-3333-3333-333333333333',
      request_id: 'req-uuid-or-string',
      tool_name: 'Write',
      input: { file_path: '/tmp/x.txt', content: 'hi' },
      tool_use_id: 'toolu_abc123',
    };
    expect(p.tool_name).toBe('Write');
    expect(p.input.file_path).toBe('/tmp/x.txt');
  });

  it('tool_use_id 可选可省', () => {
    const p: PermissionRequestPayload = {
      session_id: 's-1',
      run_id: 'r-1',
      request_id: 'req-1',
      tool_name: 'Bash',
      input: { command: 'ls' },
    };
    expect(p.tool_use_id).toBeUndefined();
  });

  it('缺 tool_name 触发 TS 编译错误', () => {
    // @ts-expect-error tool_name 缺失
    const _bad: PermissionRequestPayload = {
      session_id: 's-1',
      run_id: 'r-1',
      request_id: 'req-1',
      input: {},
    };
    expect(true).toBe(true);
  });
});

describe('PermissionResponsePayload — decision 字面量联合约束', () => {
  it('合法实例（allow / deny）通过 TS 类型检查', () => {
    const allow: PermissionResponsePayload = {
      session_id: '11111111-1111-1111-1111-111111111111',
      request_id: 'req-1',
      decision: 'allow',
    };
    const deny: PermissionResponsePayload = {
      session_id: '11111111-1111-1111-1111-111111111111',
      request_id: 'req-1',
      decision: 'deny',
      message: '5min 超时未响应，自动拒绝',
    };
    expect(allow.decision).toBe('allow');
    expect(deny.decision).toBe('deny');
    expect(deny.message).toContain('超时');
  });

  it("decision 非法值（'maybe'）触发 TS 编译错误", () => {
    // @ts-expect-error decision 只接受 'allow' | 'deny'
    const _bad: PermissionResponsePayload = {
      session_id: 's-1',
      request_id: 'req-1',
      decision: 'maybe',
    };
    expect(true).toBe(true);
  });
});

// ── NFR-05 静默丢弃：未识别 type 不抛错 ──────────────────────────────────────
// 实际路由由 task-04 在 ws-client._handleMessage 落地；本任务单测锁定语义：
// 收到未在 MSG 注册的 type（如未来版本新增、拼写错误、恶意构造），
// 不应抛异常、不应影响已知 batch/RPC 分发。

describe('NFR-05 — 未识别 type 不抛错（ws-client 容错契约）', () => {
  it('未知 type 不在 MSG 已注册集合内', () => {
    const allRegistered = new Set(Object.values(MSG));
    // 模拟未来版本可能出现的类型 / 拼写错误 / 恶意构造
    const unknownTypes = [
      'daemon:unknown_future_type',
      'daemon:typo_session_inject', // 拼写错误
      'daemon:SESSION_INJECT', // 大小写漂移（错误形态）
      'daemon:session-inject', // 连字符漂移（错误形态）
      'daemon:sessionInject', // 驼峰漂移（错误形态）
      'malicious:not_daemon_prefix',
      '',
    ];
    for (const t of unknownTypes) {
      expect(allRegistered.has(t)).toBe(false);
    }
  });

  it('分发未识别 type 不抛异常（透传回调消费，由上层决定是否忽略）', () => {
    // ws-client._handleMessage 当前实现：未匹配 RPC 分支的 type 一律透传给 onMessage 回调，
    // 不抛异常（task-04 在此基础上对 SESSION_* / PERMISSION_* 显式 dispatch，仍保留默认分支 return + warn）。
    // 此处用纯 JS 模拟"分发未识别 type"的最小容错语义。
    const received: string[] = [];
    const onMessage = (msg: { type: string }): void => {
      received.push(msg.type);
      // 默认分支：未知 type 仅记录，不抛错（task-04 在此显式 warn + return）
    };
    const dispatch = (msg: { type: string }): void => {
      // 模拟 _handleMessage：未知 type 不抛，仅透传
      if (msg.type === 'daemon:rpc') {
        return; // 已知特殊分支
      }
      onMessage(msg);
    };
    // 不应抛异常
    expect(() => dispatch({ type: 'daemon:unknown_future_type' })).not.toThrow();
    expect(() => dispatch({ type: 'daemon:typo_session_inject' })).not.toThrow();
    expect(() => dispatch({ type: 'malicious:not_daemon_prefix' })).not.toThrow();
    // 已知 batch 类型分发不受影响（RPC 仍进特殊分支）
    expect(() => dispatch({ type: 'daemon:rpc' })).not.toThrow();
    expect(received).toContain('daemon:unknown_future_type');
  });
});
