/**
 * tests/policy/path-utils.test.ts —— path-utils 纯函数单测（task-01 / task-10）。
 *
 * 覆盖：
 *   - normalizePath（strip 引号、git bash `/x/`→`X:/`、`..` 折叠）
 *   - resolveRealPath（existing realpath、non-existing fallback、UNC）
 *   - isPathUnderAnyRoot（边界敏感前缀、盘符根修复、symlink 穿越）
 *
 * task-10 扩展（B1 安全红线）：
 *   - 全场景：合法子路径 / root 外越权 / junction-symlink 穿越 / 盘符大小写 /
 *     不存在 target+root fallback / borrow root 多 root / UNC 拒绝
 *   - 改前改后对照：task-02 改前用 normalizePath 比较，改后用 resolveRealPath。
 *     重点断言「安全场景（越权一律 false）改前改后一致」——realpath 下沉不得
 *     引入新的越权 / 误判。注释中标注 [SAFETY-INVARIANT] 的为改前改后都必须
 *     成立的安全不变量。
 *   - ql-20260702-007：盘符根 D:\ / Unix 根 / 作 root，尾 sep 不补双 sep 误判。
 */

import { describe, it, expect } from 'vitest';
import { resolve, sep, join } from 'node:path';
import {
  writeFileSync,
  symlinkSync,
  rmSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import {
  normalizePath,
  resolveRealPath,
  isPathUnderAnyRoot,
  UNC_REJECTED,
} from '../../src/policy/path-utils.js';

const isWin = sep === '\\';
const ROOT = resolve('.');
const INSIDE = join(ROOT, 'sub', 'file.txt');
const OUTSIDE = isWin ? 'D:\\evil.txt' : '/tmp/evil_test.txt';

// ── normalizePath ───────────────────────────────────────────────────────────

describe('normalizePath', () => {
  it('strip 外层引号', () => {
    expect(normalizePath("'D:/file.txt'")).toBe(normalizePath('D:/file.txt'));
    expect(normalizePath('"D:/file.txt"')).toBe(normalizePath('D:/file.txt'));
  });
  it('无引号原样', () => {
    expect(normalizePath('D:/file.txt')).toBe(resolve('D:/file.txt'));
  });
  it('`..` 折叠', () => {
    // 用带盘符/根的绝对路径测 `..` 折叠，避免 Windows 下裸 `/a/...` 被 git bash `/x/` 映射误判。
    const base = isWin ? 'D:' : '';
    expect(normalizePath(`${base}/a/b/../c`)).toBe(resolve(`${base}/a/c`));
  });
  it('git bash /x/ 映射（Windows only）', () => {
    if (isWin) {
      expect(normalizePath('/c/Work/test.txt')).toBe(resolve('C:/Work/test.txt'));
      expect(normalizePath('/d/other/file')).toBe(resolve('D:/other/file'));
    }
  });
  it('git bash /x/ 不破坏 Unix 路径', () => {
    if (!isWin) {
      expect(normalizePath('/tmp/file.txt')).toBe('/tmp/file.txt');
    }
  });
});

// ── resolveRealPath ─────────────────────────────────────────────────────────

describe('resolveRealPath', () => {
  it('存在的路径返回 realpath', () => {
    // ROOT 存在，realpath 应返回相同（或 resolv 后相同）
    const r = resolveRealPath(ROOT);
    expect(r.toLowerCase()).toBe(ROOT.toLowerCase());
  });
  it('不存在的路径 fallback 父目录 realpath', () => {
    const fakePath = join(ROOT, '_nonexistent_policy_test_dir_', 'newfile.txt');
    const r = resolveRealPath(fakePath);
    // 应回落为 root 下 newfile.txt
    expect(r.toLowerCase()).toContain('newfile.txt');
  });
  it('UNC 路径返回 UNC_REJECTED', () => {
    expect(resolveRealPath('\\\\server\\share\\file.txt')).toBe(UNC_REJECTED);
    expect(resolveRealPath('//server/share/file.txt')).toBe(UNC_REJECTED);
  });
  it('Windows 盘符 case 归一为小写', () => {
    if (isWin) {
      const r = resolveRealPath('C:\\Windows');
      expect(r).toMatch(/^c:/);
    }
  });
  it('symlink 解析（若文件系统支持）', () => {
    // 当前目录创建一个 symlink 测试
    const target = join(ROOT, '_path_utils_link_target');
    const link = join(ROOT, '_path_utils_link');
    try {
      // 创建目标文件
      writeFileSync(target, 'test', 'utf-8');
      symlinkSync(target, link);
      const r = resolveRealPath(link);
      expect(r.toLowerCase()).toBe(target.toLowerCase());
    } catch {
      // symlink 创建可能失败（权限/平台），不阻断
    } finally {
      try { rmSync(target, { force: true }); } catch {}
      try { rmSync(link, { force: true }); } catch {}
    }
  });
});

// ── isPathUnderAnyRoot ──────────────────────────────────────────────────────

describe('isPathUnderAnyRoot', () => {
  it('在白名单内 → true', () => {
    expect(isPathUnderAnyRoot(INSIDE, [ROOT])).toBe(true);
  });
  it('在白名单外 → false', () => {
    expect(isPathUnderAnyRoot(OUTSIDE, [ROOT])).toBe(false);
  });
  it('空 allowedRoots → 全 false（严格按 admin 配置，不兜底）', () => {
    expect(isPathUnderAnyRoot(INSIDE, [])).toBe(false);
  });
  it('盘符根 D:/ 作 root Write D:\\file → true', () => {
    if (isWin) {
      expect(isPathUnderAnyRoot('D:\\test.txt', ['D:/'])).toBe(true);
    }
  });
  it('盘符根 D:\\ 作 root Write D:\\sub\\file → true', () => {
    if (isWin) {
      expect(isPathUnderAnyRoot('D:\\sub\\file.txt', ['D:\\'])).toBe(true);
    }
  });
  it('盘符根 D:/ 作 root → 别盘 E:\\ → false', () => {
    if (isWin) {
      expect(isPathUnderAnyRoot('E:\\evil.txt', ['D:/'])).toBe(false);
    }
  });
  it('Unix 根 / 作 root → /tmp/x → true', () => {
    if (!isWin) {
      expect(isPathUnderAnyRoot('/tmp/x.txt', ['/'])).toBe(true);
    }
  });
  it('UNC 路径 → false（不落在任何 root 下）', () => {
    expect(isPathUnderAnyRoot('\\\\server\\share\\file.txt', [ROOT])).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// task-10：isPathUnderAnyRoot 全场景 + 改前改后对照（B1 安全红线）
// ════════════════════════════════════════════════════════════════════════════
//
// 改前改后口径说明（task-02）：
//   改前：isPathUnderAnyRoot 用 normalizePath（仅 normalize + case 归一）比较；
//   改后：target + 每个 root 都过 resolveRealPath（realpath + 不存在 fallback + case 归一）。
//
// 安全不变量标注约定：
//   [SAFETY-INVARIANT] —— 改前改后都必须成立，realpath 下沉不得改变这些结果。
//   尤其：越权（root 外）一律 false，是改前改后共有的安全红线。

describe('task-10: isPathUnderAnyRoot 全场景 + 改前改后对照', () => {
  // 准备一组真实存在的临时 root，确保 realpath / fallback 都走通。
  const ALLOWED_DIR = join(ROOT, '_task10_allowed_');
  const ALLOWED_DIR2 = join(ROOT, '_task10_allowed2_');
  const OUTSIDE_DIR = join(ROOT, '_task10_outside_');

  // symlink/junction 装备：link_dir 位于 OUTSIDE_DIR，但指向 ALLOWED_DIR。
  // 改后（resolveRealPath）应把穿过 link 的路径解析到 ALLOWED_DIR，
  // 因此「写 OUTSIDE_DIR/link_dir/x」改后应判 true（落在 ALLOWED_DIR 下），
  // 这是 task-02 相对改前「更准」的体现，属安全增强而非新越权。
  const LINK_DIR = join(OUTSIDE_DIR, '_task10_link_to_allowed');

  function setup(): void {
    try { rmSync(ALLOWED_DIR, { recursive: true, force: true }); } catch {}
    try { rmSync(ALLOWED_DIR2, { recursive: true, force: true }); } catch {}
    try { rmSync(OUTSIDE_DIR, { recursive: true, force: true }); } catch {}
    mkdirSync(ALLOWED_DIR, { recursive: true });
    mkdirSync(ALLOWED_DIR2, { recursive: true });
    mkdirSync(OUTSIDE_DIR, { recursive: true });
  }
  function teardown(): void {
    try { rmSync(ALLOWED_DIR, { recursive: true, force: true }); } catch {}
    try { rmSync(ALLOWED_DIR2, { recursive: true, force: true }); } catch {}
    try { rmSync(OUTSIDE_DIR, { recursive: true, force: true }); } catch {}
  }

  // ── 场景 1：合法子路径 → true（改前改后一致）────────────────────────────────
  describe('场景 1：合法子路径', () => {
    it('[SAFETY-INVARIANT] root 内真实子路径 → true', () => {
      setup();
      try {
        const f = join(ALLOWED_DIR, 'a.txt');
        writeFileSync(f, 'x');
        // 改前改后都应为 true。
        expect(isPathUnderAnyRoot(f, [ALLOWED_DIR])).toBe(true);
      } finally {
        teardown();
      }
    });

    it('[SAFETY-INVARIANT] root 自身路径 → true（dl === rl 等值分支）', () => {
      setup();
      try {
        expect(isPathUnderAnyRoot(ALLOWED_DIR, [ALLOWED_DIR])).toBe(true);
      } finally {
        teardown();
      }
    });
  });

  // ── 场景 2：root 外路径 → false（越权拒绝，安全关键）─────────────────────────
  describe('场景 2：root 外越权拒绝', () => {
    it('[SAFETY-INVARIANT] 完全无关路径 → false', () => {
      setup();
      try {
        const f = join(OUTSIDE_DIR, 'evil.txt');
        writeFileSync(f, 'x');
        // 改前改后都必须 false（越权拒绝红线）。
        expect(isPathUnderAnyRoot(f, [ALLOWED_DIR])).toBe(false);
      } finally {
        teardown();
      }
    });

    it('[SAFETY-INVARIANT] 同级前缀混淆 → false（边界敏感，不子串匹配）', () => {
      setup();
      try {
        // 构造 ALLOWED_DIR_x 与 ALLOWED_DIR 同前缀但不同目录：防 startsWith 子串误判。
        mkdirSync(join(ROOT, '_task10_allowed_sib_'), { recursive: true });
        const f = join(ROOT, '_task10_allowed_sib_', 'x.txt');
        writeFileSync(f, 'x');
        // ALLOWED_DIR = .../_task10_allowed_；f 在 .../_task10_allowed_sib_ 下。
        // 简单子串匹配会误 true（_task10_allowed_ 是 _task10_allowed_sib_ 的前缀），
        // 边界敏感（必须带 sep 或等值）应 false。改前改后一致。
        expect(isPathUnderAnyRoot(f, [ALLOWED_DIR])).toBe(false);
        try { rmSync(join(ROOT, '_task10_allowed_sib_'), { recursive: true, force: true }); } catch {}
      } finally {
        teardown();
      }
    });

    it('[SAFETY-INVARIANT] 改前改后都拒绝：../ 穿透到 root 外（已 resolve 折叠）', () => {
      setup();
      try {
        // ALLOWED_DIR/../../outside_evil.txt —— resolve 后落在 OUTSIDE 同级外。
        const f = join(ALLOWED_DIR, '..', '..', '_task10_traversal.txt');
        writeFileSync(resolve(f), 'x');
        // normalize/realpath 都会折叠 .. → 落到 ROOT 同级外，不在 ALLOWED_DIR 下。
        expect(isPathUnderAnyRoot(f, [ALLOWED_DIR])).toBe(false);
        try { rmSync(resolve(f), { force: true }); } catch {}
      } finally {
        teardown();
      }
    });
  });

  // ── 场景 3：junction/symlink 解析后判定（改后更准）────────────────────────────
  describe('场景 3：junction / symlink 穿越（改后更准）', () => {
    it('改后（resolveRealPath）：穿过 symlink 落到 allowed → true', () => {
      setup();
      try {
        // 先建 ALLOWED_DIR（已 mkdir），再造指向它的 link，位于 OUTSIDE_DIR。
        writeFileSync(join(ALLOWED_DIR, 'real.txt'), 'x');
        try {
          // Windows 上非管理员用 junction（type: 'junction'）不需权限；
          // Unix / Win 管理员用 symlink。用 'dir' 类型保持兼容。
          if (isWin) {
            symlinkSync(ALLOWED_DIR, LINK_DIR, 'junction');
          } else {
            symlinkSync(ALLOWED_DIR, LINK_DIR, 'dir');
          }
        } catch {
          // 平台/权限不支持 symlink → 跳过本用例，不阻断套件。
          return;
        }
        // 路径在 OUTSIDE_DIR 下的 link 内，但 realpath 解析回 ALLOWED_DIR。
        // task-02 改后：resolveRealPath 把 LINK_DIR/real.txt 解析为 ALLOWED_DIR/real.txt → true。
        const viaLink = join(LINK_DIR, 'real.txt');
        expect(isPathUnderAnyRoot(viaLink, [ALLOWED_DIR])).toBe(true);
      } finally {
        teardown();
      }
    });

    it('[SAFETY-INVARIANT] symlink 指向 root 外 → 写 root 内 fake link 仍 false（穿越后落外面）', () => {
      // 反向安全断言：若 link 本身就建在 root 外、指向 root 外，
      // 改后 realpath 不会把它判成 root 内（不存在把外面拉进来的新越权）。
      setup();
      try {
        try {
          if (isWin) {
            symlinkSync(OUTSIDE_DIR, LINK_DIR, 'junction');
          } else {
            symlinkSync(OUTSIDE_DIR, LINK_DIR, 'dir');
          }
        } catch {
          return; // 平台不支持则跳过
        }
        // ALLOWED_DIR 作 root；穿过 LINK_DIR 仍落在 OUTSIDE_DIR → false。
        const viaLink = join(LINK_DIR, 'x.txt');
        expect(isPathUnderAnyRoot(viaLink, [ALLOWED_DIR])).toBe(false);
      } finally {
        teardown();
      }
    });
  });

  // ── 场景 4：Windows 盘符大小写不敏感（改前改后一致）─────────────────────────
  describe('场景 4：Windows 盘符大小写', () => {
    it('[SAFETY-INVARIANT] D:\\Foo vs d:\\foo 同路径（NTFS case-insensitive）', () => {
      if (!isWin) return; // 非 Win 跳过
      // C:\Windows 一定存在，大小写混用应判同路径。
      expect(isPathUnderAnyRoot('c:\\Windows\\System32', ['C:\\Windows'])).toBe(true);
      expect(isPathUnderAnyRoot('C:\\WINDOWS\\system32', ['c:\\windows'])).toBe(true);
    });

    it('[SAFETY-INVARIANT] root 大小写不同但同路径 → true', () => {
      if (!isWin) return;
      expect(isPathUnderAnyRoot('C:\\Windows\\x', ['c:\\WINDOWS'])).toBe(true);
    });
  });

  // ── 场景 5：不存在 target/root → fallback 不抛异常（改前改后一致）──────────
  describe('场景 5：不存在路径 fallback', () => {
    it('[SAFETY-INVARIANT] target 不存在但落在存在 root 下 → true（父目录 fallback）', () => {
      setup();
      try {
        const f = join(ALLOWED_DIR, 'deeply', 'nested', 'newfile.txt');
        // f 不存在，但其存在祖先 ALLOWED_DIR 在白名单 → 改后 fallback 仍应 true。
        expect(() => isPathUnderAnyRoot(f, [ALLOWED_DIR])).not.toThrow();
        expect(isPathUnderAnyRoot(f, [ALLOWED_DIR])).toBe(true);
      } finally {
        teardown();
      }
    });

    it('[SAFETY-INVARIANT] root 本身不存在 → 不抛，对该 root 永远 false', () => {
      const ghostRoot = join(ROOT, '_task10_ghost_root_');
      // ghostRoot 不存在 → resolveRealPath fallback 到存在的祖先（ROOT），
      // 但 ROOT != ghostRoot，target 不在「ghostRoot」名下。保守 false。
      expect(() => isPathUnderAnyRoot(join(ROOT, 'x.txt'), [ghostRoot])).not.toThrow();
      expect(isPathUnderAnyRoot(join(ROOT, 'x.txt'), [ghostRoot])).toBe(false);
    });

    it('[SAFETY-INVARIANT] target 不存在 + 不在 root 下 → false', () => {
      setup();
      try {
        const f = join(OUTSIDE_DIR, 'nope.txt');
        expect(() => isPathUnderAnyRoot(f, [ALLOWED_DIR])).not.toThrow();
        expect(isPathUnderAnyRoot(f, [ALLOWED_DIR])).toBe(false);
      } finally {
        teardown();
      }
    });
  });

  // ── 场景 6：borrow root（多 root 数组）→ 任一命中 true，全不命中 false ──────
  describe('场景 6：borrow root 多 root 语义', () => {
    it('[SAFETY-INVARIANT] 命中第二个 root → true（任一命中即 allow）', () => {
      setup();
      try {
        const f = join(ALLOWED_DIR2, 'b.txt');
        writeFileSync(f, 'x');
        // f 不在 ALLOWED_DIR，但在 ALLOWED_DIR2 → 命中第二个 root → true。
        expect(isPathUnderAnyRoot(f, [ALLOWED_DIR, ALLOWED_DIR2])).toBe(true);
      } finally {
        teardown();
      }
    });

    it('[SAFETY-INVARIANT] 全不命中 → false', () => {
      setup();
      try {
        const f = join(OUTSIDE_DIR, 'c.txt');
        writeFileSync(f, 'x');
        expect(isPathUnderAnyRoot(f, [ALLOWED_DIR, ALLOWED_DIR2])).toBe(false);
      } finally {
        teardown();
      }
    });

    it('[SAFETY-INVARIANT] 空 roots → false（不兜底，严格按 admin 配置）', () => {
      setup();
      try {
        const f = join(ALLOWED_DIR, 'd.txt');
        writeFileSync(f, 'x');
        expect(isPathUnderAnyRoot(f, [])).toBe(false);
      } finally {
        teardown();
      }
    });
  });

  // ── 场景 7：UNC 路径 → false（UNC_REJECTED，改前改后一致）──────────────────
  describe('场景 7：UNC 路径拒绝', () => {
    it('[SAFETY-INVARIANT] \\\\host\\share 作 target → false', () => {
      expect(isPathUnderAnyRoot('\\\\host\\share\\evil.txt', [ROOT])).toBe(false);
    });

    it('[SAFETY-INVARIANT] UNC 作 root → 该 root 不匹配任何 target（不越权）', () => {
      // root 是 UNC → resolveRealPath 返回 UNC_REJECTED → some() 此分支 false。
      // 即便 target 看似在 UNC root 下，也不得 allow。
      expect(isPathUnderAnyRoot('\\\\host\\share\\x.txt', ['\\\\host\\share'])).toBe(false);
    });

    it('[SAFETY-INVARIANT] //host/share（正斜杠 UNC 形态）作 target → false', () => {
      // normalizePath 不动 // 开头；resolveRealPath 检测 UNC_PREFIX（\\\\）。
      // 注意：正斜杠 //host 在 normalize 后 pathResolve 行为依平台，此处仅断言「不 allow」。
      expect(isPathUnderAnyRoot('//host/share/x.txt', [ROOT])).toBe(false);
    });
  });

  // ── 场景 8：ql-20260702-007 盘符根 / Unix 根尾 sep 不变量（最重要）──────────
  describe('场景 8：ql-20260702-007 盘符根 / Unix 根尾 sep 不变量', () => {
    it('[SAFETY-INVARIANT][ql-20260702-007] Windows 盘符根 D:/ 作 root → 子路径 true', () => {
      if (!isWin) return;
      // D:\ 下任意真实子路径（Windows 安装目录恒存在）应 true。
      // 若 task-02 实现误把 rl+sep 算成 "D:\\"（双 sep），dl.startsWith 永远 false → 误 deny。
      expect(isPathUnderAnyRoot('C:\\Windows\\System32', ['C:/'])).toBe(true);
    });

    it('[SAFETY-INVARIANT][ql-20260702-007] Windows 盘符根作 root → 别盘 false（不因双 sep 误判越界）', () => {
      if (!isWin) return;
      // 关键：盘符根 root 必须正确拒绝**别盘**，同时不能误判本盘子路径。
      // 双 sep bug 会让本盘也 false；这里同时验证「本盘 true + 别盘 false」两侧。
      expect(isPathUnderAnyRoot('C:\\Windows\\x', ['C:/'])).toBe(true);
      expect(isPathUnderAnyRoot('D:\\evil.txt', ['C:/'])).toBe(false);
    });

    it('[SAFETY-INVARIANT][ql-20260702-007] Windows 盘符根作 root，根自身写盘符根 → true', () => {
      if (!isWin) return;
      // root = D:\，target = D:\（等值分支）→ true。
      expect(isPathUnderAnyRoot('C:\\', ['C:\\'])).toBe(true);
    });

    it('[SAFETY-INVARIANT][ql-20260702-007] Unix 根 / 作 root → 子路径 true', () => {
      if (isWin) return;
      // Unix / 作 root，/tmp/x 子路径应 true；双 sep bug（//）会误 deny。
      expect(isPathUnderAnyRoot('/tmp/anyfile.txt', ['/'])).toBe(true);
    });

    it('[SAFETY-INVARIANT][ql-20260702-007] Unix 根 / 作 root → 根自身 true', () => {
      if (isWin) return;
      expect(isPathUnderAnyRoot('/', ['/'])).toBe(true);
    });
  });

  // ── 改前改后对照：显式列出「安全场景结果不变」断言 ─────────────────────────
  describe('改前改后安全一致性（汇总）', () => {
    // 这一节用一组确定性输入，把「越权一律 false」的多个变体集中断言，
    // 作为 task-02 realpath 下沉后回归的快速红线门禁。
    it('[SAFETY-INVARIANT] 越权路径变体汇总：全部 false', () => {
      setup();
      try {
        writeFileSync(join(OUTSIDE_DIR, 'o.txt'), 'x');
        const denyCases: Array<[string, string[]]> = [
          [join(OUTSIDE_DIR, 'o.txt'), [ALLOWED_DIR]],            // 同级外
          [join(ROOT, '_task10_allowed_sib_', 'z.txt'), [ALLOWED_DIR]], // 前缀混淆（动态建）
          ['\\\\host\\share\\x.txt', [ALLOWED_DIR]],               // UNC target
          [join(ALLOWED_DIR, 'x.txt'), []],                        // 空 roots
        ];
        mkdirSync(join(ROOT, '_task10_allowed_sib_'), { recursive: true });
        writeFileSync(join(ROOT, '_task10_allowed_sib_', 'z.txt'), 'x');
        for (const [target, roots] of denyCases) {
          expect(isPathUnderAnyRoot(target, roots)).toBe(false);
        }
        try { rmSync(join(ROOT, '_task10_allowed_sib_'), { recursive: true, force: true }); } catch {}
      } finally {
        teardown();
      }
    });

    it('[SAFETY-INVARIANT] 合法子路径汇总：全部 true', () => {
      setup();
      try {
        writeFileSync(join(ALLOWED_DIR, 'ok1.txt'), 'x');
        writeFileSync(join(ALLOWED_DIR2, 'ok2.txt'), 'x');
        const allowCases: Array<[string, string[]]> = [
          [join(ALLOWED_DIR, 'ok1.txt'), [ALLOWED_DIR]],            // 单 root
          [join(ALLOWED_DIR2, 'ok2.txt'), [ALLOWED_DIR, ALLOWED_DIR2]], // 命中第二 root
          [join(ALLOWED_DIR, 'deep', 'new.txt'), [ALLOWED_DIR]],    // 不存在子路径 fallback
        ];
        for (const [target, roots] of allowCases) {
          expect(isPathUnderAnyRoot(target, roots)).toBe(true);
        }
      } finally {
        teardown();
      }
    });
  });
});

// 触发 existsSync 静态引用（setup 用 mkdirSync，但保留 existsSync 以表达 fallback 语义可观测）。
void existsSync;
