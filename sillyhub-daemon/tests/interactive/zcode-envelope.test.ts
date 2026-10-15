// tests/interactive/zcode-envelope.test.ts
// 2026-10-15-zcode-engine-appserver task-02：ZCode 私有协议信封层单测。
// 协议事实锚（2026-10-15 实测，decisions.md D-005 evidence）：
//   - 信封 strict 四分支 union：请求 {id,method,params?} / 通知 {method,params?} /
//     响应 {id,result} / 错误 {id,error:{code,message,data?}}——多余键（jsonrpc/
//     requestId）服务端 zod 直接拒（实测镜像）；
//   - 客户端请求 id 数字自增；服务端主动请求 id 为字符串（"server-N"）；
//   - 无 initialize 握手，入站按 union 四分支解复用。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZcodeEnvelope } from '../../src/adapters/zcode-envelope.js';

/** 收集写出的帧（模拟 stdin write sink）。 */
class Sink {
  lines: string[] = [];
  write(line: string): void {
    this.lines.push(line);
  }
  last(): unknown {
    return JSON.parse(this.lines[this.lines.length - 1] ?? 'null');
  }
  parsed(): unknown[] {
    return this.lines.map((l) => JSON.parse(l));
  }
}

describe('ZcodeEnvelope 编解码', () => {
  it('出站请求帧：恰好 {id,method,params} 三键，id 数字自增，无 jsonrpc/requestId 键', () => {
    const env = new ZcodeEnvelope();
    const sink = new Sink();
    void env.request('session/list', {}, sink.write.bind(sink));
    void env.request('session/send', { content: 'hi' }, sink.write.bind(sink));
    const frames = sink.parsed() as Array<Record<string, unknown>>;
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual({ id: 1, method: 'session/list', params: {} });
    expect(frames[1]).toEqual({ id: 2, method: 'session/send', params: { content: 'hi' } });
    expect('jsonrpc' in frames[0]).toBe(false);
    expect('requestId' in frames[0]).toBe(false);
    // 帧以换行结尾（NDJSON）
    expect(sink.lines[0].endsWith('\n')).toBe(true);
  });

  it('params undefined 时帧省略 params 键（strict 镜像：不发多余键）', () => {
    const env = new ZcodeEnvelope();
    const sink = new Sink();
    void env.request('session/stop', undefined, sink.write.bind(sink));
    expect(sink.last()).toEqual({ id: 1, method: 'session/stop' });
  });

  it('出站通知帧：{method,params} 无 id', () => {
    const env = new ZcodeEnvelope();
    const sink = new Sink();
    env.sendNotification('notifications/cancelled', { x: 1 }, sink.write.bind(sink));
    expect(sink.last()).toEqual({ method: 'notifications/cancelled', params: { x: 1 } });
  });

  it('服务端请求应答帧：{id:"server-N", result} 字符串 id 原样回带', () => {
    const env = new ZcodeEnvelope();
    const sink = new Sink();
    env.handleLine('{"id":"server-1","method":"session/requestRuntimePreferences","params":{"scope":"runtime-materialization"}}', {
      write: sink.write.bind(sink),
    });
    // 未注册 handler → 自动回空 result（防 15s 超时挂死）
    expect(sink.last()).toEqual({ id: 'server-1', result: {} });
  });

  it('编码往返：encode → JSON.parse 逐字段无损', () => {
    const env = new ZcodeEnvelope();
    const sink = new Sink();
    env.sendNotification('state.updated', { a: { b: [1, 2, 3] } }, sink.write.bind(sink));
    expect(sink.last()).toEqual({
      method: 'state.updated',
      params: { a: { b: [1, 2, 3] } },
    });
  });
});

describe('ZcodeEnvelope 入站四分支解复用', () => {
  it('通知（无 id 有 method）→ onNotification 回调', () => {
    const env = new ZcodeEnvelope();
    const seen: unknown[] = [];
    env.onNotification((n) => seen.push(n));
    env.handleLine('{"method":"state.updated","params":{"patch":{"status":"running"}}}', { write: () => {} });
    expect(seen).toEqual([{ method: 'state.updated', params: { patch: { status: 'running' } } }]);
  });

  it('响应（id 数字 + result）→ pending resolve', async () => {
    const env = new ZcodeEnvelope();
    const sink = new Sink();
    const p = env.request('session/list', {}, sink.write.bind(sink));
    env.handleLine('{"id":1,"result":{"sessions":[]}}', { write: () => {} });
    await expect(p).resolves.toEqual({ sessions: [] });
  });

  it('错误帧（id + error）→ pending reject（结构化 error 对象）', async () => {
    const env = new ZcodeEnvelope();
    const sink = new Sink();
    const p = env.request('session/create', {}, sink.write.bind(sink));
    env.handleLine('{"id":1,"error":{"code":-32602,"message":"Invalid params"}}', { write: () => {} });
    await expect(p).rejects.toMatchObject({
      code: -32602,
      message: 'Invalid params',
    });
  });

  it('两个 in-flight 请求乱序响应 → 各自正确 resolve', async () => {
    const env = new ZcodeEnvelope();
    const sink = new Sink();
    const p1 = env.request('a', {}, sink.write.bind(sink));
    const p2 = env.request('b', {}, sink.write.bind(sink));
    env.handleLine('{"id":2,"result":"second"}', { write: () => {} });
    env.handleLine('{"id":1,"result":"first"}', { write: () => {} });
    expect(await p1).toBe('first');
    expect(await p2).toBe('second');
  });

  it('已注册服务端请求 → handler 收到 params 并可自定义应答', () => {
    const env = new ZcodeEnvelope();
    const sink = new Sink();
    env.registerServerRequestHandler('interaction/requestPermission', (params, reply) => {
      expect(params).toEqual({ options: [] });
      reply({ outcome: 'deny' });
    });
    env.handleLine('{"id":"server-7","method":"interaction/requestPermission","params":{"options":[]}}', {
      write: sink.write.bind(sink),
    });
    expect(sink.last()).toEqual({ id: 'server-7', result: { outcome: 'deny' } });
  });

  it('空行/空白行安全忽略；非法 JSON → onProtocolError 不抛', () => {
    const env = new ZcodeEnvelope();
    const errors: unknown[] = [];
    env.onProtocolError((e) => errors.push(e));
    expect(() => {
      env.handleLine('', { write: () => {} });
      env.handleLine('   ', { write: () => {} });
      env.handleLine('not-json', { write: () => {} });
    }).not.toThrow();
    expect(errors).toHaveLength(1);
  });

  it('未知形状帧（如 {foo:1}）→ onProtocolError 记录且不误分发', () => {
    const env = new ZcodeEnvelope();
    const errors: unknown[] = [];
    const seen: unknown[] = [];
    env.onProtocolError((e) => errors.push(e));
    env.onNotification((n) => seen.push(n));
    env.handleLine('{"foo":1}', { write: () => {} });
    expect(errors).toHaveLength(1);
    expect(seen).toHaveLength(0);
  });
});

describe('ZcodeEnvelope 请求超时', () => {
  beforeEach(() => vi.useRealTimers());

  it('超时未响应 → reject 且 pending 清理', async () => {
    const env = new ZcodeEnvelope();
    const sink = new Sink();
    const p = env.request('slow', {}, sink.write.bind(sink), { timeoutMs: 30 });
    await expect(p).rejects.toMatchObject({ timedOut: true });
  });
});
