import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writePiMcpConfig } from '../src/pi-settings.js';
import { detectPiMajorVersion, parsePiMajorVersion } from '../src/interactive/pi-rpc-driver.js';

// detectPiMajorVersion 经 ESM import 绑定 node:child_process 的 spawn——
// vi.stubGlobal 不生效，必须模块级 vi.mock（版本探测行为单测的 mock 面）。
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

/** 2026-10-10-all-engines-mcp-injection task-05：pi 通道 MCP 写盘与版本门控单测。 */
describe('pi-settings: writePiMcpConfig（task-05 D-005@v1 形态①）', () => {
  let dir: string;

  it('配置落盘隔离：只写指定 per-session 目录的 mcp.json', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pi-mcp-'));
    await writePiMcpConfig(dir, {
      'sillyhub-daemon': { command: 'node', args: ['mcp-server.js'] },
    });
    const file = join(dir, 'mcp.json');
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    expect(parsed.mcpServers['sillyhub-daemon']).toEqual({
      command: 'node',
      args: ['mcp-server.js'],
    });
  });

  it('env 透传：条目 env 字段（MCP_SESSION_ID）原样落盘', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pi-mcp-'));
    await writePiMcpConfig(dir, {
      'sillyhub-file': {
        command: 'node',
        args: ['mcp-server.js', '--toolset', 'file'],
        env: { MCP_SESSION_ID: 'sess-1', MCP_SERVER_DAEMON_API_KEY: 'k1' },
      },
    });
    const parsed = JSON.parse(readFileSync(join(dir, 'mcp.json'), 'utf-8'));
    expect(parsed.mcpServers['sillyhub-file'].env).toEqual({
      MCP_SESSION_ID: 'sess-1',
      MCP_SERVER_DAEMON_API_KEY: 'k1',
    });
  });

  it('空表跳过：不写文件（保持目录干净，pi 视为无 MCP 配置）', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pi-mcp-'));
    await writePiMcpConfig(dir, {});
    expect(existsSync(join(dir, 'mcp.json'))).toBe(false);
  });

  it('覆写语义：二次写替换旧条目，不残留幽灵 server', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pi-mcp-'));
    await writePiMcpConfig(dir, { old: { command: 'a' } });
    await writePiMcpConfig(dir, { fresh: { command: 'b' } });
    const parsed = JSON.parse(readFileSync(join(dir, 'mcp.json'), 'utf-8'));
    expect(parsed.mcpServers.old).toBeUndefined();
    expect(parsed.mcpServers.fresh).toEqual({ command: 'b' });
  });
});

describe('pi-rpc-driver: pi 版本门控（task-05 FR-06 两层门控的运行时层）', () => {
  afterEach(async () => {
    const { spawn } = await import('node:child_process');
    vi.mocked(spawn).mockReset();
  });

  it('parsePiMajorVersion：1.x 支持 / 0.x 不支持 / 乱串与空串返回 -1', () => {
    expect(parsePiMajorVersion('1.1.0')).toBe(1);
    expect(parsePiMajorVersion('1.0.0')).toBe(1);
    expect(parsePiMajorVersion('0.81.1')).toBe(0);
    expect(parsePiMajorVersion('pi version weird')).toBe(-1);
    expect(parsePiMajorVersion('')).toBe(-1);
  });

  it('detectPiMajorVersion：正常输出解析为主版本号', async () => {
    const { spawn } = await import('node:child_process');
    vi.mocked(spawn).mockReturnValue(
      {
        stdout: { on: (_e: string, cb: (d: unknown) => void) => cb('1.1.0') },
        on: (ev: string, cb: () => void) => {
          if (ev === 'close') setTimeout(cb, 0);
        },
        kill: () => undefined,
      } as never,
    );
    await expect(detectPiMajorVersion('pi', false, {})).resolves.toBe(1);
  });

  it('detectPiMajorVersion：spawn 报错返回 -1（降级不抛）', async () => {
    const { spawn } = await import('node:child_process');
    vi.mocked(spawn).mockReturnValue(
      {
        stdout: { on: () => undefined },
        on: (ev: string, cb: (e?: unknown) => void) => {
          if (ev === 'error') setTimeout(() => cb(new Error('boom')), 0);
        },
        kill: () => undefined,
      } as never,
    );
    await expect(detectPiMajorVersion('pi', false, {})).resolves.toBe(-1);
  });
});
