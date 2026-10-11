/**
 * 关联仓双落盘例程测试（2026-10-10-workspec-maintenance task-04 / FR-03 / FR-07）。
 *
 * 覆盖：命令拼装（数组形参/正斜杠化/--repo 条件传参/不传 --role）、两层独立
 * 成败、skipped 三态（rel_path 缺省 / abs_path 缺省 / unknown command 需升级）、
 * failed 归一（超时 killed / 非零输出截断）、bin 缺失全 skipped、report 回调
 * （成功调用 / 抛错静默）、幂等重跑（纯函数无状态）。
 */

import { describe, expect, it, vi } from 'vitest';

import { runLinkedReposSync, type LinkedRepoSyncPayload } from '../src/linked-repos-sync.js';

interface Call {
  args: string[];
  cwd: string;
}

function makeExec(
  behavior: (call: Call) => { ok?: boolean; killed?: boolean; stdout?: string; stderr?: string } = () => ({ ok: true }),
) {
  const calls: Call[] = [];
  const exec = vi.fn(async (args: string[], cwd: string) => {
    calls.push({ args, cwd });
    const r = behavior({ args, cwd });
    if (r.ok !== false) return { stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    const err = new Error('exec failed') as Error & { killed?: boolean; stdout?: string; stderr?: string };
    err.killed = r.killed;
    err.stdout = r.stdout ?? '';
    err.stderr = r.stderr ?? '';
    throw err;
  });
  return { exec, calls };
}

const basePayload: LinkedRepoSyncPayload = {
  workspace_id: 'ws-1',
  root_path: 'C:/Users/me/works/platform',
  repos: [
    {
      name: 'platform-specs',
      rel_path: '..\\platform-specs',
      repo_url: 'git@example:specs.git',
      abs_path: 'C:\\Users\\me\\works\\platform-specs',
    },
  ],
};

describe('runLinkedReposSync', () => {
  it('命令拼装：数组形参、正斜杠化、--repo 条件传参、不传 --role', async () => {
    const { exec, calls } = makeExec();
    await runLinkedReposSync(basePayload, { resolveBin: () => '/bin/sillyspec.js', exec });
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual({
      args: [
        'workspace',
        'add',
        'platform-specs',
        '../platform-specs',
        '--repo',
        'git@example:specs.git',
      ],
      cwd: 'C:/Users/me/works/platform',
    });
    expect(calls[0].args).not.toContain('--role');
    expect(calls[1]).toEqual({
      args: ['local', 'register-repo', 'platform-specs', 'C:/Users/me/works/platform-specs'],
      cwd: 'C:/Users/me/works/platform',
    });
  });

  it('repo_url 缺省时不传 --repo', async () => {
    const { exec, calls } = makeExec();
    await runLinkedReposSync(
      { ...basePayload, repos: [{ name: 'a', rel_path: '../a' }] },
      { resolveBin: () => '/bin/s.js', exec },
    );
    expect(calls[0].args).toEqual(['workspace', 'add', 'a', '../a']);
  });

  it('两层独立 skipped：rel_path/abs_path 缺省', async () => {
    const { exec, calls } = makeExec();
    const out = await runLinkedReposSync(
      { ...basePayload, repos: [{ name: 'a' }] },
      { resolveBin: () => '/bin/s.js', exec },
    );
    expect(calls.length).toBe(0);
    expect(out.results).toEqual([
      { repo_name: 'a', layer: 'projects_yaml', status: 'skipped', detail: '未配置约定相对路径' },
      { repo_name: 'a', layer: 'repos_registry', status: 'skipped', detail: '本机路径未配置' },
    ]);
  });

  it('unknown command → skipped 需升级（FR-07）', async () => {
    const { exec } = makeExec(({ args }) =>
      args[0] === 'workspace' ? { ok: false, stderr: 'error: unknown command \'workspace\'' } : { ok: true },
    );
    const out = await runLinkedReposSync(basePayload, { resolveBin: () => '/bin/s.js', exec });
    const projects = out.results.find((r) => r.layer === 'projects_yaml')!;
    expect(projects.status).toBe('skipped');
    expect(projects.detail).toBe('sillyspec 需升级');
    expect(out.results.find((r) => r.layer === 'repos_registry')!.status).toBe('ok');
  });

  it('命令失败 → failed + 截断 detail；另一层不受影响', async () => {
    const { exec } = makeExec(({ args }) =>
      args[1] === 'register-repo'
        ? { ok: false, killed: true }
        : { ok: true },
    );
    const out = await runLinkedReposSync(basePayload, { resolveBin: () => '/bin/s.js', exec });
    expect(out.results.find((r) => r.layer === 'projects_yaml')!.status).toBe('ok');
    const repos = out.results.find((r) => r.layer === 'repos_registry')!;
    expect(repos.status).toBe('failed');
    expect(repos.detail).toContain('超时');
  });

  it('bin 缺失 → 全仓两层 skipped（能力缺失非错误）', async () => {
    const { exec, calls } = makeExec();
    const out = await runLinkedReposSync(
      { ...basePayload, repos: [{ name: 'a', rel_path: '../a', abs_path: 'C:/a' }] },
      { resolveBin: () => null, exec },
    );
    expect(calls.length).toBe(0);
    expect(out.results.every((r) => r.status === 'skipped')).toBe(true);
    expect(out.results.every((r) => r.detail === 'sillyspec 未安装')).toBe(true);
  });

  it('仓库名非法（运行时脏值）→ 双层 failed', async () => {
    const { exec, calls } = makeExec();
    const out = await runLinkedReposSync(
      // @ts-expect-error 运行时脏值防御测试
      { ...basePayload, repos: [{ name: 'bad name!' }] },
      { resolveBin: () => '/bin/s.js', exec },
    );
    expect(calls.length).toBe(0);
    expect(out.results.every((r) => r.status === 'failed')).toBe(true);
  });

  it('report 回调收到全部结果；抛错静默不炸', async () => {
    const { exec } = makeExec();
    const reportOk = vi.fn(async () => {});
    await runLinkedReposSync(basePayload, { resolveBin: () => '/bin/s.js', exec, report: reportOk });
    expect(reportOk).toHaveBeenCalledTimes(1);
    expect(reportOk.mock.calls[0][0].length).toBe(2);

    const reportBad = vi.fn(async () => {
      throw new Error('backend down');
    });
    const out = await runLinkedReposSync(basePayload, {
      resolveBin: () => '/bin/s.js',
      exec,
      report: reportBad,
    });
    expect(out.results.length).toBe(2); // 静默吞掉，结果仍在响应里
  });

  it('多仓串行执行（R-07：同机一次一条）', async () => {
    const order: string[] = [];
    const { exec } = makeExec(({ args }) => {
      order.push(args.join(' '));
      return { ok: true };
    });
    await runLinkedReposSync(
      {
        ...basePayload,
        repos: [
          { name: 'a', rel_path: '../a', abs_path: 'C:/a' },
          { name: 'b', rel_path: '../b', abs_path: 'C:/b' },
        ],
      },
      { resolveBin: () => '/bin/s.js', exec },
    );
    // 每仓先 projects 后 repos，仓间按序——无交错。
    expect(order).toEqual([
      'workspace add a ../a',
      'local register-repo a C:/a',
      'workspace add b ../b',
      'local register-repo b C:/b',
    ]);
  });
});

describe('R-07 失败重试一次', () => {
  it('第一次失败第二次成功 → ok（CLI 幂等重试）', async () => {
    let n = 0;
    const { exec } = makeExec(() => {
      n += 1;
      return n === 1 ? { ok: false, stderr: 'boom' } : { ok: true };
    });
    const out = await runLinkedReposSync(basePayload, { resolveBin: () => '/bin/s.js', exec });
    expect(out.results.find((r) => r.layer === 'projects_yaml')!.status).toBe('ok');
  });

  it('两次都失败 → failed（不无限重试）', async () => {
    const { exec, calls } = makeExec(({ args }) =>
      args[1] === 'register-repo' ? { ok: false, stderr: 'boom' } : { ok: true },
    );
    const out = await runLinkedReposSync(basePayload, { resolveBin: () => '/bin/s.js', exec });
    const repos = out.results.find((r) => r.layer === 'repos_registry')!;
    expect(repos.status).toBe('failed');
    // 恰好两次（1 首发 + 1 重试）
    expect(calls.filter((c) => c.args[1] === 'register-repo').length).toBe(2);
  });

  it('unsupported 不重试（需升级一次即定）', async () => {
    const { exec, calls } = makeExec(({ args }) =>
      args[0] === 'workspace' ? { ok: false, stderr: "error: unknown command 'workspace'" } : { ok: true },
    );
    const out = await runLinkedReposSync(basePayload, { resolveBin: () => '/bin/s.js', exec });
    expect(out.results.find((r) => r.layer === 'projects_yaml')!.status).toBe('skipped');
    expect(calls.filter((c) => c.args[0] === 'workspace').length).toBe(1);
  });

  // ── 2026-10-11-linked-repos-path-guard（24h 审查 P3-2：形态校验）──────────

  it('root_path 形态守卫：相对形态抛错零 spawn；POSIX/盘符/UNC 三绝对形态放行', async () => {
    const { exec, calls } = makeExec();
    for (const bad of ['ws-root', '../x', '']) {
      await expect(
        runLinkedReposSync({ ...basePayload, root_path: bad }, { resolveBin: () => '/bin/s.js', exec }),
      ).rejects.toThrow('非绝对路径');
    }
    expect(calls.length).toBe(0);
    // 三种绝对形态照常执行（每仓两层 → 仓×2 命令）。
    for (const good of ['/ws', 'C:/ws', '\\\\srv\\share\\ws']) {
      await runLinkedReposSync(
        { ...basePayload, root_path: good, repos: [{ name: 'a', rel_path: '../a', abs_path: 'C:/a' }] },
        { resolveBin: () => '/bin/s.js', exec },
      );
    }
    expect(calls.length).toBe(6);
  });

  it('rel_path 绝对形态：projects_yaml 层 failed 不 spawn（abs 合法层照常）', async () => {
    const { exec, calls } = makeExec();
    const out = await runLinkedReposSync(
      { ...basePayload, repos: [{ name: 'a', rel_path: 'C:/a', abs_path: 'C:/abs' }] },
      { resolveBin: () => '/bin/s.js', exec },
    );
    const proj = out.results.find((r) => r.layer === 'projects_yaml')!;
    expect(proj.status).toBe('failed');
    expect(proj.detail).toContain('须相对路径');
    expect(calls.length).toBe(1);
    expect(calls[0].args[0]).toBe('local');
  });

  it('abs_path 相对形态：repos_registry 层 failed 不 spawn（rel 合法层照常）', async () => {
    const { exec, calls } = makeExec();
    const out = await runLinkedReposSync(
      { ...basePayload, repos: [{ name: 'a', rel_path: '../a', abs_path: 'a/b' }] },
      { resolveBin: () => '/bin/s.js', exec },
    );
    const reg = out.results.find((r) => r.layer === 'repos_registry')!;
    expect(reg.status).toBe('failed');
    expect(reg.detail).toContain('须绝对路径');
    expect(calls.length).toBe(1);
    expect(calls[0].args[0]).toBe('workspace');
  });

  it('合法约定零回归：兄弟相对路径与绝对本机路径照常 spawn', async () => {
    const { exec, calls } = makeExec();
    await runLinkedReposSync(basePayload, { resolveBin: () => '/bin/s.js', exec });
    // '../platform-specs' 相对约定 + 绝对 abs_path 双层照常（既有 basePayload）。
    expect(calls.length).toBe(2);
    expect(calls[0].args[3]).toBe('../platform-specs');
    expect(calls[1].args[3]).toBe('C:/Users/me/works/platform-specs');
  });
});
