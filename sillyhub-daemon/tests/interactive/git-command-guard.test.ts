/**
 * interactive/git-command-guard 单测（2026-11-06-session-git-approval task-07）。
 *
 * 只测 task-01 纯函数：detectGitWriteIntent（拆段识别/解析）与 resolveDefaultSelection
 *（D-012 四分支）。纯字符串用例——不 spawn 子进程、不建真实 git 仓、不依赖平台路径。
 *
 * 覆盖（= task-07 acceptance 逐条）：
 *   1. 复合命令绕过形态 && / ; / || / |（R-01：`git add ... && git commit` 前缀绕过回归锚）；
 *   2. sillyspec push 参数矩阵（≥4 拦截例 + 三不拦 --dry-run/--no-push/--undo，D-013）；
 *   3. 不拦清单 ≥6 例（D-003：git add/status/log/diff/merge/非 git/空串）；
 *   4. -m 多段拼接 / pathspec / -a / -C / push 缺省与显式 remote-ref；
 *   5. resolveDefaultSelection 四分支（D-012）。
 */
import { describe, expect, it } from 'vitest';

import {
  detectGitWriteIntent,
  resolveDefaultSelection,
  type GitCommandIntent,
  type WorkspaceStatus,
} from '../../src/interactive/git-command-guard.js';

const STATUS: WorkspaceStatus = {
  files: [
    { path: 'a.py', status: 'modified', staged: true },
    { path: 'b.py', status: 'modified', staged: false },
    { path: 'new.txt', status: 'untracked', staged: false },
  ],
};

/** 便捷：断言命中并返回 intent。 */
function hit(command: string): GitCommandIntent {
  const intent = detectGitWriteIntent(command);
  expect(intent).not.toBeNull();
  return intent!;
}

describe('detectGitWriteIntent · 复合命令拆段（R-01 绕过回归锚）', () => {
  it('git add . && git commit —— 前缀段不造成漏判（知识库实证坑）', () => {
    const i = hit('git add . && git commit -m "feat: x"');
    expect(i.operation).toBe('commit');
    expect(i.message).toBe('feat: x');
  });

  it('; 分隔段命中', () => {
    expect(hit('echo build; git push origin main').operation).toBe('push');
  });

  it('|| 分隔段命中（前段失败回退分支）', () => {
    const i = hit('git push --dry-run || git push');
    // --dry-run 段不拦，命中的是第二段 git push。
    expect(i.command).toBe('git push');
  });

  it('| 管道段命中', () => {
    expect(hit('git status | grep x; git commit -m y').operation).toBe('commit');
  });

  it('换行分隔段命中', () => {
    expect(hit('git add a.py\ngit commit -m z').operation).toBe('commit');
  });

  it('引号内的分隔符不拆（-m "a && b" 整体为 msg）', () => {
    const i = hit('git commit -m "a && b; c"');
    expect(i.message).toBe('a && b; c');
  });
});

describe('detectGitWriteIntent · sillyspec push 参数矩阵（D-013）', () => {
  it('默认形态拦（runner=sillyspec，command 为命中段原文）', () => {
    const i = hit('sillyspec push');
    expect(i).toMatchObject({ operation: 'push', runner: 'sillyspec', command: 'sillyspec push' });
  });

  it('--mode one 拦', () => {
    expect(hit('sillyspec push --mode one --change foo').runner).toBe('sillyspec');
  });

  it('--remote origin 拦并解析 remote', () => {
    expect(hit('sillyspec push --remote origin').pushTarget).toEqual({ remote: 'origin', ref: null });
  });

  it('--branch main 拦并解析 ref', () => {
    expect(hit('sillyspec push --branch=main').pushTarget).toEqual({ remote: null, ref: 'main' });
  });

  it('--dry-run 不拦（只输出计划）', () => {
    expect(detectGitWriteIntent('sillyspec push --dry-run')).toBeNull();
  });

  it('--no-push 不拦（只压扁不推送）', () => {
    expect(detectGitWriteIntent('sillyspec push --no-push')).toBeNull();
  });

  it('--undo 不拦（恢复压扁不推送）', () => {
    expect(detectGitWriteIntent('sillyspec push --undo')).toBeNull();
  });

  it('sillyspec 非 push 子命令不拦', () => {
    expect(detectGitWriteIntent('sillyspec status --json')).toBeNull();
  });
});

