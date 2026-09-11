// tests/provider-file-settings-reload.test.ts
// change 2026-09-11-session-provider-switch-codex-pi / task-06（FR-01 / FR-02 / FR-05 /
// D-001@v1 / R-05）。锁 task-02 三件产物（sillyhub-daemon/src）：
//
//   1. applyProviderFileSettingsForReload 全分派矩阵（R-05 失败兜底内聚在返回值）：
//      分支一（非 null 成功）——codex 门槛足写盘返 {CODEX_HOME} 单键 / pi 自定义端点
//      返 {PI_CODING_AGENT_DIR} / pi 官方端点返 {}（D-008 env 层接管，prior 键不兜）/
//      claude·未知 kind 返 {}；
//      分支二（IO 失败）——codex/pi 返 priorEnv 对应文件层键（等同未切）；priorEnv
//      undefined（restore 路径）取不到键 → {} 降级（Grill 复审 P2-2）；
//      分支三（门槛缺）——codex/pi 返 priorEnv 对应键（P2-1：异常配置等同未切而非
//      丢文件层 env）；无 prior 键 → {}；
//      分支四（显式 null 切回本机 + prior CODEX_HOME）——调 mirrorCodexHostAuth，
//      无论镜像成败都返 {CODEX_HOME: prior}（thread 历史保住，镜像失败=目录留旧
//      供应商产物=等同未切）；
//      分支五（null 无 prior CODEX_HOME / pi kind null / undefined absent）——返 {}。
//      全矩阵任何分支不抛。
//   2. mirrorCodexHostAuth 三态（FR-02 null 切换镜像）：宿主两文件存在 → 拷入覆盖
//      per-session 产物 / 宿主无 → 删 per-session 同名两文件 / IO 失败 → error 不抛。
//   3. migrateCodexThreadFromHost 三态（FR-05 / R-01）：rollout 首行会话 id 命中 →
//      按 sessions/ 相对路径拷入返 true（payload.id 实测形态 + payload.session_id
//      TaskCard 锚形态双兼容锁）/ 无命中 → false / 宿主缺目录 → false。
//
// 隔离（TaskCard task-03 观察项 CODEX-1 教训——勿依赖宿主真状态）：
//   - SILLYHUB_DAEMON_DIR → tmpRoot（config.ts daemonStateDir 懒求值，per-session
//     codex/pi 目录挂其下，零触碰真实 ~/.sillyhub）；
//   - vi.mock('node:os') 覆写 homedir → fakeHome（codex-settings.ts hostCodexHome 经
//     os.homedir() 读 ~/.codex，宿主路径唯一入口，最小侵入；tmpdir 等其余导出保留
//     actual）。fakeHome 每用例换新 tmp 目录，宿主 ~/.codex 真实 155 rollout 永不
//     被扫描/读取。

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

// homedir 覆写锚：vi.mock 工厂 hoist 到 import 前，经 hoisted 可变 holder 让
// beforeEach 换目录（工厂闭包读 holder.dir）。
const hostHome = vi.hoisted(() => ({ dir: '' }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => hostHome.dir,
  };
});

// vi.mock 已 hoist，import 拿到 homedir 覆写后的模块图。
import {
  applyProviderFileSettingsForReload,
  type ProviderFileSettingsReloadInput,
} from '../src/provider-file-settings.js';
import {
  mirrorCodexHostAuth,
  migrateCodexThreadFromHost,
} from '../src/codex-settings.js';
import type { ProviderConfig } from '../src/types.js';

// ── 共用 fixture ──────────────────────────────────────────────────────────────

/** 每用例独立的 daemon 状态根（vi.stubEnv 进 daemonStateDir 懒求值）。 */
let tmpRoot: string;

function stubbedRoot(): string {
  return tmpRoot;
}

/** 宿主 codex 目录（fakeHome/.codex——homedir 覆写后的隔离宿主）。 */
function hostCodex(): string {
  return join(hostHome.dir, '.codex');
}

