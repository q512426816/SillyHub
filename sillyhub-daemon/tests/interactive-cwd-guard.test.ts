// tests/interactive-cwd-guard.test.ts
// 2026-08-28-fix-cross-machine-worker-dispatch task-05：daemon 交互会话 cwd 守卫纯函数
// （src/interactive-cwd-guard.ts / FR-05 / NFR-01 / D-004@v1）。
// 覆盖：三形态（通过 / forbidden / not_found）× 双 OS 路径形态（IS_WIN 条件构造，
// 对齐 file-rpc.test.ts 风格）+ 双违反 forbidden 优先 + roots 空数组兜底拒绝。
// 纯函数直测，不依赖真实 lease/daemon 实例；白名单口径断言复用
// assertWithinAllowedRoots 的实际行为（空 roots 抛 forbidden —— 已按源码核实）。

import { describe, it, expect } from 'vitest';
import { platform } from 'node:os';
import {
  checkWorkspaceBoundCwd,
  type CwdGuardVerdict,
} from '../src/interactive-cwd-guard';

const IS_WIN = platform() === 'win32';

/** 断言拒绝形态并返回窄化后的 code/message（三形态用例共用）。 */
function expectRejected(
  v: CwdGuardVerdict,
): { code: 'cwd_forbidden' | 'cwd_not_found'; message: string } {
  if (v.ok) {
    throw new Error('expected rejected verdict but got ok:true');
  }
  return v;
}

/** 主 describe 的路径形态：按运行平台构造（Windows 盘符反斜杠 / POSIX 绝对路径）。 */
const P = IS_WIN
  ? {
      root: 'C:\\home\\x',
      inside: 'C:\\home\\x\\sub',
      outside: 'C:\\etc',
    }
  : {
      root: '/home/x',
      inside: '/home/x/sub',
      outside: '/etc',
    };

describe('checkWorkspaceBoundCwd — 三形态主用例（按运行平台构造路径形态）', () => {
  it('通过：cwd 在白名单根内且存在 → { ok: true }', () => {
    const v = checkWorkspaceBoundCwd(P.inside, true, [P.root]);
    expect(v).toEqual({ ok: true });
  });

  it('forbidden：cwd 越界 → cwd_forbidden，message 中文且含 cwd 原文与「超出白名单」', () => {
    const v = expectRejected(
      checkWorkspaceBoundCwd(P.outside, true, [P.root]),
    );
    expect(v.code).toBe('cwd_forbidden');
    // message 含 cwd 原文（含正则元字符也用 toContain 字面量比较，不用 toMatch）
    expect(v.message).toContain(P.outside);
    expect(v.message).toContain('超出');
    expect(v.message).toContain('白名单');
    // 完整模板与 spec 一致（中文、含 cwd、含原因与「拒绝启动分身会话」）
    expect(v.message).toBe(
      `会话工作目录 ${P.outside} 超出本机 allowed_roots 白名单，可能为错机派发或机器白名单配置变更，拒绝启动分身会话`,
    );
  });

  it('not_found：cwd 在根内但 exists=false → cwd_not_found，message 明示拒绝自动创建目录', () => {
    const v = expectRejected(
      checkWorkspaceBoundCwd(P.inside, false, [P.root]),
    );
    expect(v.code).toBe('cwd_not_found');
    expect(v.message).toContain(P.inside);
    expect(v.message).toContain('不存在');
    expect(v.message).toContain('拒绝自动创建目录');
    expect(v.message).toBe(
      `会话工作目录 ${P.inside} 不存在，可能为错机派发或工作区绑定机器路径错配，daemon 拒绝自动创建目录，拒绝启动分身会话`,
    );
  });

  it('双违反（越界且不存在）→ forbidden 优先（白名单终检先行，统一口径）', () => {
    const v = expectRejected(
      checkWorkspaceBoundCwd(P.outside, false, [P.root]),
    );
    expect(v.code).toBe('cwd_forbidden');
    expect(v.message).toContain(P.outside);
  });

  it('roots 空数组 → cwd_forbidden（assertWithinAllowedRoots 空 roots 兜底拒，exists=true 佐证非存在性拒绝）', () => {
    const v = expectRejected(checkWorkspaceBoundCwd(P.inside, true, []));
    expect(v.code).toBe('cwd_forbidden');
    expect(v.message).toContain(P.inside);
  });
});

describe.skipIf(!IS_WIN)('checkWorkspaceBoundCwd — Windows 盘符形态专属', () => {
  it('盘符大小写归一：大写盘符路径命中小写白名单根 → 通过', () => {
    // normalizeCase 仅归一盘符，isPathUnderAnyRoot 对 Windows 形态整体小写比较
    const v = checkWorkspaceBoundCwd('C:\\WS\\proj', true, ['c:\\ws']);
    expect(v).toEqual({ ok: true });
  });

  it('跨盘符越界：cwd 在 D: 盘而根在 C: 盘 → cwd_forbidden', () => {
    const v = expectRejected(
      checkWorkspaceBoundCwd('D:\\ws\\proj', true, ['C:\\ws']),
    );
    expect(v.code).toBe('cwd_forbidden');
    expect(v.message).toContain('D:\\ws\\proj');
  });

  it('反斜杠边界敏感：兄弟撞名（C:\\ws-evil 不匹配 C:\\ws）→ cwd_forbidden', () => {
    const v = expectRejected(
      checkWorkspaceBoundCwd('C:\\ws-evil\\proj', true, ['C:\\ws']),
    );
    expect(v.code).toBe('cwd_forbidden');
  });
});

describe('checkWorkspaceBoundCwd — POSIX 绝对路径形态（双平台均可跑）', () => {
  // Windows 上 POSIX 形态经 pathResolve 落到当前盘符（/home/x → <盘>:\home\x），
  // 两路径同源解析，包含语义不变，故本 describe 不做平台跳过。

  it('通过：/home/x/sub 在根 /home/x 内 → { ok: true }', () => {
    const v = checkWorkspaceBoundCwd('/home/x/sub', true, ['/home/x']);
    expect(v).toEqual({ ok: true });
  });

  it('forbidden：/etc 越出根 /home/x → cwd_forbidden', () => {
    const v = expectRejected(checkWorkspaceBoundCwd('/etc', true, ['/home/x']));
    expect(v.code).toBe('cwd_forbidden');
    expect(v.message).toContain('/etc');
  });

  it('not_found：/home/x/missing 在根内但 exists=false → cwd_not_found', () => {
    const v = expectRejected(
      checkWorkspaceBoundCwd('/home/x/missing', false, ['/home/x']),
    );
    expect(v.code).toBe('cwd_not_found');
    expect(v.message).toContain('/home/x/missing');
  });
});
