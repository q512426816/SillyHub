// tests/agent-detector.test.ts
// task-16: agent-detector 探测器。1:1 迁移 sillyhub_daemon/tests/test_agent_detector.py 行为。
// 测试策略：子类覆写 protected 方法注入 mock（FakeDetector），避免真实 PATH / 子进程。
// 对照 Python: AGENT_DEFS(98-174) / _resolve_bin_path(224-243) / _detect_version(245-272) /
//   _detect_single(274-299) / detect_all(180-185) / detect_one(187-195) / is_available(197-207)。
// 不迁移: TestParseSemver / TestCheckMinVersion（已在 task-14 version.test.ts 覆盖）、
//   TestBackwardCompat（对应废弃 API，Node 版删除 AgentInfo / get_capabilities）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PROVIDER_SPECS,
  AgentDetector,
  normalizeProvider,
  type AgentProviderSpec,
  type DetectedAgent,
  type ProviderName,
} from '../src/agent-detector.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Test helper：可注入 fake PATH 查找 + fake exec 结果的子类
// ---------------------------------------------------------------------------

/** fake detectVersion 的输出：成功（stdout+stderr）/ 失败（抛错）。 */
type FakeExecResult =
  | { stdout: string; stderr: string }
  | { error: Error };

/**
 * 测试用子类：覆写 protected 方法注入 mock，避免真实 PATH / 子进程。
 * 对应 Python 版用 @patch 装饰器替换 shutil.which / asyncio.create_subprocess_exec。
 */
class FakeDetector extends AgentDetector {
  /** fakeFindOnPath: binName → 路径或 null（模拟 shutil.which）。 */
  fakeFindOnPath: (bin: string) => string | null = () => null;
  /**
   * fakeExecResult: 注入 detectVersion 的子进程输出（单一值，所有 provider 共享）。
   * - { stdout, stderr } → 正常合并扫描
   * - { error } → 子进程抛错（ENOENT / Timeout / OSError）
   * - null → 未设置（fakeFindOnPath 通常返回 null，触发不到此分支）
   */
  fakeExecResult: FakeExecResult | null = null;
  /**
   * fakeExecByProvider: 按 provider 名注入不同 exec 结果（优先于 fakeExecResult）。
   * 用于「多 provider 同时可用且各自 version 不同」场景（task-22 P0-B 补漏）。
   */
  fakeExecByProvider: Record<string, FakeExecResult> = {};

  protected override findOnPath(binName: string): string | null {
    return this.fakeFindOnPath(binName);
  }

  protected override detectVersion(
    _binPath: string,
    spec: AgentProviderSpec,
  ): Promise<string | null> {
    // 优先查 per-provider map（key=spec.bin，未命中回退单一 fakeExecResult）
    const result = this.fakeExecByProvider[spec.bin] ?? this.fakeExecResult;
    if (result === null || result === undefined) {
      return Promise.resolve(null);
    }
    if ('error' in result) {
      // 模拟子进程异常分支 → 统一返回 null（对齐 Python except 块）。
      return Promise.resolve(null);
    }
    const { stdout, stderr } = result;
    const output = stdout + stderr;
    const m = spec.versionPattern.exec(output);
    return Promise.resolve(m && m[1] ? m[1] : null);
  }
}

/**
 * 清空所有 SILLYHUB_*_PATH 环境变量，避免本机真实 env 干扰测试。
 * 对应 Python 测试用 @patch.dict(os.environ, {}, clear=True)。
 */
function clearAllSillyhubEnv(): void {
  for (const key of Object.keys(PROVIDER_SPECS)) {
    const spec = (PROVIDER_SPECS as Record<string, AgentProviderSpec>)[key];
    delete process.env[spec.envPath];
  }
}

// ---------------------------------------------------------------------------
// PROVIDER_SPECS（对照 TestAgentDefs）
// ---------------------------------------------------------------------------

