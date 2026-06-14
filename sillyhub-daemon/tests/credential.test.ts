// tests/credential.test.ts
// task-13: credential 凭据层。1:1 对齐 Python sillyhub_daemon/credential.py（127 行）。
// 对照 Python: CredentialManager(__init__ L35-49) / save(L51-59) / CRUD(L63-79)
//             render_config(L83-112) / build_env(L114-126)。
// 行为参考：tests/test_credential.py 全套用例迁移。

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialManager } from '../src/credential.js';

// 解构常用 fs 函数（命名导入）
const { mkdtempSync, existsSync, unlinkSync, rmSync, writeFileSync, readFileSync, statSync, chmodSync } = fs;

// ─────────────────────────────────────────────────────────────────────────────
// vi.mock 顶层 hoist：node:fs 的 ESM namespace 属性 non-configurable，
// vi.spyOn 无法重定义。改用 vi.mock factory + 模块级 flag 控制 chmodSync
// 是否抛错，仅在"Windows 降级"用例中开启。
// factory 用 await importActual 保留其余 fs 函数真实行为。
// ─────────────────────────────────────────────────────────────────────────────

// 模块级开关：true 时 chmodSync 抛 EPERM（模拟 Windows / 只读 fs）
let __chmodShouldThrow = false;

vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return {
    ...actual,
    chmodSync: (...args: Parameters<typeof actual.chmodSync>) => {
      if (__chmodShouldThrow) {
        throw new Error('EPERM: operation not permitted');
      }
      return actual.chmodSync(...args);
    },
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// 临时目录隔离（学 config.test.ts 的 mkdtemp + afterEach 清理写法）。
// 注意：每个 it 共享同一 tmpDir，beforeEach 清理文件保证用例间隔离。
// ─────────────────────────────────────────────────────────────────────────────

const tmpDir = mkdtempSync(join(tmpdir(), 'sillyhub-cred-'));
const credPath = join(tmpDir, 'credentials.json');

beforeEach(() => {
  // 每个用例独立凭证文件：删掉遗留文件（若无则跳过）
  if (existsSync(credPath)) unlinkSync(credPath);
});

// suite 跑完后清掉 tmpDir（afterAll，见文件末尾）

// ─────────────────────────────────────────────────────────────────────────────
// TestLoad（对照 Python TestLoad，test_credential.py:37-55）
// ─────────────────────────────────────────────────────────────────────────────

describe('CredentialManager._load / __init__（对照 Python TestLoad）', () => {
  it('加载已存在的 credentials.json（对照 Python test_loads_existing_file L38-44）', () => {
    writeFileSync(credPath, JSON.stringify({ api_key: 'sk-123' }));
    const mgr = new CredentialManager(credPath);
    expect(mgr.get('api_key')).toBe('sk-123');
  });

  it('文件不存在 → 空字典不抛错（对照 Python test_empty_when_file_missing L46-48）', () => {
    const noFile = join(tmpDir, 'nope.json');
    expect(() => new CredentialManager(noFile)).not.toThrow();
    expect(new CredentialManager(noFile).listKeys()).toEqual([]);
  });

  it('JSON 损坏 → 抛 SyntaxError（对照 Python test_handles_corrupt_json L50-55）', () => {
    writeFileSync(credPath, 'not json');
    // Python 抛 json.JSONDecodeError，Node 抛 SyntaxError（JSON.parse）
    expect(() => new CredentialManager(credPath)).toThrow(SyntaxError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TestSave（对照 Python TestSave，test_credential.py:63-85）
// ─────────────────────────────────────────────────────────────────────────────

describe('CredentialManager.save（对照 Python TestSave）', () => {
  it('自动创建父目录（对照 Python test_creates_parent_dirs L64-69）', () => {
    const deepPath = join(tmpDir, 'a', 'b', 'c', 'credentials.json');
    const mgr = new CredentialManager(deepPath);
    mgr.set('key', 'val');
    expect(existsSync(deepPath)).toBe(true);
  });

  it('写入合法 JSON（对照 Python test_writes_valid_json L71-76）', () => {
    const mgr = new CredentialManager(credPath);
    mgr.set('alpha', '1');
    mgr.set('beta', '2');
    const data = JSON.parse(readFileSync(credPath, 'utf-8'));
    expect(data).toEqual({ alpha: '1', beta: '2' });
  });

  it('写入 JSON indent=2（对齐 Python json.dump indent=2，diff 友好）', () => {
    const mgr = new CredentialManager(credPath);
    mgr.set('alpha', '1');
    const raw = readFileSync(credPath, 'utf-8');
    expect(raw).toContain('\n  "alpha"');
  });

  it('POSIX 下文件权限 0600（对照 Python test_file_permissions L78-85）', () => {
    const isPosix = process.platform !== 'win32';
    if (!isPosix) return; // Windows 跳过（NTFS 无 0600 语义）
    const mgr = new CredentialManager(credPath);
    mgr.set('key', 'val');
    const mode = statSync(credPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TestCrud（对照 Python TestCrud，test_credential.py:93-127）
// ─────────────────────────────────────────────────────────────────────────────

describe('CredentialManager CRUD（对照 Python TestCrud）', () => {
  it('get 返回值（对照 Python test_get_returns_value L94-96）', () => {
    const mgr = new CredentialManager(credPath);
    mgr.set('k', 'v');
    expect(mgr.get('k')).toBe('v');
  });

  it('get 缺失返回 undefined（对照 Python test_get_missing_returns_none L98-99）', () => {
    const mgr = new CredentialManager(credPath);
    // Python 返回 None；TS undefined（dict[k] 不存在即 undefined）
    expect(mgr.get('nonexistent')).toBeUndefined();
  });

  it('set 覆盖旧值（对照 Python test_set_overwrites L101-104）', () => {
    const mgr = new CredentialManager(credPath);
    mgr.set('k', 'old');
    mgr.set('k', 'new');
    expect(mgr.get('k')).toBe('new');
  });

  it('remove 删除 key（对照 Python test_remove_deletes_key L106-109）', () => {
    const mgr = new CredentialManager(credPath);
    mgr.set('k', 'v');
    mgr.remove('k');
    expect(mgr.get('k')).toBeUndefined();
  });

  it('remove 不存在的 key 不抛错（对照 Python test_remove_nonexistent_is_noop L111-112）', () => {
    const mgr = new CredentialManager(credPath);
    expect(() => mgr.remove('nope')).not.toThrow();
  });

  it('listKeys 返回所有 key（对照 Python test_list_keys L114-117）', () => {
    const mgr = new CredentialManager(credPath);
    mgr.set('a', '1');
    mgr.set('b', '2');
    expect(mgr.listKeys().sort()).toEqual(['a', 'b']);
  });

  it('listKeys 空数组（对照 Python test_list_keys_empty L119-120）', () => {
    const mgr = new CredentialManager(credPath);
    expect(mgr.listKeys()).toEqual([]);
  });

  it('set 立即持久化到磁盘（对照 Python test_set_persists_to_disk L122-127）', () => {
    const mgr = new CredentialManager(credPath);
    mgr.set('saved_key', 'saved_val');
    // 新实例从磁盘 reload，应读到相同值
    const mgr2 = new CredentialManager(credPath);
    expect(mgr2.get('saved_key')).toBe('saved_val');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TestRenderConfig（对照 Python TestRenderConfig，test_credential.py:135-192）
// ─────────────────────────────────────────────────────────────────────────────

describe('CredentialManager.renderConfig（对照 Python TestRenderConfig）', () => {
  it('占位符 → credentials.json 命中（优先级 1，对照 test_resolves_from_credentials L136-142）', () => {
    const mgr = new CredentialManager(credPath);
    mgr.set('USER_ANTHROPIC_API_KEY', 'sk-ant-real');
    const config = { anthropic_api_key: '{{USER_ANTHROPIC_API_KEY}}' };
    const result = mgr.renderConfig(config);
    expect(result.anthropic_api_key).toBe('sk-ant-real');
  });

  it('占位符 → credentials.json 无 + env 命中（优先级 2，对照 test_resolves_from_env_fallback L144-149）', () => {
    process.env.USER_GITHUB_TOKEN = 'ghp-abc';
    try {
      const mgr = new CredentialManager(credPath); // 空凭证文件
      const config = { github_token: '{{USER_GITHUB_TOKEN}}' };
      const result = mgr.renderConfig(config);
      expect(result.github_token).toBe('ghp-abc');
    } finally {
      delete process.env.USER_GITHUB_TOKEN;
    }
  });

  it('credentials.json 优先于 env（对照 test_credentials_take_priority_over_env L151-157）', () => {
    const mgr = new CredentialManager(credPath);
    mgr.set('USER_MY_KEY', 'from-file');
    process.env.USER_MY_KEY = 'from-env';
    try {
      const config = { my_key: '{{USER_MY_KEY}}' };
      const result = mgr.renderConfig(config);
      expect(result.my_key).toBe('from-file');
    } finally {
      delete process.env.USER_MY_KEY;
    }
  });

  it('两源都无 → 保留原占位符（对照 test_keeps_placeholder_if_unresolved L159-162）', () => {
    const mgr = new CredentialManager(credPath);
    const config = { key: '{{USER_MISSING}}' };
    const result = mgr.renderConfig(config);
    expect(result.key).toBe('{{USER_MISSING}}');
  });

  it('非占位符值原样返回（对照 test_non_placeholder_values_pass_through L164-167）', () => {
    const mgr = new CredentialManager(credPath);
    const config = { host: 'localhost', port: 8080 };
    const result = mgr.renderConfig(config);
    expect(result).toEqual({ host: 'localhost', port: 8080 });
  });

  it('混合 config（对照 test_mixed_config L169-183）', () => {
    const mgr = new CredentialManager(credPath);
    mgr.set('USER_KNOWN', 'resolved');
    const config = {
      known: '{{USER_KNOWN}}',
      unknown: '{{USER_UNKNOWN}}',
      plain: 'text',
      number: 42,
    };
    const result = mgr.renderConfig(config);
    expect(result.known).toBe('resolved');
    expect(result.unknown).toBe('{{USER_UNKNOWN}}');
    expect(result.plain).toBe('text');
    expect(result.number).toBe(42);
  });

  it('不修改入参 config（对照 test_does_not_mutate_input L185-192）', () => {
    const mgr = new CredentialManager(credPath);
    mgr.set('USER_KEY', 'val');
    const config = { k: '{{USER_KEY}}' };
    const original = { ...config };
    mgr.renderConfig(config);
    expect(config).toEqual(original);
  });

  // ── 蓝图 TDD §1 补充用例（边界）──

  it('credentials.json 空串 → 降级到 env（Python or 短路语义）', () => {
    // 先写入空串的凭证，set env 同名，应取 env 值（空串 falsy）
    writeFileSync(credPath, JSON.stringify({ USER_K: '' }));
    process.env.USER_K = 'env_val';
    try {
      const mgr = new CredentialManager(credPath);
      const out = mgr.renderConfig({ K: '{{USER_K}}' });
      expect(out.K).toBe('env_val');
    } finally {
      delete process.env.USER_K;
    }
  });

  it('非 {{USER_*}} 格式占位符原样保留（如 {{OTHER}}、子串 pre_{{USER_X}}）', () => {
    const mgr = new CredentialManager(credPath);
    mgr.set('USER_X', 'val');
    const out = mgr.renderConfig({
      a: 'plain',
      b: 123,
      c: '{{OTHER}}',
      d: 'pre_{{USER_X}}',
      e: '{{user_lower}}', // 大小写敏感，{{user_}} 不匹配 {{USER_
    });
    expect(out).toEqual({
      a: 'plain',
      b: 123,
      c: '{{OTHER}}',
      d: 'pre_{{USER_X}}', // 子串不解析
      e: '{{user_lower}}', // 大小写不匹配
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TestBuildEnv（对照 Python TestBuildEnv，test_credential.py:200-238）
// ─────────────────────────────────────────────────────────────────────────────

describe('CredentialManager.buildEnv（对照 Python TestBuildEnv）', () => {
  it('从已解析 config 构建 env（对照 test_builds_env_from_resolved_config L201-207）', () => {
    const mgr = new CredentialManager(credPath);
    mgr.set('USER_ANTHROPIC_API_KEY', 'sk-ant-123');
    const config = { anthropic_api_key: '{{USER_ANTHROPIC_API_KEY}}' };
    const env = mgr.buildEnv(config);
    expect(env).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-123' });
  });

  it('跳过未解析占位符（对照 test_skips_unresolved_placeholders L209-213）', () => {
    const mgr = new CredentialManager(credPath);
    const config = { missing_key: '{{USER_MISSING}}' };
    const env = mgr.buildEnv(config);
    expect(env).toEqual({});
  });

  it('key 转大写（对照 test_uppercases_keys L215-221）', () => {
    const mgr = new CredentialManager(credPath);
    mgr.set('USER_MY_KEY', 'val');
    const config = { my_key: '{{USER_MY_KEY}}' };
    const env = mgr.buildEnv(config);
    expect('MY_KEY' in env).toBe(true);
  });

  it('混合已解析/未解析（对照 test_mixed_resolved_and_unresolved L223-232）', () => {
    const mgr = new CredentialManager(credPath);
    mgr.set('USER_GOOD', 'yes');
    const config = { good: '{{USER_GOOD}}', bad: '{{USER_BAD}}' };
    const env = mgr.buildEnv(config);
    expect(env).toEqual({ GOOD: 'yes' });
  });

  it('plain 值也注入 env（对照 test_plain_values_included L234-238）', () => {
    const mgr = new CredentialManager(credPath);
    const config = { my_host: 'example.com' };
    const env = mgr.buildEnv(config);
    expect(env).toEqual({ MY_HOST: 'example.com' });
  });

  it('非 string 值（如 number）被跳过（buildEnv 只收 string）', () => {
    const mgr = new CredentialManager(credPath);
    const config = { num: 42, str: 'p' };
    const env = mgr.buildEnv(config);
    // number 不注入 env（env 必须是 string）
    expect(env).toEqual({ STR: 'p' });
    expect('NUM' in env).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Windows 降级（R-05 / FR-05，对照蓝图 TDD §4）
// ─────────────────────────────────────────────────────────────────────────────

describe('Windows chmod 降级（R-05）', () => {
  it('chmod 失败仅 warn 不抛错（对照蓝图 TDD §4）', () => {
    // 开启模块级开关：fs.chmodSync 抛 EPERM（模拟 Windows / 只读 fs）。
    // node:fs 的 ESM namespace 属性 non-configurable，vi.spyOn 无法重定义，
    // 故用文件顶部的 vi.mock factory + 模块级 flag 控制。
    __chmodShouldThrow = true;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const mgr = new CredentialManager(credPath);
      expect(() => mgr.set('USER_K', 'v')).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('credentials_chmod_failed'));
    } finally {
      __chmodShouldThrow = false;
      warnSpy.mockRestore();
    }
  });

  it('process.platform=win32 时仍能正常 set（虽 chmod 可能 EPERM，降级不中断）', () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const mgr = new CredentialManager(credPath);
      expect(() => mgr.set('USER_K', 'v')).not.toThrow();
      expect(mgr.get('USER_K')).toBe('v'); // 值仍写入文件（权限位降级不阻塞写入）
    } finally {
      warnSpy.mockRestore();
      if (origPlatform) Object.defineProperty(process, 'platform', origPlatform);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 日志覆盖（对照 Python logger 三级）
// ─────────────────────────────────────────────────────────────────────────────

describe('日志输出（对照 Python logger）', () => {
  it('文件不存在 → console.info credentials_file_not_found', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const noFile = join(tmpDir, 'absent.json');
    new CredentialManager(noFile);
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('credentials_file_not_found'));
    infoSpy.mockRestore();
  });

  it('加载成功 → console.debug credentials_loaded count=N', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    writeFileSync(credPath, JSON.stringify({ a: '1', b: '2', c: '3' }));
    new CredentialManager(credPath);
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('credentials_loaded count=3'));
    debugSpy.mockRestore();
  });

  it('占位符解析成功 → console.debug credential_resolved key=... source=credentials|env', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const mgr = new CredentialManager(credPath);
    mgr.set('USER_X', 'val');
    debugSpy.mockClear(); // 忽略 load 阶段日志
    mgr.renderConfig({ k: '{{USER_X}}' });
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('credential_resolved'),
    );
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('source=credentials'),
    );
    debugSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 全局清理：suite 跑完删 tmpDir
// ─────────────────────────────────────────────────────────────────────────────

afterAll(() => {
  if (existsSync(tmpDir)) {
    // 恢复权限后清理（某些用例可能把文件设为 0600 导致 rm 失败）
    try {
      chmodSync(tmpDir, 0o755);
    } catch {
      // ignore
    }
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