/** codex anthropic 直连形态（门槛满足：api_key/base_url 至少一项）。 */
function codexAnthropicConfig(): ProviderConfig {
  return {
    agent_kind: 'codex',
    api_key: 'sk-codex-reload',
    base_url: 'https://reload.example/v1',
    model: 'glm-4.7',
  };
}

/** pi 自定义端点形态（base_url + api_key + model 齐）。 */
function piCustomConfig(): ProviderConfig {
  return {
    agent_kind: 'pi',
    api_key: 'sk-pi-reload',
    base_url: 'https://pi-reload.example/v1',
    model: 'kimi-k2',
  };
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

/** ForReload 调用薄封装（默认 priorEnv=undefined 同 restore 路径）。 */
function forReload(
  overrides: Partial<ProviderFileSettingsReloadInput>,
): Promise<Record<string, string>> {
  return applyProviderFileSettingsForReload({
    sessionKey: 'sess-rl',
    provider: codexAnthropicConfig(),
    daemonApiKey: null,
    priorEnv: undefined,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tmpRoot = mkdtempSync(join(tmpdir(), 'pfr-'));
  hostHome.dir = mkdtempSync(join(tmpdir(), 'pfr-host-'));
  vi.stubEnv('SILLYHUB_DAEMON_DIR', tmpRoot);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(hostHome.dir, { recursive: true, force: true });
});

// ── 1. ForReload 分支一：非 null 成功（与 spawn 版同分派同产物）────────────────

describe('ForReload 分支一：非 null 成功分派', () => {
  it('codex 门槛足 → 写盘返 {CODEX_HOME: <root>/codex/<sessionKey>} 单键（产物=spawn 版）', async () => {
    const env = await forReload({ sessionKey: 'sess-ok1' });

    const codexHome = join(stubbedRoot(), 'codex', 'sess-ok1');
    expect(env).toEqual({ CODEX_HOME: codexHome });
    const auth = readJson(join(codexHome, 'auth.json'));
    expect(auth['OPENAI_API_KEY']).toBe('sk-codex-reload');
    const toml = readFileSync(join(codexHome, 'config.toml'), 'utf-8');
    expect(toml).toContain('base_url = "https://reload.example/v1"');
    expect(toml).toContain('model_provider = "sillyhub"');
  });

  it('pi 自定义端点 → 写三文件返 {PI_CODING_AGENT_DIR: <root>/pi/<sessionKey>}', async () => {
    const env = await forReload({
      sessionKey: 'sess-okp',
      provider: piCustomConfig(),
    });

    const piDir = join(stubbedRoot(), 'pi', 'sess-okp');
    expect(env).toEqual({ PI_CODING_AGENT_DIR: piDir });
    const settings = readJson(join(piDir, 'settings.json'));
    expect(settings['defaultProvider']).toBe('sillyhub');
    expect(settings['defaultModel']).toBe('kimi-k2');
    expect(existsSync(join(piDir, 'auth.json'))).toBe(true);
    expect(existsSync(join(piDir, 'models.json'))).toBe(true);
  });

  it('pi 官方端点（base_url 空）→ 返 {}（env 层接管，prior PI 键不兜底——R-06 切换语义）', async () => {
    const env = await forReload({
      sessionKey: 'sess-okp2',
      provider: { agent_kind: 'pi', api_key: 'sk-official', model: 'm1' },
      // 切官方端点 = 丢文件层凭证回 env 注入接管：prior PI 键不保留（否则旧
      // auth.json 文件凭证会压过 env 层——spike B1 压制方向）。
      priorEnv: { PI_CODING_AGENT_DIR: '/prior/pi-official' },
    });

    expect(env).toEqual({});
    expect(existsSync(join(stubbedRoot(), 'pi'))).toBe(false);
  });

  it('claude / 缺省 / 未知 kind → 返 {}（claude settings.json 链路不在此处）', async () => {
    for (const provider of [
      { agent_kind: 'claude', api_key: 'k', base_url: 'u' },
      { api_key: 'k', base_url: 'u' },
      { agent_kind: 'cursor', api_key: 'k' },
    ] as ProviderConfig[]) {
      expect(
        await forReload({ sessionKey: 'sess-kind', provider, priorEnv: { CODEX_HOME: '/prior-c' } }),
      ).toEqual({});
    }
    expect(existsSync(join(stubbedRoot(), 'codex'))).toBe(false);
    expect(existsSync(join(stubbedRoot(), 'pi'))).toBe(false);
  });
});

// ── 2. ForReload 分支二/三：非 null 失败兜底（R-05 核心）───────────────────────

describe('ForReload 分支二：写盘 IO 失败 → 返 priorEnv 文件层键（等同未切）', () => {
  it('codex mkdir IO 失败（codex 段被同名文件占用）+ priorEnv 有 CODEX_HOME → 返 prior 键 + error 日志', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeFileSync(join(stubbedRoot(), 'codex'), 'not-a-dir');

    const env = await forReload({
      sessionKey: 'sess-io1',
      priorEnv: { CODEX_HOME: '/prior/codex-io1', OTHER: 'x' },
    });

    // 只返 prior 的 CODEX_HOME 键（非整个 priorEnv）。
    expect(env).toEqual({ CODEX_HOME: '/prior/codex-io1' });
    expect(errSpy).toHaveBeenCalledWith(
      'provider_file_reload_codex_failed',
      expect.objectContaining({ session_key: 'sess-io1' }),
    );
  });

  it('pi 写盘 IO 失败（auth.json 被同名目录占用）+ priorEnv 有 PI_CODING_AGENT_DIR → 返 prior 键', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mkdirSync(join(stubbedRoot(), 'pi', 'sess-io2', 'auth.json'), { recursive: true });

    const env = await forReload({
      sessionKey: 'sess-io2',
      provider: piCustomConfig(),
      priorEnv: { PI_CODING_AGENT_DIR: '/prior/pi-io2' },
    });

    expect(env).toEqual({ PI_CODING_AGENT_DIR: '/prior/pi-io2' });
    expect(errSpy).toHaveBeenCalledWith(
      'provider_file_reload_pi_failed',
      expect.objectContaining({ session_key: 'sess-io2' }),
    );
  });

  it('IO 失败 + priorEnv undefined（restore 路径）→ 返 {}（按宿主现状降级，Grill P2-2）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeFileSync(join(stubbedRoot(), 'codex'), 'not-a-dir');

    const env = await forReload({ sessionKey: 'sess-io3', priorEnv: undefined });

    expect(env).toEqual({});
    expect(errSpy).toHaveBeenCalledWith(
      'provider_file_reload_codex_failed',
      expect.objectContaining({ session_key: 'sess-io3' }),
    );
  });
});

