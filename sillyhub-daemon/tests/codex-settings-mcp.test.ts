import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergeCodexMcpToml, writeCodexMcpServers } from '../src/codex-settings.js';

/** 2026-10-10-all-engines-mcp-injection task-06（D-006@v1 / D-011@v1 机制就绪分支）。 */

const Q = '"';

describe('codex-settings: mergeCodexMcpToml（task-06 [mcp_servers.*] 托管段）', () => {
  it('托管段写入：command/args 数组/env 子表完整序列化', () => {
    const out = mergeCodexMcpToml('', {
      'sillyhub-file': {
        command: 'node',
        args: ['mcp-server.js', '--toolset', 'file'],
        env: { MCP_SESSION_ID: 'sess-1' },
      },
    });
    expect(out).toContain('[mcp_servers.sillyhub-file]');
    expect(out).toContain(`command = ${Q}node${Q}`);
    expect(out).toContain(`args = [${Q}mcp-server.js${Q}, ${Q}--toolset${Q}, ${Q}file${Q}]`);
    expect(out).toContain('[mcp_servers.sillyhub-file.env]');
    expect(out).toContain(`MCP_SESSION_ID = ${Q}sess-1${Q}`);
  });

  it('非托管行保留：既有 model 托管段与用户行原样不动', () => {
    const existing = [
      `model = ${Q}gpt-5${Q}`,
      `model_provider = ${Q}sillyhub${Q}`,
      '',
      '[model_providers.sillyhub]',
      `name = ${Q}SillyHub${Q}`,
      '',
      '# user comment',
      '[projects."X/repo"]',
      `trust_level = ${Q}trusted${Q}`,
    ].join('\n');
    const out = mergeCodexMcpToml(existing, { s: { command: 'x' } });
    expect(out).toContain(`model = ${Q}gpt-5${Q}`);
    expect(out).toContain('[model_providers.sillyhub]');
    expect(out).toContain('# user comment');
    expect(out).toContain('[projects."X/repo"]');
    expect(out).toContain('[mcp_servers.s]');
  });

  it('幂等：merge 两次同配置结果一致（不重复不残留）', () => {
    const cfg = { s: { command: 'x', env: { K: 'v' } } };
    const once = mergeCodexMcpToml('', cfg);
    const twice = mergeCodexMcpToml(once, cfg);
    expect(twice).toBe(once);
    expect(twice.split('[mcp_servers.s]').length - 1).toBe(1);
  });

  it('旧段重写：换配置后旧 server 不残留（幽灵 server 防护）', () => {
    const withOld = mergeCodexMcpToml('', { old: { command: 'a' } });
    const replaced = mergeCodexMcpToml(withOld, { fresh: { command: 'b' } });
    expect(replaced).not.toContain('[mcp_servers.old]');
    expect(replaced).toContain('[mcp_servers.fresh]');
  });

  it('空表：返回原文不动（跳过语义）', () => {
    const existing = `model = ${Q}x${Q}\n`;
    expect(mergeCodexMcpToml(existing, {})).toBe(existing);
  });
});

describe('codex-settings: writeCodexMcpServers（task-06 写盘）', () => {
  it('写盘落 CODEX_HOME/config.toml 且与既有内容合并', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-mcp-'));
    await writeCodexMcpServers(dir, {
      s: { command: 'node', args: ['a.js'], env: { K: 'v' } },
    });
    const text = readFileSync(join(dir, 'config.toml'), 'utf-8');
    expect(text).toContain('[mcp_servers.s]');
    expect(text).toContain(`command = ${Q}node${Q}`);
    expect(text).toContain(`K = ${Q}v${Q}`);
  });

  it('空表跳过：不写 config.toml', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-mcp-'));
    await writeCodexMcpServers(dir, {});
    expect(() => readFileSync(join(dir, 'config.toml'), 'utf-8')).toThrow();
  });
});
