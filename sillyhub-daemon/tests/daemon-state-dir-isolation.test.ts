/**
 * SILLYHUB_DAEMON_DIR 官方隔离参数测试（2026-08-31）。
 *
 * 背景：daemon 全部本地状态（pid/log/per-server config/credentials/specs/manifests/
 * skills/locks/bin/mcp.json/pending-update/runs）默认派生 `~/.sillyhub/daemon`。集成
 * 测试此前只能覆写 HOME+USERPROFILE 整个 home 绕行全局单实例 pid 守卫——Windows 下
 * os.homedir() 读 USERPROFILE、两侧都要覆写，且劫持整个 home 会波及 git/npm/claude
 * 等所有 home 相对路径。
 *
 * 官方参数：环境变量 SILLYHUB_DAEMON_DIR 只重定向 daemon 自身状态根。
 * 覆盖：config hub（DEFAULT_CONFIG_DIR/CLAUDE_CONFIG_DIR/per-server config）+ pid/log
 * （cli）+ credentials + specs/manifests（spec-sync）+ locks（runtime-lock，懒函数）
 * + bin（config.daemonBinDir，daemon.ts/preflight.ts 同源）+ mcp.json（mcp-config）
 * + 懒求值语义 + 未设置回落默认（回归保护）。
 *
 * quick 风险审查补（2026-09-01）：sessions.json（interactive 会话存档——隔离实例
 * 不得读写真实主目录的恢复档案）+ audit-failed.jsonl（审计降级落盘）+
 * codex 交互日志目录（runs/codex-interactive）三个原直拼 homedir() 的漏项。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

describe('SILLYHUB_DAEMON_DIR 隔离参数', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'daemon-dir-iso-'));
    vi.resetModules();
    vi.stubEnv('SILLYHUB_DAEMON_DIR', dir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(dir, { recursive: true, force: true });
  });

  it('config：DEFAULT_CONFIG_DIR / CLAUDE_CONFIG_DIR / per-server config 落隔离目录', async () => {
    const config = await import('../src/config.js');
    expect(config.daemonStateDir()).toBe(resolve(dir));
    expect(config.DEFAULT_CONFIG_DIR).toBe(resolve(dir));
    expect(config.CLAUDE_CONFIG_DIR).toBe(join(resolve(dir), 'claude-config'));
    expect(config.configPathForServer('http://localhost:8000')).toBe(
      join(resolve(dir), `config-${config.serverHash('http://localhost:8000')}.json`),
    );
  });

  it('未设置 / 空串 → 回落 ~/.sillyhub/daemon（回归保护）', async () => {
    vi.stubEnv('SILLYHUB_DAEMON_DIR', '');
    const config = await import('../src/config.js');
    expect(config.daemonStateDir()).toBe(join(homedir(), '.sillyhub', 'daemon'));
  });

  it('daemonStateDir 懒求值：运行中改 env 即时生效（无需 resetModules）', async () => {
    const config = await import('../src/config.js');
    const dir2 = mkdtempSync(join(tmpdir(), 'daemon-dir-iso2-'));
    try {
      vi.stubEnv('SILLYHUB_DAEMON_DIR', dir2);
      expect(config.daemonStateDir()).toBe(resolve(dir2));
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it('cli：pid/log 文件落隔离目录（单实例守卫判重数据源一并隔离）', async () => {
    const cli = await import('../src/cli.js');
    expect(cli.getPidFile()).toBe(join(resolve(dir), 'daemon.pid'));
    expect(cli.getLogFile()).toBe(join(resolve(dir), 'daemon.log'));
  });

  it('credentials / specs / manifests / locks / bin 派生点全落隔离目录', async () => {
    const { DEFAULT_CREDENTIALS_PATH } = await import('../src/credential.js');
    expect(DEFAULT_CREDENTIALS_PATH).toBe(join(resolve(dir), 'credentials.json'));

    const specSync = await import('../src/spec-sync.js');
    expect(specSync.resolveSpecDir('ws-1')).toBe(join(resolve(dir), 'specs', 'ws-1'));
    expect(specSync.resolveManifestCachePath('ws-1')).toBe(
      join(resolve(dir), 'manifests', 'ws-1.json'),
    );

    const runtimeLock = await import('../src/runtime-lock.js');
    expect(runtimeLock.locksDir()).toBe(join(resolve(dir), 'locks'));

    const config = await import('../src/config.js');
    expect(config.daemonBinDir()).toBe(join(resolve(dir), 'bin'));
  });

  it('mcp.json：平台默认 MCP 配置读隔离目录（不落真实 home）', async () => {
    // 在隔离目录放一份 mcp.json，断言 loadPlatformMcpConfig 读到它
    writeFileSync(
      join(dir, 'mcp.json'),
      JSON.stringify({ mcpServers: { isoProbe: { command: 'node', args: ['probe.js'] } } }),
      'utf-8',
    );
    const mcp = await import('../src/mcp-config.js');
    const cfg = await mcp.loadPlatformMcpConfig();
    expect(Object.keys(cfg.mcpServers)).toContain('isoProbe');
  });

  it('sessions.json：interactive 会话存档落隔离目录（quick 风险审查修）', async () => {
    const p = await import('../src/interactive/session-store-persistence.js');
    expect(p.defaultSessionFilePath()).toBe(join(resolve(dir), 'sessions.json'));
    // 生产装配走无参构造（cli.ts new JsonSessionPersistence()）——默认值
    // 在构造时求值，隔离实例不得再指向真实 ~/.sillyhub/daemon/sessions.json。
    expect(new p.JsonSessionPersistence().filePath).toBe(join(resolve(dir), 'sessions.json'));
  });

  it('audit-failed.jsonl：审计降级落盘路径落隔离目录（quick 风险审查修）', async () => {
    const { defaultFailoverPath } = await import('../src/policy/audit-sink.js');
    expect(defaultFailoverPath()).toBe(join(resolve(dir), 'audit-failed.jsonl'));
  });

  it('codex 交互日志目录落隔离目录（quick 风险审查修）', async () => {
    const { codexInteractiveLogDir } = await import(
      '../src/interactive/codex-app-server-driver.js'
    );
    expect(codexInteractiveLogDir()).toBe(join(resolve(dir), 'runs', 'codex-interactive'));
  });
});
