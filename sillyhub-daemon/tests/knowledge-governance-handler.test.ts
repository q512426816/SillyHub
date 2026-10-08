/**
 * KnowledgeGovernanceHandler（2026-09-27-governance-rpc-actions）：
 * digest 直采（CLI JSON 信封透传/失败映射 method_not_found·timeout·internal）、
 * action 白名单（kind 拒/域名元字符拒/成功输出尾部）、root 防线。
 * 2026-09-28-audit-risk-fixes：root 防线两道——异常值黑名单（\0/换行/Windows
 * 非法文件名字符；& $ ' ` ; 合法放行）+ assertWithinAllowedRoots containment
 * （rootsProvider 注入，越界/空 root 拒且不 spawn CLI）。
 * 2026-10-08-platform-knowledge-graph task-04：graph 用例组——七子命令白名单、
 * anchor/anchor2/search 三参数注入矩阵（R-01 安全门钉子：任一恶意样本到达命令串
 * 即用例失败）、正常节点 id 放行、edges 枚举、depth/limit 钳制、search 限长、命令
 * 拼装（引号锚点/--json/--clusters 50）、旧 CLI 三态（cli_subcommand_missing/
 * cli_feature_missing:summary|nodes；method_unregistered 是 daemon 未注册 handler
 * 的平台侧场景、非 handler 能抛，由 daemon.ts 注册 + _dispatchRpc 保证——此处仅
 * 注释说明，不造用例）、ok:false 信封→internal、清单 top-50 截断 count 保真。
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

// ── knowledge.graph（2026-10-08-platform-knowledge-graph task-04）──────────────

/** graph 成功信封（ok:true + 任意 data 覆盖）。 */
const GRAPH_OK = (data: Record<string, unknown> = {}): string =>
  JSON.stringify({ ok: true, query: { sub: 'neighbors' }, summary: [], ...data });

/** 旧 CLI graph_usage 失败信封（实测 exit 0 + ok:false 形态，usage/subcommand 可覆写）。 */
const GRAPH_USAGE_ERR = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    ok: false,
    error: {
      code: 'graph_usage',
      usage: '用法：sillyspec knowledge graph <summary|nodes|neighbors|path|impact|orphans|dangling> [锚点...] [--search <模糊>] [--limit N] [--edges <边型>] [--depth N]',
      ...over,
    },
  });

