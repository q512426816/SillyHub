/**
 * KnowledgeGovernanceHandler（2026-09-27-governance-rpc-actions）：
 * digest 直采（CLI JSON 信封透传/失败映射 method_not_found·timeout·internal）、
 * action 白名单（kind 拒/域名元字符拒/成功输出尾部）、root 防线。
 * 2026-09-28-audit-risk-fixes：root 防线两道——异常值黑名单（\0/换行/Windows
 * 非法文件名字符；& $ ' ` ; 合法放行）+ assertWithinAllowedRoots containment
 * （rootsProvider 注入，越界/空 root 拒且不 spawn CLI）。
 * sillyspecCmd 与 rootsProvider 全注入（不发真子进程）——RuntimeHandler 测试范式。
 */
import { describe, expect, it, vi } from 'vitest';

import { KnowledgeGovernanceHandler } from '../src/runtime-handler.js';

type CmdResult = { ok: boolean; stdout: string; stderr: string; timedOut: boolean };

function mk(cmdResult: CmdResult, cwdSink: string[] = [], allowedRoots: string[] = ['C:/repo/x']) {
  const sillyspecCmd = vi.fn(
    async (_cmd: string, _timeoutMs: number, cwd?: string): Promise<CmdResult> => {
      cwdSink.push(cwd ?? '');
      return cmdResult;
    },
  );
  return {
    handler: new KnowledgeGovernanceHandler({
      sillyspecCmd,
      rootsProvider: () => allowedRoots,
    }),
    sillyspecCmd,
  };
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
    await expect(handler.digest('ws-1', 'C:/repo/x')).rejects.toMatchObject({ code: 'method_not_found' });
  });

  it('超时 → timeout；非 JSON 输出 → internal', async () => {
    const t = mk({ ok: false, stdout: '', stderr: '', timedOut: true });
    await expect(t.handler.digest('ws-1', 'C:/repo/x')).rejects.toMatchObject({ code: 'timeout' });
    const bad = mk({ ok: true, stdout: 'not json', stderr: '', timedOut: false });
    await expect(bad.handler.digest('ws-1', 'C:/repo/x')).rejects.toMatchObject({ code: 'internal' });
  });

  it('root 异常值（换行/管道/NUL/Windows 非法字符）→ forbidden 且不 spawn', async () => {
    const { handler, sillyspecCmd } = mk({ ok: true, stdout: OK_ENVELOPE, stderr: '', timedOut: false });
    for (const bad of ['C:/repo\nrm -rf', 'C:/re|po', 'C:/re\0po', 'C:/re<po>', 'C:/re?po*']) {
      await expect(handler.digest('ws-1', bad)).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect(sillyspecCmd).not.toHaveBeenCalled();
  });

  it('Windows 合法目录字符 & $ 不再误拦（白名单内照常执行）', async () => {
    const cwds: string[] = [];
    const { handler, sillyspecCmd } = mk(
      { ok: true, stdout: OK_ENVELOPE, stderr: '', timedOut: false },
      cwds,
      ['C:/R&D/repo'],
    );
    const r = await handler.digest('ws-1', 'C:/R&D/repo');
    expect((r.digest as { totals: { pseudo: number } }).totals.pseudo).toBe(37);
    expect(sillyspecCmd).toHaveBeenCalledOnce();
    expect(cwds[0]).toBe('C:/R&D/repo');
  });

  it('root 越界 allowed_roots → forbidden 且不 spawn（containment 第二道）', async () => {
    const { handler, sillyspecCmd } = mk({ ok: true, stdout: OK_ENVELOPE, stderr: '', timedOut: false });
    await expect(handler.digest('ws-1', 'D:/outside/repo')).rejects.toMatchObject({ code: 'forbidden' });
    expect(sillyspecCmd).not.toHaveBeenCalled();
  });

  it('root 缺省/空 → forbidden（必须在白名单根内执行）', async () => {
    const { handler, sillyspecCmd } = mk({ ok: true, stdout: OK_ENVELOPE, stderr: '', timedOut: false });
    await expect(handler.digest('ws-1')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(handler.digest('ws-1', '')).rejects.toMatchObject({ code: 'forbidden' });
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
    const r = await ok.handler.action('ws-1', 'redomain', { from: 'auto-backend', to: 'platform-sync' }, 'C:/repo/x');
    expect(r.output).toContain('域迁移完成');
    expect(String(ok.sillyspecCmd.mock.calls[0]?.[0])).toContain('--from auto-backend --to platform-sync --write');

    const bad = mk({ ok: true, stdout: '', stderr: '', timedOut: false });
    await expect(
      bad.handler.action('ws-1', 'redomain', { from: 'auto; rm', to: 'x' }, 'C:/repo/x'),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      bad.handler.action('ws-1', 'redomain', { from: 'Auto-Backend', to: 'x' }, 'C:/repo/x'),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('root 越界 allowed_roots → forbidden 且不 spawn（写点 containment）', async () => {
    const { handler, sillyspecCmd } = mk({ ok: true, stdout: '', stderr: '', timedOut: false });
    await expect(
      handler.action('ws-1', 'repair-paths', {}, 'D:/outside/repo'),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(sillyspecCmd).not.toHaveBeenCalled();
  });

  it('kind 白名单外拒', async () => {
    const { handler, sillyspecCmd } = mk({ ok: true, stdout: '', stderr: '', timedOut: false });
    await expect(handler.action('ws-1', 'shell', { from: 'a', to: 'b' }, 'C:/repo/x')).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(sillyspecCmd).not.toHaveBeenCalled();
  });
});
