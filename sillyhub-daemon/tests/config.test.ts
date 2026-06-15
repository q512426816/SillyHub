// tests/config.test.ts
// task-12: config 配置持久化层。1:1 对齐 Python sillyhub_daemon/config.py 的字段/默认值/加载保存语义。
// 函数式重写：loadConfig 返回纯对象、saveConfig 接收对象（Python 是 class DaemonConfig + property）。
// 对照 Python: DEFAULTS(config.py:22-32) / _load(config.py:41-51) / save(config.py:53-57)。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  loadConfig,
  saveConfig,
  DEFAULT_CONFIG,
  DEFAULT_CONFIG_DIR,
  DEFAULT_CONFIG_PATH,
  type DaemonConfig,
} from '../src/config';

/** UUID v4 正则（crypto.randomUUID() 输出格式）。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('config', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sillyhub-config-'));
    configPath = join(tmpDir, 'config.json');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── AC-03：字段与默认值对照 Python config.py:22-32 DEFAULTS ──

  describe('字段与默认值（AC-03，对照 Python DEFAULTS）', () => {
    it('DEFAULT_CONFIG 正好 12 字段，键名 1:1（task-10 新增 default_timeout_seconds / max_retries；daemon-api-key 新增 api_key）', () => {
      expect(Object.keys(DEFAULT_CONFIG).sort()).toEqual([
        'api_key',
        'default_timeout_seconds',
        'heartbeat_interval',
        'log_level',
        'max_concurrent_tasks',
        'max_retries',
        'poll_interval',
        'profile',
        'runtime_id',
        'server_url',
        'token',
        'workspace_dir',
      ]);
    });

    it('默认值逐字对齐 Python', () => {
      expect(DEFAULT_CONFIG.server_url).toBe('http://localhost:8000');
      expect(DEFAULT_CONFIG.token).toBeNull();
      expect(DEFAULT_CONFIG.runtime_id).toBe(''); // 占位空串，load 时生成（对齐 Python None）
      expect(DEFAULT_CONFIG.profile).toBe('default');
      expect(DEFAULT_CONFIG.poll_interval).toBe(30);
      expect(DEFAULT_CONFIG.heartbeat_interval).toBe(15);
      expect(DEFAULT_CONFIG.max_concurrent_tasks).toBe(5);
      expect(DEFAULT_CONFIG.log_level).toBe('info');
      // task-10 B2/B3：超时兜底 + 重试上限
      expect(DEFAULT_CONFIG.default_timeout_seconds).toBe(1800);
      expect(DEFAULT_CONFIG.max_retries).toBe(1);
    });

    it('workspace_dir 默认 = ~/sillyhub_workspaces（对齐 Python str(Path.home()/...)）', () => {
      expect(DEFAULT_CONFIG.workspace_dir).toBe(join(homedir(), 'sillyhub_workspaces'));
    });

    it('token 类型为 string | null（默认 null，非 undefined）', () => {
      const cfg: DaemonConfig = { ...DEFAULT_CONFIG, runtime_id: 'x' };
      const t: string | null = cfg.token;
      expect(t).toBeNull();
    });

    it('DEFAULT_CONFIG_DIR / DEFAULT_CONFIG_PATH 与 Python 一致', () => {
      expect(DEFAULT_CONFIG_DIR).toBe(join(homedir(), '.sillyhub', 'daemon'));
      expect(DEFAULT_CONFIG_PATH).toBe(join(DEFAULT_CONFIG_DIR, 'config.json'));
    });
  });

  // ── AC-02：文件不存在 → 默认配置 + 自动生成 runtime_id ──

  describe('AC-02 文件不存在', () => {
    it('返回所有默认值，runtime_id 为合法 uuid v4', async () => {
      const cfg = await loadConfig(configPath);
      expect(cfg.server_url).toBe('http://localhost:8000');
      expect(cfg.token).toBeNull();
      expect(cfg.profile).toBe('default');
      expect(cfg.poll_interval).toBe(30);
      expect(cfg.heartbeat_interval).toBe(15);
      expect(cfg.max_concurrent_tasks).toBe(5);
      expect(cfg.log_level).toBe('info');
      expect(cfg.runtime_id).toMatch(UUID_RE);
    });

    it('自动生成的 runtime_id 立即落盘（对齐 Python _load 末尾 save）', async () => {
      const cfg = await loadConfig(configPath);
      const raw = await readFile(configPath, 'utf-8');
      expect(JSON.parse(raw).runtime_id).toBe(cfg.runtime_id);
    });
  });

  // ── AC-01：save/load 往返一致 ──

  describe('AC-01 save/load 往返', () => {
    it('改字段后 save 再 load，被改字段一致、runtime_id 不变', async () => {
      const cfg = await loadConfig(configPath);
      cfg.token = 'test-token-123';
      cfg.server_url = 'http://custom:9999';
      cfg.log_level = 'debug';
      await saveConfig(cfg, configPath);

      const reloaded = await loadConfig(configPath);
      expect(reloaded.token).toBe('test-token-123');
      expect(reloaded.server_url).toBe('http://custom:9999');
      expect(reloaded.log_level).toBe('debug');
      expect(reloaded.runtime_id).toBe(cfg.runtime_id); // uuid 已存在不重生
    });

    it('JSON indent=2（对齐 Python json.dump indent=2，git diff 友好）', async () => {
      const cfg: DaemonConfig = { ...DEFAULT_CONFIG, runtime_id: 'x' };
      await saveConfig(cfg, configPath);
      const raw = await readFile(configPath, 'utf-8');
      expect(raw).toContain('\n  "server_url"');
    });
  });

  // ── 缺字段合并默认（对齐 Python self._data.update(saved)）──

  describe('缺字段合并默认', () => {
    it('只写 token 的 config.json，其余补默认、runtime_id 仍生成', async () => {
      await writeFile(configPath, JSON.stringify({ token: 'partial' }), 'utf-8');
      const cfg = await loadConfig(configPath);
      expect(cfg.token).toBe('partial');
      expect(cfg.server_url).toBe('http://localhost:8000');
      expect(cfg.poll_interval).toBe(30);
      expect(cfg.runtime_id).toMatch(UUID_RE);
    });

    it('runtime_id 已存在时不重新生成', async () => {
      const existing = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      await writeFile(configPath, JSON.stringify({ runtime_id: existing }), 'utf-8');
      const cfg = await loadConfig(configPath);
      expect(cfg.runtime_id).toBe(existing);
    });

    it('runtime_id 为 null（用户写 null）也触发生成（边界 R5）', async () => {
      await writeFile(configPath, JSON.stringify({ runtime_id: null }), 'utf-8');
      const cfg = await loadConfig(configPath);
      expect(cfg.runtime_id).toMatch(UUID_RE);
    });

    it('runtime_id 为空串也触发生成', async () => {
      await writeFile(configPath, JSON.stringify({ runtime_id: '' }), 'utf-8');
      const cfg = await loadConfig(configPath);
      expect(cfg.runtime_id).toMatch(UUID_RE);
    });
  });

  // ── AC-04：save 自动建父目录 ──

  describe('AC-04 save 自动建父目录', () => {
    it('嵌套不存在的 a/b/c/config.json 也能写入（mkdir recursive）', async () => {
      const nested = join(tmpDir, 'a', 'b', 'c', 'config.json');
      const cfg: DaemonConfig = { ...DEFAULT_CONFIG, runtime_id: 'x' };
      await saveConfig(cfg, nested);
      const raw = await readFile(nested, 'utf-8');
      expect(JSON.parse(raw).runtime_id).toBe('x');
    });
  });

  // ── JSON 损坏抛错（不静默吞，对齐 Python 让 JSONDecodeError 冒泡）──

  describe('JSON 损坏', () => {
    it('损坏 JSON 抛 SyntaxError，不静默返回默认', async () => {
      await writeFile(configPath, '{ invalid json', 'utf-8');
      await expect(loadConfig(configPath)).rejects.toThrow(SyntaxError);
    });

    it('空文件（0 字节）抛错', async () => {
      await writeFile(configPath, '', 'utf-8');
      await expect(loadConfig(configPath)).rejects.toThrow();
    });
  });

  // ── DEFAULT_CONFIG 不被污染（防 loadConfig 误改常量）──

  describe('DEFAULT_CONFIG 不被污染', () => {
    it('loadConfig 后 DEFAULT_CONFIG.runtime_id 仍为空串', async () => {
      await loadConfig(configPath);
      expect(DEFAULT_CONFIG.runtime_id).toBe('');
    });

    it('DEFAULT_CONFIG 是 frozen（Object.freeze 双保险）', () => {
      expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);
    });
  });
});