describe('ForReload 分支三：门槛缺 → 返 priorEnv 对应键（P2-1 异常配置=等同未切）', () => {
  it('codex 门槛缺（api_key/base_url 全空）+ priorEnv 有 CODEX_HOME → 返 prior 键 + warn 跳过', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const env = await forReload({
      sessionKey: 'sess-gate1',
      provider: { agent_kind: 'codex' },
      priorEnv: { CODEX_HOME: '/prior/codex-gate1' },
    });

    expect(env).toEqual({ CODEX_HOME: '/prior/codex-gate1' });
    // 门槛缺 = 零 mkdir 零写入（可诊断不静默）。
    expect(existsSync(join(stubbedRoot(), 'codex'))).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      'provider_file_reload_codex_skipped_missing_fields',
      expect.objectContaining({ session_key: 'sess-gate1' }),
    );
  });

  it('codex 门槛缺 + priorEnv 无 CODEX_HOME（undefined）→ 返 {}', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(
      await forReload({
        sessionKey: 'sess-gate2',
        provider: { agent_kind: 'codex' },
        priorEnv: undefined,
      }),
    ).toEqual({});
    // 有 priorEnv 但无该键同样返 {}（nonEmptyStr 判空口径）。
    expect(
      await forReload({
        sessionKey: 'sess-gate2',
        provider: { agent_kind: 'codex' },
        priorEnv: { PI_CODING_AGENT_DIR: '/prior/pi-gate2' },
      }),
    ).toEqual({});
  });

  it('pi 门槛缺（base_url 有但 api_key 空）+ priorEnv 有 PI_CODING_AGENT_DIR → 返 prior 键（同 P2-1 口径）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const env = await forReload({
      sessionKey: 'sess-gate3',
      provider: { agent_kind: 'pi', base_url: 'https://gate.example/v1', model: 'm' },
      priorEnv: { PI_CODING_AGENT_DIR: '/prior/pi-gate3' },
    });

    expect(env).toEqual({ PI_CODING_AGENT_DIR: '/prior/pi-gate3' });
    expect(existsSync(join(stubbedRoot(), 'pi'))).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      'provider_file_reload_pi_skipped_missing_fields',
      expect.objectContaining({ session_key: 'sess-gate3' }),
    );
  });
});

