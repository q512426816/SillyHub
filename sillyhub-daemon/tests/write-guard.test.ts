// tests/write-guard.test.ts
// ql-20260702-006：write-guard Bash 间接写检测 + 显式写工具白名单

import { describe, it, expect } from 'vitest';
import { resolve, sep, join } from 'node:path';
import { isWriteWithinAllowedRoots } from '../src/interactive/write-guard.js';

// 跨平台：ROOT = 当前工作目录；INSIDE = ROOT 下子路径；OUTSIDE = 根外路径
const ROOT = resolve('.');
const INSIDE = join(ROOT, 'sub', 'file.txt');
const isWin = sep === '\\';
const OUTSIDE = isWin ? 'D:\\evil.txt' : '/tmp/evil_write_guard_test.txt';

describe('isWriteWithinAllowedRoots — Write/Edit/MultiEdit', () => {
  it('Write 在白名单内 → allow', () => {
    expect(isWriteWithinAllowedRoots('Write', { file_path: INSIDE }, [ROOT])).toBe(true);
  });
  it('Write 在白名单外 → deny', () => {
    expect(isWriteWithinAllowedRoots('Write', { file_path: OUTSIDE }, [ROOT])).toBe(false);
  });
  it('Read 工具不拦', () => {
    expect(isWriteWithinAllowedRoots('Read', { file_path: OUTSIDE }, [ROOT])).toBe(true);
  });
  it('allowedRoots 空 → 全放行', () => {
    expect(isWriteWithinAllowedRoots('Write', { file_path: OUTSIDE }, [])).toBe(true);
  });
});

describe('isWriteWithinAllowedRoots — Bash 间接写（ql-20260702-006）', () => {
  it('Bash 纯读命令 → allow（不拦读）', () => {
    expect(isWriteWithinAllowedRoots('Bash', { command: 'ls -la' }, [ROOT])).toBe(true);
    expect(isWriteWithinAllowedRoots('Bash', { command: `cat ${INSIDE}` }, [ROOT])).toBe(true);
    expect(isWriteWithinAllowedRoots('Bash', { command: `grep foo ${OUTSIDE}` }, [ROOT])).toBe(true);
  });
  it('Bash 重定向 > 白名单外 → deny', () => {
    expect(isWriteWithinAllowedRoots('Bash', { command: `echo hello > ${OUTSIDE}` }, [ROOT])).toBe(false);
  });
  it('Bash 重定向 > 白名单内 → allow', () => {
    expect(isWriteWithinAllowedRoots('Bash', { command: `echo hello > ${INSIDE}` }, [ROOT])).toBe(true);
  });
  it('Bash >> 追加白名单外 → deny', () => {
    expect(isWriteWithinAllowedRoots('Bash', { command: `echo data >> ${OUTSIDE}` }, [ROOT])).toBe(false);
  });
  it('Bash 2>&1 不算写路径（fd 重定向）→ allow', () => {
    expect(isWriteWithinAllowedRoots('Bash', { command: 'cmd 2>&1' }, [ROOT])).toBe(true);
  });
  it('Bash cp 目标在白名单外 → deny', () => {
    expect(isWriteWithinAllowedRoots('Bash', { command: `cp ${INSIDE} ${OUTSIDE}` }, [ROOT])).toBe(false);
  });
  it('Bash cp 目标在白名单内 → allow', () => {
    expect(isWriteWithinAllowedRoots('Bash', { command: `cp ${OUTSIDE} ${INSIDE}` }, [ROOT])).toBe(true);
  });
  it('Bash mkdir 白名单外 → deny', () => {
    expect(isWriteWithinAllowedRoots('Bash', { command: `mkdir ${OUTSIDE}` }, [ROOT])).toBe(false);
  });
  it('Bash touch 白名单外 → deny', () => {
    expect(isWriteWithinAllowedRoots('Bash', { command: `touch ${OUTSIDE}` }, [ROOT])).toBe(false);
  });
  it('Bash tee 白名单外 → deny', () => {
    expect(isWriteWithinAllowedRoots('Bash', { command: `echo data | tee ${OUTSIDE}` }, [ROOT])).toBe(false);
  });
  it('Bash mv 白名单外 → deny', () => {
    expect(isWriteWithinAllowedRoots('Bash', { command: `mv ${INSIDE} ${OUTSIDE}` }, [ROOT])).toBe(false);
  });
  it('Bash 无 command 字段 → allow（防御）', () => {
    expect(isWriteWithinAllowedRoots('Bash', {}, [ROOT])).toBe(true);
  });
  it('Bash 混合读+写，写越界 → deny', () => {
    expect(
      isWriteWithinAllowedRoots('Bash', { command: `ls ${ROOT} && echo x > ${OUTSIDE}` }, [ROOT]),
    ).toBe(false);
  });
});

describe('isWriteWithinAllowedRoots — 盘符根/根目录 root（ql-20260702-007）', () => {
  // Windows：盘符根 D:\ resolve 后结尾已是 sep，旧逻辑 rl+sep 产生 "D:\\" 双反斜杠前缀
  // → startsWith 永远 false，配 D 盘做 allowed_root 仍 deny 所有写。修复后 root 已含尾 sep 不再补。
  it.skipIf(!isWin)('盘符根 D:/ 作 root → Write D:\\file allow', () => {
    expect(isWriteWithinAllowedRoots('Write', { file_path: 'D:\\test.txt' }, ['D:/'])).toBe(true);
  });
  it.skipIf(!isWin)('盘符根 D:\\ 作 root → Write D:\\sub\\file allow', () => {
    expect(isWriteWithinAllowedRoots('Write', { file_path: 'D:\\sub\\file.txt' }, ['D:\\'])).toBe(true);
  });
  it.skipIf(!isWin)('盘符根 D:/ 作 root → 别盘 E:\\file deny', () => {
    expect(isWriteWithinAllowedRoots('Write', { file_path: 'E:\\evil.txt' }, ['D:/'])).toBe(false);
  });
  it.skipIf(!isWin)('盘符根 D:/ 作 root → Bash echo > D:\\file allow', () => {
    expect(isWriteWithinAllowedRoots('Bash', { command: 'echo x > D:\\out.txt' }, ['D:/'])).toBe(true);
  });
  it.skipIf(!isWin)('盘符根 D:/ 作 root → Bash cp 到 D:\\file allow', () => {
    expect(isWriteWithinAllowedRoots('Bash', { command: 'cp E:\\src.txt D:\\dst.txt' }, ['D:/'])).toBe(true);
  });
  // Unix 根 /（Linux/CI 验证，Windows 跳过）
  it.skipIf(isWin)('Unix 根 / 作 root → Write /tmp/x allow', () => {
    expect(isWriteWithinAllowedRoots('Write', { file_path: '/tmp/x.txt' }, ['/'])).toBe(true);
  });
});
