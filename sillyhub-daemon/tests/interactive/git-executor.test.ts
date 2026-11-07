/**
 * interactive/git-executor 单测（2026-11-06-session-git-approval task-08）。
 *
 * execFile 全程注入 fixture（不起真 git 子进程）——按 args 关键词路由返回
 * porcelain/numstat/rev-parse/push 输出，断言命令序列与结果文本。
 *
 * 覆盖（= task-08 acceptance 逐条）：
 *   1. 精确重整语义（D-018）：reset 仅「已暂存但未勾选」、add 仅「勾选但未暂存」、
 *      禁止裸 reset——共享暂存区他人 staged 不被卷入提交；
 *   2. commit 成败路径（R-04 文件集回喂 / R-05 stderr 原样）；
 *   3. push runner 分流（git 缺省补 origin+当前分支；sillyspec 原样 argv +
 *      Windows shim 经 process.execPath）；
 *   4. reject 零 git 调用（D-007：不动暂存区）。
 */
import { describe, expect, it } from 'vitest';

import { executeGitApproval, type GitExecExecFile } from '../../src/interactive/git-executor.js';
import { detectGitWriteIntent } from '../../src/interactive/git-command-guard.js';

const NUL = '\0';

/** 记录调用 + 按关键词路由的 fixture 执行器。 */
function makeRecorder(routes: Array<{ match: (args: string[]) => boolean; stdout?: string; reject?: boolean }>) {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const exec: GitExecExecFile = async (cmd, args) => {
    calls.push({ cmd, args });
    for (const r of routes) {
      if (r.match(args)) {
        if (r.reject) {
          const err = new Error('fixture git failure') as Error & { stderr?: string };
          err.stderr = 'fixture: remote rejected (pre-receive hook declined)';
          throw err;
        }
        return { stdout: r.stdout ?? '', stderr: '' };
      }
    }
    return { stdout: '', stderr: '' };
  };
  return { exec, calls };
}

function intentOf(command: string) {
  const i = detectGitWriteIntent(command);
  expect(i).not.toBeNull();
  return i!;
}

const CTX_OVERRIDES = { cwd: 'C:/repo', sessionId: 's-1' };

/** porcelain fixture：staged={a.py, other.py}，未暂存={c.py}，untracked={new.txt}。 */
const PORCELAIN = [
  '# branch.head main',
  `1 M. N... 100644 100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} a.py`,
  `1 A. N... 100644 100644 100644 ${'a'.repeat(40)} ${'b'.repeat(40)} other.py`,
  `1 .M N... 100644 100644 100644 ${'c'.repeat(40)} ${'d'.repeat(40)} c.py`,
  '? new.txt',
].join(NUL) + NUL;

function baseRecorder(over: { commitReject?: boolean; pushStderr?: string } = {}) {
  return makeRecorder([
    { match: (a) => a.includes('status') && a.includes('--porcelain=v2'), stdout: PORCELAIN },
    { match: (a) => a.includes('rev-parse') && a.includes('--short'), stdout: 'abc1234\n' },
    { match: (a) => a.includes('rev-parse') && a.includes('--abbrev-ref'), stdout: 'main\n' },
    { match: (a) => a.includes('commit'), reject: over.commitReject },
    { match: (a) => a.includes('push'), stdout: '', ...(over.pushStderr ? {} : {}) },
  ]);
}