describe('PROVIDER_SPECS', () => {
  it('恰好 12 个 entry（对齐 Python AGENT_DEFS）', () => {
    expect(Object.keys(PROVIDER_SPECS)).toHaveLength(12);
  });

  it('12 个 provider 的 protocol 字段与期望表一致', () => {
    const expected: Record<string, string> = {
      claude: 'stream_json',
      codex: 'json_rpc',
      copilot: 'jsonl',
      opencode: 'ndjson',
      openclaw: 'ndjson',
      hermes: 'json_rpc',
      gemini: 'stream_json',
      pi: 'pi_json',
      cursor: 'stream_json',
      kimi: 'json_rpc',
      kiro: 'json_rpc',
      antigravity: 'text',
    };
    for (const [name, proto] of Object.entries(expected)) {
      expect(
        (PROVIDER_SPECS as Record<string, AgentProviderSpec>)[name]?.protocol,
      ).toBe(proto);
    }
  });

  it('12 个 provider 顺序与 Python AGENT_DEFS 一致', () => {
    // Python dict 在 3.7+ 保持插入顺序；Node 对象字面量同样保持插入顺序。
    expect(Object.keys(PROVIDER_SPECS)).toEqual([
      'claude',
      'codex',
      'copilot',
      'opencode',
      'openclaw',
      'hermes',
      'gemini',
      'pi',
      'cursor',
      'kimi',
      'kiro',
      'antigravity',
    ]);
  });

  it('claude minVersion === "2.0.0"', () => {
    expect(PROVIDER_SPECS.claude.minVersion).toBe('2.0.0');
  });

  it('codex minVersion === "0.100.0"', () => {
    expect(PROVIDER_SPECS.codex.minVersion).toBe('0.100.0');
  });

  it('copilot minVersion === "1.0.0"', () => {
    expect(PROVIDER_SPECS.copilot.minVersion).toBe('1.0.0');
  });

  it('9 个无版本要求的 provider minVersion === undefined', () => {
    const noMin = [
      'opencode',
      'openclaw',
      'hermes',
      'gemini',
      'pi',
      'cursor',
      'kimi',
      'kiro',
      'antigravity',
    ];
    for (const name of noMin) {
      expect(
        (PROVIDER_SPECS as Record<string, AgentProviderSpec>)[name]?.minVersion,
      ).toBeUndefined();
    }
  });

  it('claude envPath === "SILLYHUB_CLAUDE_PATH"', () => {
    expect(PROVIDER_SPECS.claude.envPath).toBe('SILLYHUB_CLAUDE_PATH');
  });

  it('cursor 的 bin 是 cursor-agent（不是 cursor）', () => {
    expect(PROVIDER_SPECS.cursor.bin).toBe('cursor-agent');
  });

  it('kiro 的 bin 是 kiro-cli', () => {
    expect(PROVIDER_SPECS.kiro.bin).toBe('kiro-cli');
  });

  it('antigravity 的 bin 是 agy', () => {
    expect(PROVIDER_SPECS.antigravity.bin).toBe('agy');
  });

  it('claude versionPattern 匹配前缀格式 "Claude Code 2.1.5"', () => {
    const m = PROVIDER_SPECS.claude.versionPattern.exec('Claude Code 2.1.5\n');
    expect(m && m[1]).toBe('2.1.5');
  });

  it('claude versionPattern 匹配后缀格式 "2.1.150 (Claude Code)"', () => {
    const m = PROVIDER_SPECS.claude.versionPattern.exec(
      '2.1.150 (Claude Code)\n',
    );
    expect(m && m[1]).toBe('2.1.150');
  });
});

// ---------------------------------------------------------------------------
// resolveBinPath（对照 TestResolveBinPath）
// ---------------------------------------------------------------------------

/** 测试通过子类访问 protected 方法。 */
type ResolveBinPathFn = (spec: AgentProviderSpec) => string | null;

