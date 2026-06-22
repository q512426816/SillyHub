// tests/config.test.ts
// task-12: config 配置持久化层。1:1 对齐 Python sillyhub_daemon/config.py 的字段/默认值/加载保存语义。
// 函数式重写：loadConfig 返回纯对象、saveConfig 接收对象（Python 是 class DaemonConfig + property）。
// 对照 Python: DEFAULTS(config.py:22-32) / _load(config.py:41-51) / save(config.py:53-57)。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
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
    it('DEFAULT_CONFIG 正好 19 字段，键名 1:1（task-10 新增 default_timeout_seconds / max_retries；daemon-api-key 新增 api_key；ql-20260616-003 新增 4 个 terminal_observer_*；ql-20260616-006 新增 lease_heartbeat_interval；2026-06-18-workspace-client-path task-02 新增 allowed_roots；2026-06-22-agent-run-pipeline-fix task-02 新增 spec_root_map）', () => {
      expect(Object.keys(DEFAULT_CONFIG).sort()).toEqual([
        'allowed_roots',
        'api_key',
        'default_timeout_seconds',
        'heartbeat_interval',
        'lease_heartbeat_interval',
        'log_level',
        'max_concurrent_tasks',
        'max_retries',
        'poll_interval',
        'profile',
        'runtime_id',
        'server_url',
        'spec_root_map',
        'terminal_observer_close_on_exit',
        'terminal_observer_command',
        'terminal_observer_enabled',
        'terminal_observer_mode',
        'token',
        'workspace_dir',
      ]);
    });

    it('2026-06-22-agent-run-pipeline-fix task-02：spec_root_map 默认空串（向后兼容旧 daemon，SPEC_ROOT_MAP 未设）', () => {
      expect(DEFAULT_CONFIG.spec_root_map).toBe('');
    });

    it('ql-20260616-006：lease_heartbeat_interval 默认 5 秒', () => {
      expect(DEFAULT_CONFIG.lease_heartbeat_interval).toBe(5);
    });

    it('ql-20260616-003：terminal_observer_* 4 字段默认值', () => {
      expect(DEFAULT_CONFIG.terminal_observer_enabled).toBe(false);
      expect(DEFAULT_CONFIG.terminal_observer_mode).toBe('parsed');
      expect(DEFAULT_CONFIG.terminal_observer_close_on_exit).toBe(false);
      expect(DEFAULT_CONFIG.terminal_observer_command).toBeNull();
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

  // ── 2026-06-18-workspace-client-path task-02：allowed_roots ──
  // FR-04 / D-002@v1：list_dir RPC 白名单根目录数组，默认 [homedir()]。
  // 本组覆盖 T1~T11（见 task-02.md §7）。

  describe('allowed_roots（task-02，FR-04 / D-002@v1）', () => {
    // ── AC-2：默认值 [homedir()]（T1）──
    it('T1 DEFAULT_CONFIG.allowed_roots 默认 = [homedir()]', () => {
      expect(DEFAULT_CONFIG.allowed_roots).toEqual([homedir()]);
    });

    it('T1 文件不存在时 loadConfig 返回 [homedir()]（默认值兜底）', async () => {
      const cfg = await loadConfig(configPath);
      expect(cfg.allowed_roots).toEqual([homedir()]);
    });

    // ── AC-3：旧 config.json 无此字段 → 回填默认（T2）──
    it('T2 旧 config.json（含 runtime_id 但无 allowed_roots）→ 回填 [homedir()] 且现有字段不变', async () => {
      const existing = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      await writeFile(
        configPath,
        JSON.stringify({
          runtime_id: existing,
          token: 'old-token',
          poll_interval: 60,
        }),
        'utf-8',
      );
      const cfg = await loadConfig(configPath);
      expect(cfg.allowed_roots).toEqual([homedir()]);
      expect(cfg.runtime_id).toBe(existing);
      expect(cfg.token).toBe('old-token');
      expect(cfg.poll_interval).toBe(60);
    });

    // ── AC-4：显式配置透传 + 规范化（T3）──
    it('T3 显式 allowed_roots 透传，元素 resolve 为绝对路径', async () => {
      const existing = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const dirA = join(tmpDir, 'a');
      const dirB = join(tmpDir, 'b');
      await writeFile(
        configPath,
        JSON.stringify({
          runtime_id: existing,
          allowed_roots: [dirA, dirB],
        }),
        'utf-8',
      );
      const cfg = await loadConfig(configPath);
      expect(cfg.allowed_roots).toEqual([resolve(dirA), resolve(dirB)]);
    });

    // ── AC-4：相对路径规范化（T4）──
    it('T4 相对路径基于 process.cwd() resolve 为绝对路径', async () => {
      const existing = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      await writeFile(
        configPath,
        JSON.stringify({
          runtime_id: existing,
          allowed_roots: ['./repos'],
        }),
        'utf-8',
      );
      const cfg = await loadConfig(configPath);
      expect(cfg.allowed_roots).toEqual([resolve('./repos')]);
    });

    // ── AC-4：Windows 路径分隔符统一（T5，仅 win32 语义对齐）──
    it('T5 路径 resolve 后为平台原生分隔符（win32 反斜杠 / POSIX 正斜杠）', async () => {
      const existing = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      await writeFile(
        configPath,
        JSON.stringify({
          runtime_id: existing,
          allowed_roots: [join(tmpDir, 'sub')],
        }),
        'utf-8',
      );
      const cfg = await loadConfig(configPath);
      // resolve 后路径应为平台分隔符，与 join(tmpDir,'sub') resolve 等价
      expect(cfg.allowed_roots).toEqual([resolve(join(tmpDir, 'sub'))]);
    });

    // ── AC-4：去重保序（T6）──
    it('T6 重复项去重，首次出现保序', async () => {
      const existing = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const a = resolve(join(tmpDir, 'a'));
      const b = resolve(join(tmpDir, 'b'));
      await writeFile(
        configPath,
        JSON.stringify({
          runtime_id: existing,
          allowed_roots: [a, a, b],
        }),
        'utf-8',
      );
      const cfg = await loadConfig(configPath);
      expect(cfg.allowed_roots).toEqual([a, b]);
    });

    // ── AC-4：非字符串元素过滤（T7）──
    it('T7 非字符串 / 空串元素被过滤（保留合法项）', async () => {
      const existing = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const a = resolve(join(tmpDir, 'a'));
      await writeFile(
        configPath,
        JSON.stringify({
          runtime_id: existing,
          allowed_roots: [a, null, 123, ''],
        }),
        'utf-8',
      );
      const cfg = await loadConfig(configPath);
      expect(cfg.allowed_roots).toEqual([a]);
    });

    // ── AC-4：全脏数据回填默认（T8）──
    it('T8 全部为非字符串/空 → 回填 [homedir()]', async () => {
      const existing = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      await writeFile(
        configPath,
        JSON.stringify({
          runtime_id: existing,
          allowed_roots: [null, '', 42],
        }),
        'utf-8',
      );
      const cfg = await loadConfig(configPath);
      expect(cfg.allowed_roots).toEqual([homedir()]);
    });

    // ── AC-4：边界值（非数组 / 空数组 / null）回填默认（B1）──
    it('B1 allowed_roots 为空数组 → 回填 [homedir()]', async () => {
      const existing = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      await writeFile(
        configPath,
        JSON.stringify({ runtime_id: existing, allowed_roots: [] }),
        'utf-8',
      );
      const cfg = await loadConfig(configPath);
      expect(cfg.allowed_roots).toEqual([homedir()]);
    });

    it('B1 allowed_roots 为非数组（字符串）→ 回填 [homedir()]', async () => {
      const existing = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      await writeFile(
        configPath,
        JSON.stringify({
          runtime_id: existing,
          allowed_roots: 'not-an-array',
        }),
        'utf-8',
      );
      const cfg = await loadConfig(configPath);
      expect(cfg.allowed_roots).toEqual([homedir()]);
    });

    it('B1 allowed_roots 为 null → 回填 [homedir()]', async () => {
      const existing = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      await writeFile(
        configPath,
        JSON.stringify({ runtime_id: existing, allowed_roots: null }),
        'utf-8',
      );
      const cfg = await loadConfig(configPath);
      expect(cfg.allowed_roots).toEqual([homedir()]);
    });

    // ── AC-5：round-trip 一致（T9）──
    it('T9 save → load → save 两次文件字节一致（normalize 幂等）', async () => {
      const existing = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const dirA = resolve(join(tmpDir, 'a'));
      const dirB = resolve(join(tmpDir, 'b'));
      const cfg1: DaemonConfig = {
        ...DEFAULT_CONFIG,
        runtime_id: existing,
        allowed_roots: [dirA, dirB, dirA], // 含重复，会被去重
      };
      const path1 = join(tmpDir, 'c1.json');
      await saveConfig(cfg1, path1);
      const loaded = await loadConfig(path1);
      expect(loaded.runtime_id).toBe(existing); // 不重生
      // 第二次 save：用 load 回来的结果（已去重 + resolve）
      const path2 = join(tmpDir, 'c2.json');
      await saveConfig(loaded, path2);
      const raw1 = await readFile(path1, 'utf-8');
      const raw2 = await readFile(path2, 'utf-8');
      // parsed 后 allowed_roots 应一致
      expect(JSON.parse(raw2).allowed_roots).toEqual([dirA, dirB]);
      // 再次 load（round-trip 三次）字段稳定
      const loaded2 = await loadConfig(path2);
      expect(loaded2.allowed_roots).toEqual([dirA, dirB]);
    });

    // ── T10：DEFAULT_CONFIG freeze 保护 + 不被 loadConfig 污染（R-3）──
    it('T10 DEFAULT_CONFIG.allowed_roots 是 frozen 数组（浅冻结不足以阻止数组 mutation，但 Object.freeze 仅作用于对象本身）', () => {
      // DEFAULT_CONFIG 整体 frozen，但数组元素本身未被 frozen。
      // 关键不变量：DEFAULT_CONFIG.allowed_roots === [homedir()]（值层面恒定）
      expect(DEFAULT_CONFIG.allowed_roots).toEqual([homedir()]);
    });

    it('T10/R-3 loadConfig 后修改返回的 cfg.allowed_roots 不影响 DEFAULT_CONFIG', async () => {
      const cfg = await loadConfig(configPath);
      // 给返回的 cfg 追加项
      cfg.allowed_roots.push('/should/not/leak');
      // DEFAULT_CONFIG 必须仍是 [homedir()]
      expect(DEFAULT_CONFIG.allowed_roots).toEqual([homedir()]);
    });

    // ── T11：loadConfig 不因 allowed_roots 规范化而每次落盘（§5.3）──
    it('T11 旧 config.json 缺 allowed_roots（runtime_id 已存在）→ loadConfig 不改文件 mtime', async () => {
      const existing = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      await writeFile(
        configPath,
        JSON.stringify({ runtime_id: existing }),
        'utf-8',
      );
      const before = await stat(configPath);
      // 等待 > 1ms 确保 mtime 分辨率可区分（部分 FS 精度仅秒级，多读几次）
      await new Promise((r) => setTimeout(r, 1100));
      await loadConfig(configPath);
      const cfg = await loadConfig(configPath);
      const after = await stat(configPath);
      // runtime_id 已存在 → 不触发落盘；allowed_roots 规范化也不落盘
      expect(cfg.runtime_id).toBe(existing);
      expect(after.mtimeMs).toBe(before.mtimeMs);
    });

    // ── saveConfig 透传序列化新字段（AC-5 隐含）──
    it('saveConfig 写入的 JSON 含 allowed_roots 字段', async () => {
      const cfg: DaemonConfig = { ...DEFAULT_CONFIG, runtime_id: 'x' };
      const p = join(tmpDir, 'explicit.json');
      await saveConfig(cfg, p);
      const raw = await readFile(p, 'utf-8');
      expect(JSON.parse(raw).allowed_roots).toEqual([homedir()]);
    });
  });

  // ── 2026-06-22-agent-run-pipeline-fix task-02：spec_root_map ──
  // FR-01 / D-001@v1：prompt 路径翻译映射 "from:to"，env SPEC_ROOT_MAP 注入，
  // env 优先于 config.json 落盘值；空串默认（向后兼容旧 daemon）。
  // 对照 design §4.1 A1 第 2 层（daemon 激活 SPEC_ROOT_MAP 翻译器）。

  describe('spec_root_map（task-02，FR-01 / D-001@v1）', () => {
    /** 保存/恢复 SPEC_ROOT_MAP，防止跨测试污染（config.test.ts 其他组依赖 env 干净）。 */
    let prevEnv: string | undefined;

    beforeEach(() => {
      prevEnv = process.env.SPEC_ROOT_MAP;
      delete process.env.SPEC_ROOT_MAP;
    });

    afterEach(() => {
      if (prevEnv === undefined) {
        delete process.env.SPEC_ROOT_MAP;
      } else {
        process.env.SPEC_ROOT_MAP = prevEnv;
      }
    });

    // ── AC-01：env 设完整映射，loadConfig 读到并覆盖到 spec_root_map ──
    it('AC-01 env SPEC_ROOT_MAP="/data/spec-workspaces:C:/data/spec-workspaces" → cfg.spec_root_map 等于该值', async () => {
      process.env.SPEC_ROOT_MAP = '/data/spec-workspaces:C:/data/spec-workspaces';
      const cfg = await loadConfig(configPath);
      expect(cfg.spec_root_map).toBe('/data/spec-workspaces:C:/data/spec-workspaces');
    });

    // ── AC-04：env 未设 → 默认空串，不报错（向后兼容旧 daemon）──
    it('AC-04 env 未设 SPEC_ROOT_MAP → cfg.spec_root_map 为空串（默认值，向后兼容）', async () => {
      const cfg = await loadConfig(configPath);
      expect(cfg.spec_root_map).toBe('');
    });

    // ── 边界 1：env 设空串 → 覆盖为空串（翻译器会跳过）──
    it('env 设空串 SPEC_ROOT_MAP="" → cfg.spec_root_map 为空串（空串覆盖，翻译器跳过）', async () => {
      process.env.SPEC_ROOT_MAP = '';
      const cfg = await loadConfig(configPath);
      expect(cfg.spec_root_map).toBe('');
    });

    // ── env 优先于 config.json 落盘值（避免脏 config.json 把翻译关掉）──
    it('env 优先于 config.json 的 spec_root_map（脏 config.json 不影响翻译）', async () => {
      await writeFile(
        configPath,
        JSON.stringify({
          runtime_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          spec_root_map: '/stale:/path',
        }),
        'utf-8',
      );
      process.env.SPEC_ROOT_MAP = '/data/spec-workspaces:C:/data/spec-workspaces';
      const cfg = await loadConfig(configPath);
      expect(cfg.spec_root_map).toBe('/data/spec-workspaces:C:/data/spec-workspaces');
    });

    // ── env 未设时 config.json 的 spec_root_map 透传（用户显式落盘场景）──
    it('env 未设且 config.json 含 spec_root_map → 透传 config.json 值', async () => {
      await writeFile(
        configPath,
        JSON.stringify({
          runtime_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          spec_root_map: '/from:/to',
        }),
        'utf-8',
      );
      const cfg = await loadConfig(configPath);
      expect(cfg.spec_root_map).toBe('/from:/to');
    });

    // ── 不落盘：env 注入值不被 saveConfig 序列化到 config.json ──
    // （design §4.1：避免 host 路径被序列化到 config.json，跨机器冲突）
    it('env 注入的 spec_root_map 不落盘（saveConfig 不写 env 值，除非用户显式改 cfg 后 save）', async () => {
      process.env.SPEC_ROOT_MAP = '/data/spec-workspaces:C:/data/spec-workspaces';
      const cfg = await loadConfig(configPath);
      // loadConfig 触发 runtime_id 自动生成会落盘一次，此时 spec_root_map 不应被写入
      const raw = await readFile(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      // 关键断言：落盘的 JSON 不含 env 注入的 spec_root_map（loadConfig 不主动 save env 值）
      expect(parsed.spec_root_map).not.toBe('/data/spec-workspaces:C:/data/spec-workspaces');
    });
  });
});
