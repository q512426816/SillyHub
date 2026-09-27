/**
 * KnowledgeGovernanceHandler（2026-09-27-governance-rpc-actions）：
 * digest 直采（CLI JSON 信封透传/失败映射 method_not_found·timeout·internal）、
 * action 白名单（kind 拒/域名元字符拒/成功输出尾部）、root_path 元字符防线。
 * sillyspecCmd 全注入（不发真子进程）——RuntimeHandler 测试范式。
 */
import { describe, expect, it, vi } from 'vitest';

import { KnowledgeGovernanceHandler } from '../src/runtime-handler.js';

type CmdResult = { ok: boolean; stdout: string; stderr: string; timedOut: boolean };

function mk(cmdResult: CmdResult, cwdSink: string[] = []) {
  const sillyspecCmd = vi.fn(
    async (_cmd: string, _timeoutMs: number, cwd?: string): Promise<CmdResult> => {
      cwdSink.push(cwd ?? '');
      return cmdResult;
    },
  );
  return { handler: new KnowledgeGovernanceHandler({ sillyspecCmd }), sillyspecCmd };
}

const OK_ENVELOPE = JSON.stringify({
  ok: true,
  subcommand: 'digest',
  healthy: false,
  signals: [{ kind: 'pseudo-domain', title: '伪域在库', count: 37, detail: 'auto-backend 14', suggestion: '迁移' }],
  totals: { rot: 305, inbox: 39, pseudo: 37, unresolvedBindings: 1 },
});

describe('knowledge.digest', () => {
  it('成功：CLI JSON 信封透传 + cwd=仓库根', async () => {
    const cwds: string[] = [];
    const { handler, sillyspecCmd } = mk({ ok: true, stdout: OK_ENVELOPE, stderr: '', timedOut: false }, cwds);
    const r = await handler.digest('ws-1', 'C:/repo/x');
    expect((r.digest as { totals: { pseudo: number } }).totals.pseudo).toBe(37);
    expect(sillyspecCmd).toHaveBeenCalledOnce();
    expect(cwds[0]).toBe('C:/repo/x');
  });

  it('旧版 CLI 不识别子命令 → method_not_found', async () => {
    const { handler } = mk({ ok: false, stdout: '用法: sillyspec knowledge <sub>', stderr: '', timedOut: false });
    await expect(handler.digest('ws-1')).rejects.toMatchObject({ code: 'method_not_found' });
  });

  it('超时 → timeout；非 JSON 输出 → internal', async () => {
    const t = mk({ ok: false, stdout: '', stderr: '', timedOut: true });
    await expect(t.handler.digest('ws-1')).rejects.toMatchObject({ code: 'timeout' });
    const bad = mk({ ok: true, stdout: 'not json', stderr: '', timedOut: false });
    await expect(bad.handler.digest('ws-1')).rejects.toMatchObject({ code: 'internal' });
  });

  it('root_path 元字符 → forbidden', async () => {
    const { handler, sillyspecCmd } = mk({ ok: true, stdout: OK_ENVELOPE, stderr: '', timedOut: false });
    await expect(handler.digest('ws-1', 'C:/repo; rm -rf')).rejects.toMatchObject({ code: 'forbidden' });
    expect(sillyspecCmd).not.toHaveBeenCalled();
  });
});

describe('knowledge.action', () => {
  it('repair-paths：命令透传 + cwd', async () => {
    const cwds: string[] = [];
    const { handler, sillyspecCmd } = mk({ ok: true, stdout: '✅ 已写入 1 个条目', stderr: '', timedOut: false }, cwds);
    const r = await handler.action('ws-1', 'repair-paths', {}, 'C:/repo/x');
    expect(r.output).toContain('已写入');
    expect(String(sillyspecCmd.mock.calls[0]?.[0])).toContain('repair-paths --write');
    expect(cwds[0]).toBe('C:/repo/x');
  });

  it('redomain：域名合法透传；元字符/大小写拒', async () => {
    const ok = mk({ ok: true, stdout: '✅ 域迁移完成：2 条', stderr: '', timedOut: false });
    const r = await ok.handler.action('ws-1', 'redomain', { from: 'auto-backend', to: 'platform-sync' });
    expect(r.output).toContain('域迁移完成');
    expect(String(ok.sillyspecCmd.mock.calls[0]?.[0])).toContain('--from auto-backend --to platform-sync --write');

    const bad = mk({ ok: true, stdout: '', stderr: '', timedOut: false });
    await expect(bad.handler.action('ws-1', 'redomain', { from: 'auto; rm', to: 'x' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(bad.handler.action('ws-1', 'redomain', { from: 'Auto-Backend', to: 'x' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('kind 白名单外拒', async () => {
    const { handler, sillyspecCmd } = mk({ ok: true, stdout: '', stderr: '', timedOut: false });
    await expect(handler.action('ws-1', 'shell', { from: 'a', to: 'b' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(sillyspecCmd).not.toHaveBeenCalled();
  });
});