describe('knowledge.graph', () => {
  it('① 子命令白名单外 → validation_rejected 且不 spawn', async () => {
    const { handler, sillyspecCmd } = mk({ ok: true, stdout: GRAPH_OK(), stderr: '', timedOut: false });
    for (const sub of ['impact;', 'rm', '', 'SUMMARY', 'graph', 'neighbors --json']) {
      await expect(handler.graph('ws-1', { sub }, 'C:/repo/x')).rejects.toMatchObject({
        code: 'validation_rejected',
      });
    }
    expect(sillyspecCmd).not.toHaveBeenCalled();
  });

  it('② 三参数注入矩阵：anchor/anchor2/search × 黑名单样本全拒、零到达命令串', async () => {
    const { handler, sillyspecCmd } = mk({ ok: true, stdout: GRAPH_OK(), stderr: '', timedOut: false });
    // 黑名单全集采样：; ` $() 引号 换行 tab % ^ '（GRAPH_TEXT_BLACKLIST_RE）
    const malicious = ['; rm -rf /', '`id`', '$(cmd)', '"quoted"', 'a\nb', 'a\tb', 'a%b', 'a^b', "a'b"];
    for (const bad of malicious) {
      // anchor 位置（neighbors 单锚点）
      await expect(handler.graph('ws-1', { sub: 'neighbors', anchor: bad }, 'C:/repo/x')).rejects.toMatchObject({
        code: 'validation_rejected',
      });
      // anchor2 位置（path 双锚点，第二位带毒）
      await expect(
        handler.graph('ws-1', { sub: 'path', anchor: 'FR-core-engine-001', anchor2: bad }, 'C:/repo/x'),
      ).rejects.toMatchObject({ code: 'validation_rejected' });
      // search 位置（nodes 模糊串）
      await expect(handler.graph('ws-1', { sub: 'nodes', search: bad }, 'C:/repo/x')).rejects.toMatchObject({
        code: 'validation_rejected',
      });
    }
    // 安全门钉子：矩阵任一样本到达命令串（spawn 被调）即本断言失败。
    expect(sillyspecCmd).not.toHaveBeenCalled();
  });

  it('③ 正常节点 id 样本全放行（/#:@/路径/FR/change 名）+ cwd=仓库根', async () => {
    const cwds: string[] = [];
    const { handler, sillyspecCmd } = mk({ ok: true, stdout: GRAPH_OK({ nodes: [] }), stderr: '', timedOut: false }, cwds);
    const anchors = [
      'decision:decisions/unmapped.md#D-002@v2',
      'backend/app/modules/knowledge/router.py',
      'FR-core-engine-001',
      '2026-10-08-x',
    ];
    for (const a of anchors) {
      const r = await handler.graph('ws-1', { sub: 'neighbors', anchor: a }, 'C:/repo/x');
      expect((r.graph as { ok: boolean }).ok).toBe(true);
      expect(String(sillyspecCmd.mock.calls[sillyspecCmd.mock.calls.length - 1]?.[0])).toContain(`"${a}"`);
    }
    expect(sillyspecCmd).toHaveBeenCalledTimes(anchors.length);
    expect(cwds[0]).toBe('C:/repo/x');
  });

  it('④ edges：all + 16 边型放行；白名单外（foo;bar/strong/大写）拒', async () => {
    const { handler, sillyspecCmd } = mk({ ok: true, stdout: GRAPH_OK(), stderr: '', timedOut: false });
    const allowed = [
      'all', 'module-dep', 'module-files', 'anchors', 'supersedes', 'from-change', 'belongs-module',
      'deliverables', 'change-modules', 'test-binding', 'describes', 'changelog-of', 'changelog-entry',
      'doc-refs', 'scan-refs', 'route', 'entry-link',
    ];
    for (const e of allowed) {
      await handler.graph('ws-1', { sub: 'neighbors', anchor: 'FR-core-engine-001', edges: e }, 'C:/repo/x');
      expect(String(sillyspecCmd.mock.calls[sillyspecCmd.mock.calls.length - 1]?.[0])).toContain(`--edges ${e}`);
    }
    const bad = mk({ ok: true, stdout: GRAPH_OK(), stderr: '', timedOut: false });
    for (const e of ['foo;bar', 'strong', 'ALL']) {
      await expect(
        bad.handler.graph('ws-1', { sub: 'neighbors', anchor: 'FR-core-engine-001', edges: e }, 'C:/repo/x'),
      ).rejects.toMatchObject({ code: 'validation_rejected' });
    }
    expect(bad.sillyspecCmd).not.toHaveBeenCalled();
  });

  it('⑤ depth 0/4 钳 1/3、limit 0/99 钳 1/50、非整数拒、search 201 字符拒 200 放行', async () => {
    const { handler, sillyspecCmd } = mk({ ok: true, stdout: GRAPH_OK(), stderr: '', timedOut: false });
    const lastCmd = (): string => String(sillyspecCmd.mock.calls[sillyspecCmd.mock.calls.length - 1]?.[0]);
    await handler.graph('ws-1', { sub: 'neighbors', anchor: 'FR-core-engine-001', depth: 0 }, 'C:/repo/x');
    expect(lastCmd()).toContain('--depth 1');
    await handler.graph('ws-1', { sub: 'neighbors', anchor: 'FR-core-engine-001', depth: 4 }, 'C:/repo/x');
    expect(lastCmd()).toContain('--depth 3');
    await handler.graph('ws-1', { sub: 'nodes', search: '知识', limit: 0 }, 'C:/repo/x');
    expect(lastCmd()).toContain('--limit 1');
    await handler.graph('ws-1', { sub: 'nodes', search: '知识', limit: 99 }, 'C:/repo/x');
    expect(lastCmd()).toContain('--limit 50');

    const bad = mk({ ok: true, stdout: GRAPH_OK(), stderr: '', timedOut: false });
    await expect(
      bad.handler.graph('ws-1', { sub: 'neighbors', anchor: 'FR-core-engine-001', depth: 'x' }, 'C:/repo/x'),
    ).rejects.toMatchObject({ code: 'validation_rejected' });
    await expect(
      bad.handler.graph('ws-1', { sub: 'nodes', search: 'a'.repeat(201) }, 'C:/repo/x'),
    ).rejects.toMatchObject({ code: 'validation_rejected' });
    expect(bad.sillyspecCmd).not.toHaveBeenCalled();
    // 200 字符边界放行（黑名单字符零命中前提下）
    const ok200 = mk({ ok: true, stdout: GRAPH_OK(), stderr: '', timedOut: false });
    await ok200.handler.graph('ws-1', { sub: 'nodes', search: '知'.repeat(200) }, 'C:/repo/x');
    expect(ok200.sillyspecCmd).toHaveBeenCalledOnce();
  });

  it('⑥ 命令拼装：引号锚点/--json/--clusters 50/--search 引号包裹（全字面断言）', async () => {
    const { handler, sillyspecCmd } = mk({ ok: true, stdout: GRAPH_OK(), stderr: '', timedOut: false });
    const cmdOf = async (query: Parameters<KnowledgeGovernanceHandler['graph']>[1]): Promise<string> => {
      await handler.graph('ws-1', query, 'C:/repo/x');
      return String(sillyspecCmd.mock.calls[sillyspecCmd.mock.calls.length - 1]?.[0]);
    };
    expect(await cmdOf({ sub: 'neighbors', anchor: 'decision:decisions/unmapped.md#D-002@v2', edges: 'all', depth: 2 })).toBe(
      'sillyspec knowledge graph neighbors "decision:decisions/unmapped.md#D-002@v2" --edges all --depth 2 --json',
    );
    expect(await cmdOf({ sub: 'path', anchor: 'FR-core-engine-001', anchor2: '2026-10-08-x' })).toBe(
      'sillyspec knowledge graph path "FR-core-engine-001" "2026-10-08-x" --json',
    );
    expect(await cmdOf({ sub: 'summary' })).toBe('sillyspec knowledge graph summary --clusters 50 --json');
    expect(await cmdOf({ sub: 'nodes', search: 'D-002', limit: 20 })).toBe(
      'sillyspec knowledge graph nodes --search "D-002" --limit 20 --json',
    );
  });

  it('⑦ 旧 CLI 三态：全无 graph → cli_subcommand_missing（usage 文本/unknown_subcommand 信封）', async () => {
    // exit≠0 + usage 文本（digest 先例同款探测）
    const t1 = mk({ ok: false, stdout: '用法: sillyspec knowledge <子命令>…', stderr: '', timedOut: false });
    await expect(t1.handler.graph('ws-1', { sub: 'summary' }, 'C:/repo/x')).rejects.toMatchObject({
      code: 'cli_subcommand_missing',
    });
    // exit≠0 + 信封 code=unknown_subcommand
    const t2 = mk({ ok: false, stdout: JSON.stringify({ ok: false, error: { code: 'unknown_subcommand' } }), stderr: '', timedOut: false });
    await expect(t2.handler.graph('ws-1', { sub: 'orphans' }, 'C:/repo/x')).rejects.toMatchObject({
      code: 'cli_subcommand_missing',
    });
    // exit 0 + ok:false 信封 unknown_subcommand（graph_usage 同为 exit 0 形态）
    const t3 = mk({ ok: true, stdout: JSON.stringify({ ok: false, error: { code: 'unknown_subcommand' } }), stderr: '', timedOut: false });
    await expect(t3.handler.graph('ws-1', { sub: 'dangling' }, 'C:/repo/x')).rejects.toMatchObject({
      code: 'cli_subcommand_missing',
    });
  });

  it('⑦ 旧 CLI 三态：有 graph 缺 summary/nodes → cli_feature_missing:<sub>（graph_usage echo/usage 无该子命令）', async () => {
    // echo subcommand=summary（CLI 收到 token 但不识别）
    const t1 = mk({ ok: true, stdout: GRAPH_USAGE_ERR({ subcommand: 'summary' }), stderr: '', timedOut: false });
    await expect(t1.handler.graph('ws-1', { sub: 'summary' }, 'C:/repo/x')).rejects.toMatchObject({
      code: 'cli_feature_missing:summary',
    });
    // usage 列表无 nodes（无 echo 字段，输出无该子命令痕迹）
    const t2 = mk({
      ok: true,
      stdout: GRAPH_USAGE_ERR({ usage: '用法：sillyspec knowledge graph <neighbors|path|impact|orphans|dangling> [锚点...]' }),
      stderr: '',
      timedOut: false,
    });
    await expect(t2.handler.graph('ws-1', { sub: 'nodes' }, 'C:/repo/x')).rejects.toMatchObject({
      code: 'cli_feature_missing:nodes',
    });
    // 非 summary/nodes 子命令的 graph_usage → internal（cli_feature_missing 仅 summary/nodes 专属）
    const t3 = mk({ ok: true, stdout: GRAPH_USAGE_ERR({ subcommand: 'neighbors' }), stderr: '', timedOut: false });
    await expect(t3.handler.graph('ws-1', { sub: 'neighbors', anchor: 'FR-core-engine-001' }, 'C:/repo/x')).rejects.toMatchObject({
      code: 'internal',
    });
  });

  it('⑧ ok:false 信封（node_not_found）→ internal；非 JSON → internal；超时 → timeout', async () => {
    const t1 = mk({ ok: true, stdout: JSON.stringify({ ok: false, error: { code: 'node_not_found', key: 'x' } }), stderr: '', timedOut: false });
    await expect(t1.handler.graph('ws-1', { sub: 'neighbors', anchor: 'nope' }, 'C:/repo/x')).rejects.toMatchObject({
      code: 'internal',
    });
    const t2 = mk({ ok: true, stdout: 'not json', stderr: '', timedOut: false });
    await expect(t2.handler.graph('ws-1', { sub: 'orphans' }, 'C:/repo/x')).rejects.toMatchObject({ code: 'internal' });
    const t3 = mk({ ok: false, stdout: '', stderr: '', timedOut: true });
    await expect(t3.handler.graph('ws-1', { sub: 'dangling' }, 'C:/repo/x')).rejects.toMatchObject({ code: 'timeout' });
  });

  it('⑨ orphans/dangling items>50 → 截 50 且 count 保真（≤50 不动）', async () => {
    const bigList = (key: 'orphans' | 'dangling'): string =>
      JSON.stringify({
        ok: true,
        query: { sub: key },
        count: 1234,
        summary: ['⚠️ 清单很长'],
        [key]: Array.from({ length: 120 }, (_, i) => ({
          id: `decision:decisions/x.md#D-${i}@v1`,
          type: 'decision',
          kind: key === 'orphans' ? 'zero-degree' : 'anchors',
        })),
      });
    const o = mk({ ok: true, stdout: bigList('orphans'), stderr: '', timedOut: false });
    const ro = (await o.handler.graph('ws-1', { sub: 'orphans' }, 'C:/repo/x')).graph as {
      count: number; orphans: { id: string }[];
    };
    expect(ro.orphans).toHaveLength(50);
    expect(ro.orphans[0]?.id).toBe('decision:decisions/x.md#D-0@v1');
    expect(ro.orphans[49]?.id).toBe('decision:decisions/x.md#D-49@v1');
    expect(ro.count).toBe(1234); // count 保真不截

    const d = mk({ ok: true, stdout: bigList('dangling'), stderr: '', timedOut: false });
    const rd = (await d.handler.graph('ws-1', { sub: 'dangling' }, 'C:/repo/x')).graph as {
      count: number; dangling: unknown[];
    };
    expect(rd.dangling).toHaveLength(50);
    expect(rd.count).toBe(1234);

    // ≤50 原样透传（不误截）
    const small = mk({ ok: true, stdout: GRAPH_OK({ count: 4, orphans: [{ id: 'a' }, { id: 'b' }] }), stderr: '', timedOut: false });
    const rs = (await small.handler.graph('ws-1', { sub: 'orphans' }, 'C:/repo/x')).graph as {
      count: number; orphans: unknown[];
    };
    expect(rs.orphans).toHaveLength(2);
    expect(rs.count).toBe(4);
  });

  it('root 防线复用：越界/缺省 → forbidden 且不 spawn（digest 同款两道防线）', async () => {
    const { handler, sillyspecCmd } = mk({ ok: true, stdout: GRAPH_OK(), stderr: '', timedOut: false });
    await expect(handler.graph('ws-1', { sub: 'summary' }, 'D:/outside/repo')).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(handler.graph('ws-1', { sub: 'summary' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(handler.graph('ws-1', { sub: 'summary' }, '')).rejects.toMatchObject({ code: 'forbidden' });
    expect(sillyspecCmd).not.toHaveBeenCalled();
  });
});