describe('detectGitWriteIntent · 不拦清单（D-003）', () => {
  const passthrough = [
    'git add .',
    'git status',
    'git log --oneline -5',
    'git diff HEAD',
    'git merge feature/x',
    'git rebase main',
    'git reset --soft HEAD~1',
    'npm test',
    '',
  ];
  for (const cmd of passthrough) {
    it(`不拦：${cmd || '(空串)'}`, () => {
      expect(detectGitWriteIntent(cmd)).toBeNull();
    });
  }
});

describe('detectGitWriteIntent · commit 解析', () => {
  it('-m 多段拼接（空格连接）', () => {
    const i = hit('git commit -m "feat: x" -m "body line"');
    expect(i.message).toBe('feat: x body line');
  });

  it('-m 连写形态 -m<msg>', () => {
    expect(hit('git commit -mfix:quick').message).toBe('fix:quick');
  });

  it('--message= 形态', () => {
    expect(hit('git commit --message="docs: readme"').message).toBe('docs: readme');
  });

  it('pathspec 位置参数 + -- 后全为 pathspec', () => {
    const i = hit('git commit -m x -- a.py "b c.py"');
    expect(i.pathspec).toEqual(['a.py', 'b c.py']);
  });

  it('无 pathspec 时为 null', () => {
    expect(hit('git commit -m x').pathspec).toBeNull();
  });

  it('-a → allTracked=true', () => {
    expect(hit('git commit -a -m x').allTracked).toBe(true);
  });

  it('-F <file> → messageFile 携带路径、message 空（挂载层读内容）', () => {
    const i = hit('git commit -F .git/MSG');
    expect(i.messageFile).toBe('.git/MSG');
    expect(i.message).toBe('');
  });

  it('常见带值 flag 不误收为 pathspec（--author 等）', () => {
    const i = hit('git commit -m x --author "a <a@b.c>" -q');
    expect(i.pathspec).toBeNull();
  });
});

describe('detectGitWriteIntent · -C 与 push 解析', () => {
  it('git -C <path> commit → workDir 记录', () => {
    const i = hit('git -C /repo/wt commit -m x');
    expect(i.workDir).toBe('/repo/wt');
    expect(i.operation).toBe('commit');
  });

  it('git -C <path> push', () => {
    expect(hit('git -C /repo/wt push').workDir).toBe('/repo/wt');
  });

  it('push 缺省 remote/ref 为 null（默认 origin+当前分支）', () => {
    const i = hit('git push');
    expect(i.pushTarget).toEqual({ remote: null, ref: null });
  });

  it('push 显式 remote+ref', () => {
    expect(hit('git push upstream dev').pushTarget).toEqual({ remote: 'upstream', ref: 'dev' });
  });

  it('push 带值 flag（-u origin）不误收 remote/ref', () => {
    const i = hit('git push -u origin');
    expect(i.pushTarget).toEqual({ remote: null, ref: null });
  });

  it('引号包裹的绝对路径 git 可执行名（含空格/含 .exe）识别', () => {
    expect(hit('"C:/Program Files/Git/bin/git.exe" commit -m x').operation).toBe('commit');
  });
});

describe('resolveDefaultSelection · D-012 四分支', () => {
  const intent = (over: Partial<GitCommandIntent>): GitCommandIntent => ({
    operation: 'commit',
    runner: 'git',
    command: 'git commit -m x',
    message: 'x',
    messageFile: null,
    pathspec: null,
    allTracked: false,
    pushTarget: { remote: null, ref: null },
    workDir: null,
    ...over,
  });

  it('① 命令带 pathspec → 勾 pathspec ∩ 改动', () => {
    const s = resolveDefaultSelection(intent({ pathspec: ['a.py', '不存在.md'] }), STATUS);
    expect([...s]).toEqual(['a.py']);
  });

  it('② -a → 勾全部 tracked（非 untracked）', () => {
    const s = resolveDefaultSelection(intent({ allTracked: true }), STATUS);
    expect([...s].sort()).toEqual(['a.py', 'b.py']);
  });

  it('③ 都无 → 勾当前暂存区', () => {
    const s = resolveDefaultSelection(intent({}), STATUS);
    expect([...s]).toEqual(['a.py']);
  });

  it('④ 暂存区空 → 勾全部改动', () => {
    const noStaged: WorkspaceStatus = {
      files: [
        { path: 'a.py', status: 'modified', staged: false },
        { path: 'new.txt', status: 'untracked', staged: false },
      ],
    };
    const s = resolveDefaultSelection(intent({}), noStaged);
    expect([...s].sort()).toEqual(['a.py', 'new.txt']);
  });
});
