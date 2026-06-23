// tests/agent-detector.system-claude.integ.test.ts
// task-01: R-exe 补验 —— agent-detector 检测系统 claude 的集成测试。
//
// 与 tests/agent-detector.test.ts（单测，mock 子进程）的区别：本文件**真实**
// 执行 `claude --version` 子进程（不 mock detectVersion），验证 agent-detector
// 在真实本机环境下给出的路径形状能被 task-04 ClaudeSdkDriver 直接当
// `pathToClaudeCodeExecutable` 用。真实 spawn 的是 `claude --version`（本地，
// 无网络），不是 SDK query（那部分由 sandbox h1-exe.mjs 验证）。
//
// 覆盖：
//   - AC3: detectOne('claude') → {status:'available', path: cmd/exe/bat/ps1, version:'2.x'}
//   - AC4: mock findOnPath=null + 无 env → {status:'unavailable', reason:'not-found', path:''}
//         （D-009 normalized_requirement 第 3 条 refuse-to-start 判据）
//   - AC6: version semver >= 2.0.0（PROVIDER_SPECS.claude.minVersion）
//
// 不验证：SDK query 本身跑通 PONG（那在 sandbox h1-exe.mjs，需网络+鉴权）。
//
// @vitest-environment node

import { describe, it, expect, afterEach, vi } from 'vitest';
import { AgentDetector, PROVIDER_SPECS } from '../src/agent-detector.js';

/**
 * semver "major.minor.patch" 字典序比较（仅数字段，无预发布标签）。
 * 返回 -1 / 0 / 1。task-14 version.ts 有更完整的 checkMinVersion，本测试
 * 为独立判定（避免与 version.ts 实现耦合），仅用于 AC6 断言。
 */
function cmpSemver(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10));
  const pb = b.split('.').map((x) => parseInt(x, 10));
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

/**
 * 集成测试用真实 AgentDetector 实例（不覆写 protected 方法，除了 case 3 的 mock）。
 * case 1/2 让 resolveBinPath 走真实 env + 真实 PATH + 真实 --version 子进程。
 */
describe('task-01 agent-detector system-claude integration', () => {
  const savedEnv = process.env.SILLYHUB_CLAUDE_PATH;

  afterEach(() => {
    // 恢复 SILLYHUB_CLAUDE_PATH，避免 case 3 的 delete 泄漏到其他 case。
    if (savedEnv === undefined) {
      delete process.env.SILLYHUB_CLAUDE_PATH;
    } else {
      process.env.SILLYHUB_CLAUDE_PATH = savedEnv;
    }
  });

  // -------------------------------------------------------------------------
  // AC3: agent-detector 给出可用路径（真实本机 claude 2.1.181）
  // -------------------------------------------------------------------------
  it('detects system claude as available with cmd/exe path', async () => {
    const r = await new AgentDetector().detectOne('claude');

    // detectOne 对已知 provider 永不返回 null（未知 provider 才 null）。
    expect(r).not.toBeNull();
    expect(r!.provider).toBe('claude');

    // 本机预期 claude 已装（2.1.181）；若 CI/容器未装则 skip 而非 FAIL。
    if (r!.status !== 'available') {
      console.warn(
        '[task-01 integ] claude not detected on this machine ' +
          `(status=${r!.status}, reason=${r!.reason}); skipping path-shape assertion`,
      );
      return; // 不用 it.skip（动态条件），直接 return 让该 case 不报错。
    }

    // D-009 driver 直接拿 detected.path 当 pathToClaudeCodeExecutable。
    // Windows 下 findOnPath 只返回 .exe/.cmd/.bat/.ps1；posix 下可执行文件无扩展名
    // （homebrew/apt 安装的 claude 即 /opt/homebrew/bin/claude），断言按平台分支。
    expect(r!.path).not.toBe('');
    if (process.platform === 'win32') {
      expect(/\.(cmd|exe|bat|ps1)$/i.test(r!.path)).toBe(true);
    }
    console.log('[task-01 integ] detected path =', r!.path);

    // protocol 来自 PROVIDER_SPECS，固定 stream_json。
    expect(r!.protocol).toBe('stream_json');
  });

  // -------------------------------------------------------------------------
  // AC6: 版本达标（>= PROVIDER_SPECS.claude.minVersion = '2.0.0'）
  // -------------------------------------------------------------------------
  it('resolved version satisfies min 2.0.0', async () => {
    const r = await new AgentDetector().detectOne('claude');
    expect(r).not.toBeNull();

    // 环境无 claude（version===undefined）→ skip，不 FAIL（对齐蓝图 R2）。
    if (r!.version === undefined) {
      console.warn(
        '[task-01 integ] claude version undefined (not detected); skipping version assertion',
      );
      return;
    }

    const minVersion = PROVIDER_SPECS.claude.minVersion!;
    console.log(
      `[task-01 integ] version=${r!.version} minVersion=${minVersion}`,
    );
    expect(cmpSemver(r!.version, minVersion)).toBeGreaterThanOrEqual(0);

    // 达标时 versionWarning 应为 null（checkMinVersion 达标返回 null）。
    expect(r!.versionWarning).toBeNull();
  });

  // -------------------------------------------------------------------------
  // AC4: 未检测到 claude → unavailable/not-found（D-009 refuse-to-start 判据）
  // -------------------------------------------------------------------------
  it('returns unavailable/not-found when claude absent (D-009 refuse-to-start predicate)', async () => {
    // 清掉 env 覆盖，强制走 PATH 查找分支。
    delete process.env.SILLYHUB_CLAUDE_PATH;

    // spyOn protected 方法：TypeScript protected 在运行时无强制，vitest
    // spyOn 作用于实例方法可生效（真实实例而非子类）。mock findOnPath → null
    // 模拟 PATH 上无 claude。
    const detector = new AgentDetector();
    const spy = vi
      .spyOn(detector as unknown as { findOnPath: (b: string) => string | null }, 'findOnPath')
      .mockReturnValue(null);

    try {
      const r = await detector.detectOne('claude');
      expect(r).not.toBeNull();
      expect(r!.status).toBe('unavailable');
      expect(r!.reason).toBe('not-found');
      expect(r!.path).toBe('');
      expect(r!.version).toBeUndefined();
      expect(r!.versionWarning).toBeNull();
      // protocol 仍来自 PROVIDER_SPECS（即使 unavailable 也回填）。
      expect(r!.protocol).toBe('stream_json');
    } finally {
      spy.mockRestore();
    }
  });
});