// ── 3. ForReload 分支四/五：null 切回本机（D-001）─────────────────────────────

describe('ForReload 分支四：null + prior CODEX_HOME → 镜像成败均返 prior 键', () => {
  it('镜像成功（宿主两文件存在）→ 拷入 per-session 目录 + 返 {CODEX_HOME: prior}', async () => {
    // 宿主登录态：两文件存在。
    mkdirSync(hostCodex(), { recursive: true });
    writeFileSync(join(hostCodex(), 'auth.json'), '{"OPENAI_API_KEY":"sk-host-login"}');
    writeFileSync(join(hostCodex(), 'config.toml'), 'model = "host-model"\n');

    const env = await forReload({
      sessionKey: 'sess-null1',
      provider: null,
      priorEnv: { CODEX_HOME: join(stubbedRoot(), 'codex', 'sess-null1') },
    });

    // 返回值 = prior 键（镜像目标与 prior 同为确定性派生路径）。
    expect(env).toEqual({ CODEX_HOME: join(stubbedRoot(), 'codex', 'sess-null1') });
    // 镜像副作用：宿主登录态拷入 per-session 目录（平台供应商产物被替换）。
    expect(readFileSync(join(stubbedRoot(), 'codex', 'sess-null1', 'auth.json'), 'utf-8')).toContain(
      'sk-host-login',
    );
  });

  it('镜像 IO 失败（codexHome 路径被同名文件占用）→ 仍返 prior 键不抛（目录留旧产物=等同未切）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 阻断镜像：目标目录段被普通文件占用 → mkdir/copyFile 全失败。
    writeFileSync(join(stubbedRoot(), 'codex'), 'not-a-dir');

    const env = await forReload({
      sessionKey: 'sess-null2',
      provider: null,
      priorEnv: { CODEX_HOME: '/prior/codex-null2' },
    });

    // 铁律：镜像失败不抛、env 仍保住旧目录（thread 历史保住）。
    expect(env).toEqual({ CODEX_HOME: '/prior/codex-null2' });
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('ForReload 分支五：null 无 prior CODEX_HOME / pi kind / undefined absent → 返 {}', () => {
  it('null + priorEnv undefined（宿主起步会话）→ 返 {}', async () => {
    expect(await forReload({ sessionKey: 'sess-null3', provider: null })).toEqual({});
  });

  it('null + priorEnv 只带 PI 键（pi kind 会话切回本机）→ 返 {}（pi 历史在 --session-dir 不丢）', async () => {
    expect(
      await forReload({
        sessionKey: 'sess-null4',
        provider: null,
        priorEnv: { PI_CODING_AGENT_DIR: '/prior/pi-null4' },
      }),
    ).toEqual({});
    // 不为 pi 触发 codex 镜像（无 codex 目录产生）。
    expect(existsSync(join(stubbedRoot(), 'codex'))).toBe(false);
  });

  it('provider undefined（D-012 absent 边界）→ 返 {}（零动作，与 spawn 版逐字一致）', async () => {
    expect(
      await forReload({
        sessionKey: 'sess-null5',
        provider: undefined,
        priorEnv: { CODEX_HOME: '/prior/absent' },
      }),
    ).toEqual({});
  });
});

// ── 4. mirrorCodexHostAuth 三态（FR-02）───────────────────────────────────────

describe('mirrorCodexHostAuth 三态', () => {
  it('宿主两文件存在 → 拷入覆盖 per-session 产物（平台供应商凭证被宿主登录态替换）', async () => {
    mkdirSync(hostCodex(), { recursive: true });
    writeFileSync(join(hostCodex(), 'auth.json'), '{"OPENAI_API_KEY":"sk-host-m"}');
    writeFileSync(join(hostCodex(), 'config.toml'), 'model = "host-toml"\n');
    // per-session 目录预置平台供应商产物（旧供应商凭证）。
    const codexHome = join(stubbedRoot(), 'codex', 'sess-mirror1');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'auth.json'), '{"OPENAI_API_KEY":"sk-platform-old"}');
    writeFileSync(join(codexHome, 'config.toml'), 'model = "platform-old"\n');

    await mirrorCodexHostAuth(codexHome);

    expect(readFileSync(join(codexHome, 'auth.json'), 'utf-8')).toContain('sk-host-m');
    expect(readFileSync(join(codexHome, 'config.toml'), 'utf-8')).toContain('host-toml');
    // 宿主侧只读（原件不动）。
    expect(readFileSync(join(hostCodex(), 'auth.json'), 'utf-8')).toContain('sk-host-m');
  });

  it('宿主无两文件（未登录）→ 删 per-session 同名两文件（残留平台凭证会顶掉「回本机」语义）', async () => {
    // fakeHome 无 .codex —— 宿主未登录形态。
    const codexHome = join(stubbedRoot(), 'codex', 'sess-mirror2');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'auth.json'), '{"OPENAI_API_KEY":"sk-platform-leftover"}');
    writeFileSync(join(codexHome, 'config.toml'), 'model = "leftover"\n');

    await mirrorCodexHostAuth(codexHome);

    expect(existsSync(join(codexHome, 'auth.json'))).toBe(false);
    expect(existsSync(join(codexHome, 'config.toml'))).toBe(false);
    // 目录本身保留（thread 历史在 sessions/ 下不受影响）。
    expect(existsSync(codexHome)).toBe(true);
  });

  it('IO 失败（auth.json 目标位被同名目录占用 → copyFile EISDIR）→ error 不抛（调用方 ForReload 兜底）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mkdirSync(hostCodex(), { recursive: true });
    writeFileSync(join(hostCodex(), 'auth.json'), '{"OPENAI_API_KEY":"sk-host-x"}');
    writeFileSync(join(hostCodex(), 'config.toml'), 'model = "host-t"\n');
    const codexHome = join(stubbedRoot(), 'codex', 'sess-mirror3');
    // auth.json 目标位是目录 → copyFile EISDIR（非 ENOENT）→ copy 失败分支。
    mkdirSync(join(codexHome, 'auth.json'), { recursive: true });

    await expect(mirrorCodexHostAuth(codexHome)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(
      'codex_host_mirror_copy_failed',
      expect.objectContaining({ file: 'auth.json' }),
    );
    // 逐文件独立 best-effort：config.toml 照常拷入。
    expect(readFileSync(join(codexHome, 'config.toml'), 'utf-8')).toContain('host-t');
  });
});

