// tests/roots-rpc.test.ts
// task-03: list_roots RPC handler（daemon 端 src/roots-rpc.ts）单元测试。
// 覆盖四类场景（对齐 task-03.md acceptance / design FR-1）：
//   1. Windows + C/D 盘存在 → 返 ['C:\\', 'D:\\']（带尾反斜杠）
//   2. Linux/macOS → 返 ['/']
//   3. 单盘 existsSync 抛错不中断（C 抛、D 在）→ 返 ['D:\\']
//   4. 全盘不存在 → 返 []
//
// mock 策略：listRoots 内部 `import { platform } from 'node:os'` 与
// `import { existsSync } from 'node:fs'`（具名导入）。node:os.platform 是
// non-configurable 属性，vi.spyOn 无法重定义，故改用 vi.mock 拦截整个模块。
// vi.hoisted 提升 vi.fn 引用，使工厂能返回它们、测试用例能配置返回值。
//
// 注：本文件位于 tests/（tsconfig exclude，typecheck 不查；vitest include tests/**），
// import 习惯与既有 tests/*.test.ts 一致（../src/xxx 无 .js 扩展，vitest 运行时解析）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: vi.fn(),
  existsSync: vi.fn(),
  // sep 是字符串常量（非函数）：listRoots `return { roots: [sep] }` 直接取值，
  // 不会调用它。故用一个可变值容器 + 工厂里的 getter，让每用例能切换 sep。
  sep: '\\' as string,
}));

// 注意：vi.mock 被 hoist 到文件顶部执行，工厂内只能引用 vi.hoisted 的产物。
vi.mock('node:os', () => ({
  default: {},
  platform: mocks.platform,
}));
vi.mock('node:fs', () => ({
  default: {},
  existsSync: mocks.existsSync,
}));
// listRoots POSIX 分支用 `import { sep } from 'node:path'`。Node 的 sep 基于真实
// 运行进程平台（Windows 恒为 '\\'），不随 mock 的 platform() 变化。为让 Linux/macOS
// 用例在任意机器上断言 ['/']，用 getter 把 sep 动态绑到 mocks.sep（可变值）。
// 其余 path API（resolve/join 等 listRoots 不用）透传真实模块。
vi.mock('node:path', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:path')>()),
  get sep() {
    return mocks.sep;
  },
}));

import { listRoots } from '../src/roots-rpc';

describe('listRoots — 跨平台磁盘根枚举（task-03）', () => {
  beforeEach(() => {
    // 每用例重置 mock 调用记录与默认实现。
    mocks.platform.mockReset();
    mocks.existsSync.mockReset();
    // sep 默认回到 Windows 形态（多数用例是 Win 分支，Unix 用例再覆盖为 '/'）。
    mocks.sep = '\\';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Win + C/D 盘存在 → 返 C:\\ D:\\（带尾反斜杠，按字母序）', async () => {
    mocks.platform.mockReturnValue('win32');
    // 仅 C:\ 与 D:\ 存在，其余盘符一律 false。
    mocks.existsSync.mockImplementation((p: string) => p === 'C:\\' || p === 'D:\\');

    const result = await listRoots();

    // C 在 D 前（listWindowsDrives 从 A 往 Z 循环）。
    expect(result).toEqual({ roots: ['C:\\', 'D:\\'] });
  });

  it('Linux → 返单一根 [/]', async () => {
    mocks.platform.mockReturnValue('linux');
    // POSIX 根恒为 '/'：listRoots 用 sep 作为尾分隔符，POSIX sep='/'
    mocks.sep = '/';

    const result = await listRoots();

    expect(result).toEqual({ roots: ['/'] });
    // Unix 分支不依赖 existsSync。
    expect(mocks.existsSync).not.toHaveBeenCalled();
  });

  it('macOS → 返单一根 [/]（POSIX 分支同 Linux）', async () => {
    mocks.platform.mockReturnValue('darwin');
    mocks.sep = '/';

    const result = await listRoots();

    expect(result).toEqual({ roots: ['/'] });
  });

  it('Win + 单盘 existsSync 抛错不中断（C 抛、D 在 → 跳过 C 返 D）', async () => {
    mocks.platform.mockReturnValue('win32');
    // C:\ 探测抛错（权限异常等），D:\ 正常存在，其余 false。
    mocks.existsSync.mockImplementation((p: string) => {
      if (p === 'C:\\') throw new Error('EACCES: permission denied');
      return p === 'D:\\';
    });

    const result = await listRoots();

    // C 被跳过，D 正常收集；单盘抛错不中断枚举。
    expect(result).toEqual({ roots: ['D:\\'] });
  });

  it('Win + 全盘不存在 → 返空数组 []（不抛异常）', async () => {
    mocks.platform.mockReturnValue('win32');
    mocks.existsSync.mockReturnValue(false);

    const result = await listRoots();

    expect(result).toEqual({ roots: [] });
    // 返回结构契约稳定：roots 恒为 string[]。
    expect(Array.isArray(result.roots)).toBe(true);
    expect(result.roots.length).toBe(0);
  });
});