describe('executeGitApproval · commit 精确重整（D-018）', () => {
  it('reset 仅「已暂存但未勾选」、add 仅「勾选但未暂存」、无裸 reset；成功回喂 sha+文件集', async () => {
    const r = baseRecorder();
    // 勾选：a.py（已暂存）+ c.py（未暂存）；other.py（他人已暂存，未勾）应被 reset。
    const result = await executeGitApproval(
      intentOf('git commit -m 原msg'),
      { action: 'approve', message: '用户改写 msg', selectedFiles: ['a.py', 'c.py'] },
      { ...CTX_OVERRIDES, execFile: r.exec },
    );
    const resetCall = r.calls.find((c) => c.args.includes('reset'));
    expect(resetCall?.args).toEqual(expect.arrayContaining(['reset', '-q', '--', 'other.py']));
    expect(resetCall?.args).not.toContain('a.py'); // 已暂存且勾选的不动
    const addCall = r.calls.find((c) => c.args.includes('add'));
    expect(addCall?.args).toEqual(expect.arrayContaining(['add', '--', 'c.py']));
    expect(addCall?.args).not.toContain('a.py'); // 已暂存且勾选的不重复 add
    const commitCall = r.calls.find((c) => c.args.includes('commit'));
    expect(commitCall?.args).toEqual(expect.arrayContaining(['commit', '-m', '用户改写 msg']));
    // identity per-invocation 注入（D-008 机制）。
    expect(commitCall?.args).toEqual(expect.arrayContaining([expect.stringContaining('user.name=')]));
    expect(result.ok).toBe(true);
    expect(result.sha).toBe('abc1234');
    expect(result.text).toContain('abc1234');
    expect(result.text).toContain('a.py');
    expect(result.text).toContain('c.py');
    expect(result.text).toContain('2 个文件');
  });

  it('全暂存一致（勾选=暂存集）→ 零 reset 零 add 直提交', async () => {
    const r = baseRecorder();
    await executeGitApproval(
      intentOf('git commit -m x'),
      { action: 'approve', message: 'x', selectedFiles: ['a.py', 'other.py'] },
      { ...CTX_OVERRIDES, execFile: r.exec },
    );
    expect(r.calls.find((c) => c.args.includes('reset'))).toBeUndefined();
    expect(r.calls.find((c) => c.args.includes('add'))).toBeUndefined();
    expect(r.calls.find((c) => c.args.includes('commit'))).toBeDefined();
  });

  it('commit 失败 → ok=false 且 text 含 stderr 原样（R-05）', async () => {
    const r = baseRecorder({ commitReject: true });
    const result = await executeGitApproval(
      intentOf('git commit -m x'),
      { action: 'approve', message: 'x', selectedFiles: ['a.py'] },
      { ...CTX_OVERRIDES, execFile: r.exec },
    );
    expect(result.ok).toBe(false);
    expect(result.text).toContain('pre-receive hook declined');
    expect(result.text).toContain('失败');
  });
});

describe('executeGitApproval · push runner 分流（D-013）', () => {
  it('runner=git：缺省 remote/ref → rev-parse 取当前分支 → push origin main', async () => {
    const r = baseRecorder();
    const result = await executeGitApproval(
      intentOf('git push'),
      { action: 'approve', message: '' },
      { ...CTX_OVERRIDES, execFile: r.exec },
    );
    const pushCall = r.calls.find((c) => c.args.includes('push'));
    expect(pushCall?.args).toEqual(expect.arrayContaining(['push', 'origin', 'main']));
    expect(result.ok).toBe(true);
    expect(result.text).toContain('origin/main');
  });

  it('runner=git：显式 remote/ref 透传', async () => {
    const r = baseRecorder();
    await executeGitApproval(
      intentOf('git push upstream dev'),
      { action: 'approve', message: '' },
      { ...CTX_OVERRIDES, execFile: r.exec },
    );
    expect(r.calls.find((c) => c.args.includes('push'))?.args).toEqual(
      expect.arrayContaining(['push', 'upstream', 'dev']),
    );
  });

  it('runner=sillyspec：原样 argv（零附加参数）；Windows 下经 process.execPath 跑 shim 解析的 js 入口', async () => {
    const r = baseRecorder();
    const result = await executeGitApproval(
      intentOf('sillyspec push --remote origin --branch main'),
      { action: 'approve', message: '' },
      { ...CTX_OVERRIDES, execFile: r.exec },
    );
    const call = r.calls.find((c) => c.args.includes('push'));
    expect(call).toBeDefined();
    if (process.platform === 'win32') {
      // Windows：cmd=process.execPath，args[0]=shim 解析的 js 入口（真实 PATH 解析），
      // 其后为原命令参数（零附加）。
      expect(call!.cmd).toBe(process.execPath);
      expect(call!.args[0]).toMatch(/sillyspec.*\.js$/i);
      expect(call!.args.slice(1)).toEqual(['push', '--remote', 'origin', '--branch', 'main']);
    } else {
      expect(call!.cmd).toBe('sillyspec');
      expect(call!.args).toEqual(['push', '--remote', 'origin', '--branch', 'main']);
    }
    expect(result.ok).toBe(true);
    expect(result.text).toContain('sillyspec push');
  });
});

describe('executeGitApproval · reject（D-007）', () => {
  it('零 git 调用（暂存区原样），text 含原因', async () => {
    const r = baseRecorder();
    const result = await executeGitApproval(
      intentOf('git commit -m x'),
      { action: 'reject', message: '', reason: '提交信息不符合规范' },
      { ...CTX_OVERRIDES, execFile: r.exec },
    );
    expect(r.calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.text).toContain('用户拒绝了本次提交');
    expect(result.text).toContain('提交信息不符合规范');
    expect(result.text).toContain('暂存区未改动');
  });
});