// ── 5. migrateCodexThreadFromHost 三态（FR-05 / R-01）─────────────────────────

describe('migrateCodexThreadFromHost 三态', () => {
  /** 宿主 rollout fixture：首行 session_meta（实际形态 payload.id + TaskCard 锚 payload.session_id 由 firstLine 决定）。 */
  function writeHostRollout(relPath: string, firstLine: string): void {
    const dest = join(hostCodex(), 'sessions', relPath);
    mkdirSync(join(dest, '..'), { recursive: true });
    writeFileSync(dest, `${firstLine}\n{"type":"event","payload":{}}\n`);
  }

  it('首行命中（payload.id 实测形态 + payload.session_id 锚形态双兼容）→ 按相对路径拷入返 true', async () => {
    // 实际 rollout 首行形态（codex 0.121.0+ 实测：{"type":"session_meta","payload":{"id":...}}）。
    writeHostRollout(
      join('2026', '09', '10', 'rollout-a.jsonl'),
      '{"type":"session_meta","payload":{"id":"thread-payload-id"}}',
    );
    // TaskCard fixture 锚形态（payload.session_id 优先读）。
    writeHostRollout(
      join('2026', '09', '11', 'rollout-b.jsonl'),
      '{"type":"session_meta","payload":{"session_id":"thread-session-id"}}',
    );
    // 干扰项：id 不匹配 + 首行非 JSON。
    writeHostRollout(join('2026', '09', '10', 'rollout-decoy.jsonl'), '{"payload":{"id":"other"}}');
    writeHostRollout(join('2026', '09', '10', 'not-json.jsonl'), 'not json at all');

    const codexHome = join(stubbedRoot(), 'codex', 'sess-mig');

    // 命中形态一（payload.id）。
    expect(await migrateCodexThreadFromHost('thread-payload-id', codexHome)).toBe(true);
    expect(
      readFileSync(
        join(codexHome, 'sessions', '2026', '09', '10', 'rollout-a.jsonl'),
        'utf-8',
      ),
    ).toContain('thread-payload-id');
    // 命中形态二（payload.session_id 兼容读）。
    expect(await migrateCodexThreadFromHost('thread-session-id', codexHome)).toBe(true);
    expect(
      existsSync(join(codexHome, 'sessions', '2026', '09', '11', 'rollout-b.jsonl')),
    ).toBe(true);
    // 干扰项不拷入；宿主原件保留（只读单向）。
    expect(
      existsSync(join(codexHome, 'sessions', '2026', '09', '10', 'rollout-decoy.jsonl')),
    ).toBe(false);
    expect(
      existsSync(join(hostCodex(), 'sessions', '2026', '09', '10', 'rollout-a.jsonl')),
    ).toBe(true);
  });

  it('无命中（宿主有 rollout 但 id 全不匹配）→ 返 false 零拷入（warn 不阻断）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeHostRollout(
      join('2026', '09', '10', 'rollout-x.jsonl'),
      '{"type":"session_meta","payload":{"id":"someone-else"}}',
    );

    const codexHome = join(stubbedRoot(), 'codex', 'sess-mig2');
    expect(await migrateCodexThreadFromHost('thread-missing', codexHome)).toBe(false);
    expect(existsSync(join(codexHome, 'sessions'))).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      'codex_thread_migrate_no_match',
      expect.objectContaining({ thread_id: 'thread-missing', scanned: 1 }),
    );
  });

  it('宿主缺 sessions 目录（从未跑过 codex）→ 返 false 零动作', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const codexHome = join(stubbedRoot(), 'codex', 'sess-mig3');
    expect(await migrateCodexThreadFromHost('thread-any', codexHome)).toBe(false);
    expect(existsSync(codexHome)).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      'codex_thread_migrate_no_match',
      expect.objectContaining({ thread_id: 'thread-any', scanned: 0 }),
    );
  });
});
