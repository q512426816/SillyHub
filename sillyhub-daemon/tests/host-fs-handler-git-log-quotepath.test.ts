// tests/host-fs-handler-git-log-quotepath.test.ts
// task-03（2026-10-21-gitlog-quotepath-fix / FR-01 FR-03）：真实 git 集成实测——
// 不 mock execFile，在真实临时仓提交含中文目录的文件，验证全链路：
//   ① gitShow 返回解码后中文原文路径（修复前为 C 引号八进制转义形态）；
//   ② gitDiffFile 以该中文 pathspec 回查返回非空 unified diff
//     （修复前转义串失配 → exit 0 空输出 → 前端「（无差异内容）」）；
//   ③ 真实 git 强制 quotepath=true 的 C 引号输出经 decodeGitCQuote 解码后
//     与真实路径逐字符相等（显式 -c true 不受宿主全局 config 影响，任意平台确定性）；
//   ④ gitStatus 对中文 untracked 文件计数正确（porcelain/diff 调用 quotepath=false 全链路）。
//
// 与 host-fs-handler-git-log.test.ts（mock execFile 队列，断言命令构造逐 token）
// 互补：本文件走真实 git 子进程，覆盖「命令构造 → 真实输出 → 解码回传」；
// 需要宿主机装有 git（daemon 的宿主运行前提，同 explorer/worktree 面）。

import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HostFsHandler, decodeGitCQuote } from '../src/host-fs-handler';

/** 真实执行 git（utf8；失败 reject 且 err 上挂 stdout/stderr 便于排查）。 */
function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], { encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        (err as Error & { stdout: string; stderr: string }).stdout = String(stdout);
        (err as Error & { stderr: string }).stderr = String(stderr);
        reject(err);
      } else {
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    });
  });
}

/** 真实形态的中文目录路径（对齐 2026-10-20 公司仓实证案例的形态）。 */
const CN_DIR = '.sillyspec/changes/2026-10-20-unitLedger导入模板框线';
const CN_FILE = `${CN_DIR}/design.md`;
const FILE_BODY = '第一行新增内容\n第二行中文行\nthird ascii line\n';

/** 搭真实临时仓：init → local identity → 中文目录文件真实提交。 */
async function makeCnRepo(): Promise<string> {
  // realpath 归一（macOS /var → /private/var）：rootsProvider 与 daemon 内部
  // pathResolve 必须指向同一真实目录，否则 assertWithinAllowedRoots 误拒。
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sillyhub-cnquote-')));
  await mkdir(join(root, CN_DIR), { recursive: true });
  await writeFile(join(root, CN_FILE), FILE_BODY, 'utf8');
  await git(root, ['init', '-q']);
  await git(root, ['config', 'user.name', '琴忆']);
  await git(root, ['config', 'user.email', 'qinyi@example.com']);
  await git(root, ['add', '--', CN_FILE]);
  await git(root, ['commit', '-q', '-m', 'feat: 中文目录真实提交']);
  return root;
}

describe('真实 git 集成 —— 非 ASCII 路径（2026-10-21-gitlog-quotepath-fix，FR-01/FR-03）', () => {
  const roots: string[] = [];
  let handler: HostFsHandler;

  const makeHandler = async (): Promise<string> => {
    const root = await makeCnRepo();
    roots.push(root);
    handler = new HostFsHandler({ rootsProvider: () => [root] });
    return root;
  };

  afterEach(async () => {
    await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
    roots.length = 0;
  });

  it('① gitShow 解码中文原文路径 + ② gitDiffFile 以中文 pathspec 回查非空 diff', async () => {
    const root = await makeHandler();
    const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();

    const shown = await handler.gitShow({ root, sha: head });
    expect(shown.error).toBeNull();
    expect(shown.files).toHaveLength(1);
    // 解码路径与真实路径逐字符相等（修复前：带引号 + \345 八进制转义形态）。
    expect(shown.files[0].path).toBe(CN_FILE);
    expect(shown.files[0].add).toBe(3);
    expect(shown.files[0].del).toBe(0);
    expect(shown.files[0].binary).toBe(false);

    // 回查（前端点击叶子的等价链路）：中文 pathspec 命中真实文件。
    const diff = await handler.gitDiffFile({ root, sha: head, path: CN_FILE });
    expect(diff.error).toBeNull();
    expect(diff.binary).toBe(false);
    expect(diff.diff.length).toBeGreaterThan(0);
    expect(diff.diff).toContain('+第一行新增内容');
  });

  it('③ 真实 git 强制 quotepath 的 C 引号输出经 decodeGitCQuote 与真实路径逐字符相等', async () => {
    const root = await makeHandler();
    const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
    // 显式 -c core.quotepath=true 强制 C 引号形态（覆盖宿主全局 config，确定性复现）。
    const r = await git(root, [
      '-c',
      'core.quotepath=true',
      'show',
      '--numstat',
      '--no-renames',
      '--pretty=format:%x1e',
      head,
    ]);
    const line = r.stdout.split('\n').find((l) => /^\d+\t\d+\t/.test(l));
    expect(line).toBeDefined();
    const rawPath = line!.split('\t')[2] ?? '';
    // 前提自检：真实输出确为 C 引号 + 八进制转义形态（即修复前透传给前端的串）。
    expect(rawPath.startsWith('"')).toBe(true);
    expect(rawPath).toContain('\\345');
    // 解码后与真实路径逐字符相等。
    expect(decodeGitCQuote(rawPath)).toBe(CN_FILE);
  });

  it('④ gitStatus 对中文 untracked 文件计数正确（porcelain quotepath=false 全链路）', async () => {
    const root = await makeHandler();
    await writeFile(join(root, '中文未跟踪.md'), '未提交内容\n', 'utf8');
    const st = await handler.gitStatus({ root });
    expect(st.error).toBeNull();
    expect(st.empty).toBe(false);
    expect(st.untracked_count).toBe(1);
    expect(st.files_changed).toBe(0);
    expect(st.additions).toBe(0);
    expect(st.deletions).toBe(0);
  });
});