describe('AgentDetector.resolveBinPath', () => {
  beforeEach(() => clearAllSillyhubEnv());
  afterEach(() => clearAllSillyhubEnv());

  it('env 覆盖优先（指向存在文件）', () => {
    const detector = new AgentDetector();
    // process.execPath 必然存在（当前 Node 可执行文件），模拟 Python os.path.isfile=True。
    process.env.SILLYHUB_CLAUDE_PATH = process.execPath;
    const spec = PROVIDER_SPECS.claude;
    const r = (detector as unknown as { resolveBinPath: ResolveBinPathFn })
      .resolveBinPath(spec);
    expect(r).toBe(process.execPath);
  });

  it('env 覆盖指向不存在路径 → 降级到 findOnPath', () => {
    const detector = new FakeDetector();
    detector.fakeFindOnPath = () => '/usr/bin/claude';
    process.env.SILLYHUB_CLAUDE_PATH = '/nonexistent/claude';
    const spec = PROVIDER_SPECS.claude;
    const r = (detector as unknown as { resolveBinPath: ResolveBinPathFn })
      .resolveBinPath(spec);
    expect(r).toBe('/usr/bin/claude');
  });

  it('env 为空串 → 走 findOnPath（空串视为未设）', () => {
    const detector = new FakeDetector();
    detector.fakeFindOnPath = () => '/usr/bin/claude';
    process.env.SILLYHUB_CLAUDE_PATH = '';
    const spec = PROVIDER_SPECS.claude;
    const r = (detector as unknown as { resolveBinPath: ResolveBinPathFn })
      .resolveBinPath(spec);
    expect(r).toBe('/usr/bin/claude');
  });

  it('无 env → 直接走 findOnPath', () => {
    const detector = new FakeDetector();
    detector.fakeFindOnPath = () => '/usr/bin/claude';
    const spec = PROVIDER_SPECS.claude;
    const r = (detector as unknown as { resolveBinPath: ResolveBinPathFn })
      .resolveBinPath(spec);
    expect(r).toBe('/usr/bin/claude');
  });

  it('PATH 上无匹配 → null', () => {
    const detector = new FakeDetector();
    detector.fakeFindOnPath = () => null;
    const spec = PROVIDER_SPECS.claude;
    const r = (detector as unknown as { resolveBinPath: ResolveBinPathFn })
      .resolveBinPath(spec);
    expect(r).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectVersion（对照 TestDetectVersion，通过 FakeDetector 覆写注入子进程结果）
// ---------------------------------------------------------------------------

type DetectVersionFn = (
  binPath: string,
  spec: AgentProviderSpec,
) => Promise<string | null>;

describe('AgentDetector.detectVersion', () => {
  it('claude 前缀格式 "Claude Code 2.1.5" → "2.1.5"', async () => {
    const d = new FakeDetector();
    d.fakeExecResult = { stdout: 'Claude Code 2.1.5\n', stderr: '' };
    const r = await (
      d as unknown as { detectVersion: DetectVersionFn }
    ).detectVersion('/usr/bin/claude', PROVIDER_SPECS.claude);
    expect(r).toBe('2.1.5');
  });

  it('claude 后缀格式 "2.1.150 (Claude Code)" → "2.1.150"', async () => {
    const d = new FakeDetector();
    d.fakeExecResult = { stdout: '2.1.150 (Claude Code)\n', stderr: '' };
    const r = await (
      d as unknown as { detectVersion: DetectVersionFn }
    ).detectVersion('/usr/bin/claude', PROVIDER_SPECS.claude);
    expect(r).toBe('2.1.150');
  });

  it('codex 通用格式 "codex 0.1.2" → "0.1.2"', async () => {
    const d = new FakeDetector();
    d.fakeExecResult = { stdout: 'codex 0.1.2\n', stderr: '' };
    const r = await (
      d as unknown as { detectVersion: DetectVersionFn }
    ).detectVersion('/usr/bin/codex', PROVIDER_SPECS.codex);
    expect(r).toBe('0.1.2');
  });

  it('正则不匹配 "unknown output" → null', async () => {
    const d = new FakeDetector();
    d.fakeExecResult = { stdout: 'unknown output\n', stderr: '' };
    const r = await (
      d as unknown as { detectVersion: DetectVersionFn }
    ).detectVersion('/usr/bin/claude', PROVIDER_SPECS.claude);
    expect(r).toBeNull();
  });

  it('子进程抛错（ENOENT）→ null', async () => {
    const d = new FakeDetector();
    d.fakeExecResult = { error: new Error('spawn ENOENT') };
    const r = await (
      d as unknown as { detectVersion: DetectVersionFn }
    ).detectVersion('/usr/bin/claude', PROVIDER_SPECS.claude);
    expect(r).toBeNull();
  });

  it('子进程抛错（Timeout）→ null', async () => {
    const d = new FakeDetector();
    d.fakeExecResult = { error: new Error('timed out') };
    const r = await (
      d as unknown as { detectVersion: DetectVersionFn }
    ).detectVersion('/usr/bin/claude', PROVIDER_SPECS.claude);
    expect(r).toBeNull();
  });

  it('stderr 含版本号也能匹配（stdout+stderr 合并扫描）', async () => {
    // 对齐 Python _detect_version：output = stdout + stderr，正则在合并串上 search。
    const d = new FakeDetector();
    d.fakeExecResult = { stdout: '', stderr: 'codex 0.131.0\n' };
    const r = await (
      d as unknown as { detectVersion: DetectVersionFn }
    ).detectVersion('/usr/bin/codex', PROVIDER_SPECS.codex);
    expect(r).toBe('0.131.0');
  });
});

// ---------------------------------------------------------------------------
// detectAgents（对照 TestDetectAll）
// ---------------------------------------------------------------------------

describe('AgentDetector.detectAgents', () => {
  beforeEach(() => clearAllSillyhubEnv());
  afterEach(() => clearAllSillyhubEnv());

  it('全部不可用 → 12 条 status="unavailable"（对齐 Python test_detect_all_marks_unavailable）', async () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = () => null;
    const results = await d.detectAgents();
    expect(results).toHaveLength(12);
    expect(results.every((r) => r.status === 'unavailable')).toBe(true);
    expect(results.every((r) => r.path === '')).toBe(true);
    expect(results.every((r) => r.version === undefined)).toBe(true);
    expect(results.every((r) => r.reason === 'not-found')).toBe(true);
    // versionWarning 在不可用分支也应为 null（未触发 checkMinVersion）。
    expect(results.every((r) => r.versionWarning === null)).toBe(true);
    // runtimeId 始终 undefined（待 task-20 注册回填）。
    expect(results.every((r) => r.runtimeId === undefined)).toBe(true);
  });

  it('claude 可用 + 版本达标 → status="available" + version + protocol', async () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = (bin) => (bin === 'claude' ? '/usr/bin/claude' : null);
    d.fakeExecResult = { stdout: 'Claude Code 2.1.5\n', stderr: '' };
    const results = await d.detectAgents();
    expect(results).toHaveLength(12);
    const claude = results.find((r) => r.provider === 'claude');
    expect(claude).toBeDefined();
    expect(claude?.status).toBe('available');
    expect(claude?.path).toBe('/usr/bin/claude');
    expect(claude?.version).toBe('2.1.5');
    expect(claude?.protocol).toBe('stream_json');
    expect(claude?.versionWarning).toBeNull();
    // 其余 11 个仍 unavailable。
    expect(results.filter((r) => r.status === 'unavailable')).toHaveLength(11);
  });

  it('串行探测：12 个 provider 顺序与 PROVIDER_SPECS 一致', async () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = () => null;
    const results = await d.detectAgents();
    expect(results.map((r) => r.provider)).toEqual(
      Object.keys(PROVIDER_SPECS),
    );
  });
});

// ---------------------------------------------------------------------------
// detectOne（对照 TestDetectOne）
// ---------------------------------------------------------------------------

describe('AgentDetector.detectOne', () => {
  beforeEach(() => clearAllSillyhubEnv());
  afterEach(() => clearAllSillyhubEnv());

  it('未知 provider → null', async () => {
    const d = new AgentDetector();
    expect(await d.detectOne('nonexistent')).toBeNull();
  });

  it('claude 找到 → DetectedAgent（available）', async () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = () => '/usr/bin/claude';
    d.fakeExecResult = { stdout: 'Claude Code 2.1.5\n', stderr: '' };
    const r = await d.detectOne('claude');
    expect(r).not.toBeNull();
    expect(r?.provider).toBe('claude');
    expect(r?.status).toBe('available');
    expect(r?.version).toBe('2.1.5');
    expect(r?.protocol).toBe('stream_json');
  });

  it('claude PATH 上无 → status="unavailable"（返回对象非 null）', async () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = () => null;
    const r = await d.detectOne('claude');
    expect(r).not.toBeNull();
    expect(r?.status).toBe('unavailable');
    expect(r?.reason).toBe('not-found');
    expect(r?.path).toBe('');
    expect(r?.version).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// cursor 版本探测 fallback（ql-20260620-002-f8c1：绕过坏掉的 cursor-agent.ps1）
// ---------------------------------------------------------------------------

describe('AgentDetector cursor 版本 fallback', () => {
  beforeEach(() => clearAllSillyhubEnv());
  afterEach(() => clearAllSillyhubEnv());

  /** 在临时目录构造 cursor-agent.cmd +（可选）versions/<ver>/{node.exe,index.js}，返回根与 cmd 路径。 */
  function makeCursorRoot(ver: string | null): { root: string; cmdPath: string } {
    const root = mkdtempSync(join(tmpdir(), 'cursor-fallback-'));
    const cmdPath = join(root, 'cursor-agent.cmd');
    writeFileSync(cmdPath, '@echo off\n');
    if (ver) {
      const vDir = join(root, 'versions', ver);
      mkdirSync(vDir, { recursive: true });
      writeFileSync(join(vDir, 'node.exe'), '');
      writeFileSync(join(vDir, 'index.js'), '');
    }
    return { root, cmdPath };
  }

  it('--version 失败 + 存在 versions 目录 → version 取目录名（绕过 ps1）', async () => {
    const { root, cmdPath } = makeCursorRoot('2026.06.16-20-30-07-a07d3ac');
    try {
      const d = new FakeDetector();
      d.fakeFindOnPath = (bin) => (bin === 'cursor-agent' ? cmdPath : null);
      // 模拟官方 ps1 坏掉：cursor-agent --version exit 1 → detectVersion 返回 null
      d.fakeExecResult = { error: new Error('cursor-agent.ps1 exit 1') };
      const r = await d.detectOne('cursor');
      expect(r).not.toBeNull();
      expect(r?.status).toBe('available');
      expect(r?.version).toBe('2026.06.16-20-30-07-a07d3ac');
      expect(r?.path).toBe(cmdPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('--version 失败 + 无 versions 目录 → version 仍 undefined（回落原行为）', async () => {
    const { root, cmdPath } = makeCursorRoot(null);
    try {
      const d = new FakeDetector();
      d.fakeFindOnPath = (bin) => (bin === 'cursor-agent' ? cmdPath : null);
      d.fakeExecResult = { error: new Error('exit 1') };
      const r = await d.detectOne('cursor');
      expect(r?.status).toBe('available');
      expect(r?.version).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('--version 成功 → 不走 fallback，用 --version 结果', async () => {
    const { root, cmdPath } = makeCursorRoot('2026.06.16-20-30-07-a07d3ac');
    try {
      const d = new FakeDetector();
      d.fakeFindOnPath = (bin) => (bin === 'cursor-agent' ? cmdPath : null);
      d.fakeExecByProvider = { 'cursor-agent': { stdout: '1.2.3', stderr: '' } };
      const r = await d.detectOne('cursor');
      // --version 成功取到 1.2.3，即便有 versions 目录也不回落到目录名
      expect(r?.version).toBe('1.2.3');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('非 cursor provider --version 失败 + 有 versions 目录 → 不触发 fallback', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cursor-fallback-'));
    const cmdPath = join(root, 'codex');
    writeFileSync(cmdPath, '');
    // 故意在 codex 目录下放 versions，验证 fallback 仅对 cursor 生效
    const vDir = join(root, 'versions', '2026.06.16-20-30-07-a07d3ac');
    mkdirSync(vDir, { recursive: true });
    writeFileSync(join(vDir, 'node.exe'), '');
    writeFileSync(join(vDir, 'index.js'), '');
    try {
      const d = new FakeDetector();
      d.fakeFindOnPath = (bin) => (bin === 'codex' ? cmdPath : null);
      d.fakeExecResult = { error: new Error('exit 1') };
      const r = await d.detectOne('codex');
      expect(r?.status).toBe('available');
      expect(r?.version).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// versionWarning（对照 TestVersionWarning）
// ---------------------------------------------------------------------------

describe('AgentDetector versionWarning', () => {
  beforeEach(() => clearAllSillyhubEnv());
  afterEach(() => clearAllSillyhubEnv());

  it('claude 低于最低（1.0.0 < 2.0.0）→ warning 含 "2.0.0"，status 仍 available', async () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = () => '/usr/bin/claude';
    d.fakeExecResult = { stdout: 'Claude Code 1.0.0\n', stderr: '' };
    const results = await d.detectAgents();
    const claude = results.find((r) => r.provider === 'claude');
    expect(claude).toBeDefined();
    expect(claude?.versionWarning).not.toBeNull();
    expect(claude?.versionWarning).toContain('2.0.0');
    // 低于最低版本不剔除，仍可注册（warning 透传给 UI）。
    expect(claude?.status).toBe('available');
  });

  it('claude 达标（3.0.0 ≥ 2.0.0）→ versionWarning === null', async () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = () => '/usr/bin/claude';
    d.fakeExecResult = { stdout: 'Claude Code 3.0.0\n', stderr: '' };
    const results = await d.detectAgents();
    const claude = results.find((r) => r.provider === 'claude');
    expect(claude?.versionWarning).toBeNull();
  });

  it('claude 恰好等于最低（2.0.0）→ versionWarning === null（边界，>= 视为达标）', async () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = () => '/usr/bin/claude';
    d.fakeExecResult = { stdout: 'Claude Code 2.0.0\n', stderr: '' };
    const results = await d.detectAgents();
    const claude = results.find((r) => r.provider === 'claude');
    expect(claude?.versionWarning).toBeNull();
  });

  it('opencode 无 minVersion 要求 → versionWarning === null', async () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = (bin) => (bin === 'opencode' ? '/usr/bin/opencode' : null);
    d.fakeExecResult = { stdout: 'opencode 0.1.0\n', stderr: '' };
    const results = await d.detectAgents();
    const opencode = results.find((r) => r.provider === 'opencode');
    expect(opencode?.versionWarning).toBeNull();
  });

  it('codex 低于最低（0.1.0 < 0.100.0）→ warning 含 "0.100.0"', async () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = (bin) => (bin === 'codex' ? '/usr/bin/codex' : null);
    d.fakeExecResult = { stdout: 'codex 0.1.0\n', stderr: '' };
    const results = await d.detectAgents();
    const codex = results.find((r) => r.provider === 'codex');
    expect(codex?.versionWarning).not.toBeNull();
    expect(codex?.versionWarning).toContain('0.100.0');
  });

  it('--version 解析失败（version undefined）→ versionWarning === null（不叠加噪声）', async () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = () => '/usr/bin/claude';
    // 正则不匹配，version 解析为 null。
    d.fakeExecResult = { stdout: 'totally unknown format\n', stderr: '' };
    const results = await d.detectAgents();
    const claude = results.find((r) => r.provider === 'claude');
    expect(claude?.version).toBeUndefined();
    expect(claude?.versionWarning).toBeNull();
    // 找到二进制即视为可用（status 不受 version 解析失败影响）。
    expect(claude?.status).toBe('available');
  });
});

// ---------------------------------------------------------------------------
// isAvailable（对照 TestIsAvailable）
// ---------------------------------------------------------------------------

describe('AgentDetector.isAvailable', () => {
  beforeEach(() => clearAllSillyhubEnv());
  afterEach(() => clearAllSillyhubEnv());

  it('env 覆盖指向存在文件 → true（仅 PATH 解析，不执行 --version）', () => {
    const d = new AgentDetector();
    process.env.SILLYHUB_CLAUDE_PATH = process.execPath;
    expect(d.isAvailable('claude')).toBe(true);
  });

  it('env 指向不存在路径 → 降级 findOnPath 命中 → true', () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = () => '/usr/bin/claude';
    process.env.SILLYHUB_CLAUDE_PATH = '/nonexistent/claude';
    expect(d.isAvailable('claude')).toBe(true);
  });

  it('PATH 上有 → true', () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = () => '/usr/bin/claude';
    expect(d.isAvailable('claude')).toBe(true);
  });

  it('PATH 上无 → false', () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = () => null;
    expect(d.isAvailable('claude')).toBe(false);
  });

  it('未知 provider → false（不抛错）', () => {
    const d = new AgentDetector();
    expect(d.isAvailable('nonexistent')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findOnPath 真实路径查找（用 mkdtemp 构造可控 PATH）
// ---------------------------------------------------------------------------

import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * 跨平台测试 helper：返回 findOnPath 能识别的可执行文件名 + 内容。
 * Windows 上 findOnPath 只认 .exe/.cmd/.bat/.ps1（WINDOWS_EXTS），无扩展名文件
 * 会被跳过；Unix 无扩展名即可。本 helper 让这组真实 PATH 测试在双平台都通过。
 */
function makeBin(dir: string, name: string): string {
  const isWin = process.platform === 'win32';
  const fileName = isWin ? `${name}.cmd` : name;
  const path = join(dir, fileName);
  writeFileSync(path, isWin ? '@echo hi\r\n' : '#!/bin/sh\necho hi\n', { mode: 0o755 });
  return path;
}

describe('AgentDetector.findOnPath（真实 PATH 解析）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sillyhub-detector-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('PATH 上存在同名文件 → 返回绝对路径', () => {
    const binPath = makeBin(tmpDir, 'claude');
    const detector = new AgentDetector();
    const originalPath = process.env.PATH;
    process.env.PATH = tmpDir;
    try {
      const r = (
        detector as unknown as {
          findOnPath: (bin: string) => string | null;
        }
      ).findOnPath('claude');
      expect(r).toBe(binPath);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('PATH 上有同名目录（非文件）→ 跳过，继续找下一个', () => {
    // 在 tmpDir 下造一个名为 claude 的目录，应被 statSync().isFile() 排除。
    mkdirSync(join(tmpDir, 'claude'));
    const subDir = join(tmpDir, 'sub');
    mkdirSync(subDir);
    const realBin = makeBin(subDir, 'claude');

    const detector = new AgentDetector();
    const originalPath = process.env.PATH;
    // PATH 顺序：先含目录的 tmpDir，再含真实文件的 subDir（用 delimiter 跨平台）。
    process.env.PATH = `${tmpDir}${delimiter}${subDir}`;
    try {
      const r = (
        detector as unknown as {
          findOnPath: (bin: string) => string | null;
        }
      ).findOnPath('claude');
      expect(r).toBe(realBin);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('PATH 全部目录都不含目标 → null', () => {
    const detector = new AgentDetector();
    const originalPath = process.env.PATH;
    process.env.PATH = tmpDir;
    try {
      const r = (
        detector as unknown as {
          findOnPath: (bin: string) => string | null;
        }
      ).findOnPath('definitely-not-exists-xyz');
      expect(r).toBeNull();
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('PATH 为空 → null', () => {
    const detector = new AgentDetector();
    const originalPath = process.env.PATH;
    delete process.env.PATH;
    try {
      const r = (
        detector as unknown as {
          findOnPath: (bin: string) => string | null;
        }
      ).findOnPath('claude');
      expect(r).toBeNull();
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('PATH 取首个匹配（重复 provider）', () => {
    // 两个目录都含 claude，应返回 PATH 中靠前的那个。
    const dirA = join(tmpDir, 'a');
    const dirB = join(tmpDir, 'b');
    mkdirSync(dirA);
    mkdirSync(dirB);
    const binA = makeBin(dirA, 'claude');
    makeBin(dirB, 'claude');

    const detector = new AgentDetector();
    const originalPath = process.env.PATH;
    process.env.PATH = `${dirA}${delimiter}${dirB}`;
    try {
      const r = (
        detector as unknown as {
          findOnPath: (bin: string) => string | null;
        }
      ).findOnPath('claude');
      expect(r).toBe(binA);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

// ---------------------------------------------------------------------------
// P0-B 补漏：多 provider 同时可用 / isAvailable / resolveBinPath env 正向 / stdout 优先
// （task-22 P0-B，对齐 Python test_agent_detector.py 剩余缺口）
// ---------------------------------------------------------------------------

describe('AgentDetector P0-B 补漏（多 provider / isAvailable / env 正向）', () => {
  beforeEach(() => clearAllSillyhubEnv());
  afterEach(() => clearAllSillyhubEnv());

  // 补漏 1：多 provider 同时可用，各自 version/path/protocol 独立正确
  it('claude + codex + gemini 同时可用 → 各自 version/path/protocol 独立，其余 unavailable', async () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = (bin) => {
      if (bin === 'claude') return '/usr/bin/claude';
      if (bin === 'codex') return '/usr/bin/codex';
      if (bin === 'gemini') return '/usr/bin/gemini';
      return null;
    };
    d.fakeExecByProvider = {
      claude: { stdout: 'Claude Code 2.1.5\n', stderr: '' },
      codex: { stdout: 'codex 0.131.0\n', stderr: '' },
      gemini: { stdout: 'gemini 1.0.0\n', stderr: '' },
    };
    const results = await d.detectAgents();
    expect(results).toHaveLength(12);

    const claude = results.find((r) => r.provider === 'claude');
    const codex = results.find((r) => r.provider === 'codex');
    const gemini = results.find((r) => r.provider === 'gemini');

    expect(claude?.status).toBe('available');
    expect(claude?.version).toBe('2.1.5');
    expect(claude?.path).toBe('/usr/bin/claude');
    expect(claude?.protocol).toBe('stream_json');

    expect(codex?.status).toBe('available');
    expect(codex?.version).toBe('0.131.0');
    expect(codex?.protocol).toBe('json_rpc');

    expect(gemini?.status).toBe('available');
    expect(gemini?.version).toBe('1.0.0');
    expect(gemini?.protocol).toBe('stream_json');

    // 其余 9 个 unavailable
    expect(results.filter((r) => r.status === 'unavailable')).toHaveLength(9);
  });

  // 补漏 2：isAvailable 公开方法（对齐 Python is_available）
  it('isAvailable: PATH 上有 claude → true；无 nonexistent → false', () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = (bin) => (bin === 'claude' ? '/usr/bin/claude' : null);
    // isAvailable 不调 detectVersion（仅存在性，对齐 agent-detector.ts:230 注释）
    expect(d.isAvailable('claude')).toBe(true);
    expect(d.isAvailable('nonexistent')).toBe(false);
  });

  // 补漏 3：isAvailable 未知 provider 名 → false（不抛错）
  it('isAvailable: 未知 provider 名 → false（容错）', () => {
    const d = new AgentDetector();
    expect(d.isAvailable('totally-unknown-provider')).toBe(false);
  });

  // 补漏 4：resolveBinPath env 指向真实存在文件 → 直接返回 env 路径（不走 findOnPath）
  it('resolveBinPath: env 指向存在文件 → 返回 env 路径，fakeFindOnPath 不被调用', () => {
    const d = new FakeDetector();
    let pathCalled = false;
    d.fakeFindOnPath = () => {
      pathCalled = true;
      return '/should/not/be/used';
    };
    process.env.SILLYHUB_CODEX_PATH = process.execPath; // 真实存在的文件
    type ResolveFn = (spec: AgentProviderSpec) => string | null;
    const r = (d as unknown as { resolveBinPath: ResolveFn }).resolveBinPath(PROVIDER_SPECS.codex);
    expect(r).toBe(process.execPath);
    expect(pathCalled).toBe(false); // env 命中存在文件，不走 PATH 兜底
  });

  // 补漏 5：detectVersion stdout 和 stderr 都有版本号 → 优先 stdout 匹配
  it('detectVersion: stdout 和 stderr 都有版本号 → 正则取首个匹配（stdout 先拼接）', async () => {
    const d = new FakeDetector();
    d.fakeExecResult = {
      stdout: 'codex 0.131.0\n',
      stderr: 'codex 0.99.0\n', // stderr 也有，但 stdout 先拼接，正则取首个
    };
    type DetectFn = (binPath: string, spec: AgentProviderSpec) => Promise<string | null>;
    const r = await (d as unknown as { detectVersion: DetectFn })
      .detectVersion('/usr/bin/codex', PROVIDER_SPECS.codex);
    expect(r).toBe('0.131.0');
  });
});

// ql-20260703-001：normalizeProvider（backend adapter id → daemon detector
// provider key）。interactive lease claim payload 的 provider 来自 backend
// AgentRun.agent_type（默认 'claude_code'），daemon _agentPaths 按 detector key
// （'claude'）注册，边界必须归一化，否则 _agentPaths.get 失败静默卡死。
describe('normalizeProvider', () => {
  it('claude_code → claude（backend adapter id 归一化，修 P0-B 根因）', () => {
    expect(normalizeProvider('claude_code')).toBe('claude');
  });
  it('claude-code legacy 连字符 → claude（防御，service.py:382 已规范为下划线）', () => {
    expect(normalizeProvider('claude-code')).toBe('claude');
  });
  it('codex / opencode / cursor / openclaw 原样透传（adapter id 与 detector key 同名）', () => {
    expect(normalizeProvider('codex')).toBe('codex');
    expect(normalizeProvider('opencode')).toBe('opencode');
    expect(normalizeProvider('cursor')).toBe('cursor');
    expect(normalizeProvider('openclaw')).toBe('openclaw');
  });
  it('空值 → claude（兜底，backend 默认 claude_code，空值罕见）', () => {
    expect(normalizeProvider(undefined)).toBe('claude');
    expect(normalizeProvider(null)).toBe('claude');
    expect(normalizeProvider('')).toBe('claude');
    expect(normalizeProvider('  ')).toBe('claude');
  });
  it('未知 adapter id 原样返回（_agentPaths.get 兜底，命中失败走 daemon.ts:2355 早返回+回传）', () => {
    expect(normalizeProvider('some_new_adapter')).toBe('some_new_adapter');
  });
});
