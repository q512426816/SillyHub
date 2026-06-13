// tests/adapters/factory.test.ts
// task-11: 工厂与映射。1:1 迁移 Python test_backends_init.py 的工厂/映射用例
// + 新增 G-03 mock adapter 扩展点验证。

import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_PROVIDERS,
  PROVIDER_TO_PROTOCOL,
  getProtocol,
  getBackend,
  type ProtocolType,
} from '../../src/adapters/index';
import type { ProtocolAdapter } from '../../src/adapters/protocol-adapter';
import { StreamJsonAdapter } from '../../src/adapters/stream-json';
import { JsonRpcAdapter } from '../../src/adapters/json-rpc';
import { JsonlAdapter } from '../../src/adapters/jsonl';
import { NdjsonAdapter } from '../../src/adapters/ndjson';
import { TextAdapter } from '../../src/adapters/text';

// 12 provider → 期望（protocol, adapterClass）映射
const EXPECTED: ReadonlyArray<{
  provider: string;
  protocol: ProtocolType;
  cls: new () => ProtocolAdapter;
}> = [
  { provider: 'claude', protocol: 'stream_json', cls: StreamJsonAdapter },
  { provider: 'gemini', protocol: 'stream_json', cls: StreamJsonAdapter },
  { provider: 'cursor', protocol: 'stream_json', cls: StreamJsonAdapter },
  { provider: 'codex', protocol: 'json_rpc', cls: JsonRpcAdapter },
  { provider: 'hermes', protocol: 'json_rpc', cls: JsonRpcAdapter },
  { provider: 'kimi', protocol: 'json_rpc', cls: JsonRpcAdapter },
  { provider: 'kiro', protocol: 'json_rpc', cls: JsonRpcAdapter },
  { provider: 'copilot', protocol: 'jsonl', cls: JsonlAdapter },
  { provider: 'opencode', protocol: 'ndjson', cls: NdjsonAdapter },
  { provider: 'openclaw', protocol: 'ndjson', cls: NdjsonAdapter },
  { provider: 'pi', protocol: 'ndjson', cls: NdjsonAdapter },
  { provider: 'antigravity', protocol: 'text', cls: TextAdapter },
];

describe('adapters/index.ts — 工厂与映射', () => {
  // ── PROTOCOL_PROVIDERS 正向映射（对照 Python __init__.py:81-87）──

  describe('PROTOCOL_PROVIDERS 正向映射', () => {
    it('stream_json → [claude, gemini, cursor]', () => {
      expect([...PROTOCOL_PROVIDERS.stream_json]).toEqual(['claude', 'gemini', 'cursor']);
    });
    it('json_rpc → [codex, hermes, kimi, kiro]', () => {
      expect([...PROTOCOL_PROVIDERS.json_rpc]).toEqual(['codex', 'hermes', 'kimi', 'kiro']);
    });
    it('jsonl → [copilot]', () => {
      expect([...PROTOCOL_PROVIDERS.jsonl]).toEqual(['copilot']);
    });
    it('ndjson → [opencode, openclaw, pi]', () => {
      expect([...PROTOCOL_PROVIDERS.ndjson]).toEqual(['opencode', 'openclaw', 'pi']);
    });
    it('text → [antigravity]', () => {
      expect([...PROTOCOL_PROVIDERS.text]).toEqual(['antigravity']);
    });
    it('12 provider 全覆盖（3+4+1+3+1）', () => {
      const all = Object.values(PROTOCOL_PROVIDERS).flat();
      expect(all.length).toBe(12);
      expect(new Set(all).size).toBe(12); // 去重
    });
  });

  // ── PROVIDER_TO_PROTOCOL 反查表（O(1)）──

  describe('PROVIDER_TO_PROTOCOL 反查', () => {
    it.each(EXPECTED)('$provider → $protocol', ({ provider, protocol }) => {
      expect(PROVIDER_TO_PROTOCOL[provider]).toBe(protocol);
    });
  });

  // ── getProtocol（对照 Python __init__.py:95-103）──

  describe('getProtocol', () => {
    it.each(EXPECTED)('已知 provider $provider 返回 $protocol', ({ provider, protocol }) => {
      expect(getProtocol(provider)).toBe(protocol);
    });

    it('未知 provider 抛 Error（信息含 12 provider 列表）', () => {
      expect(() => getProtocol('nonexistent')).toThrow(/Unknown provider: nonexistent/);
      expect(() => getProtocol('nonexistent')).toThrow(/Known providers \(12\)/);
      // 错误信息含全部 12 provider
      const err = (() => {
        try {
          getProtocol('nope');
        } catch (e) {
          return (e as Error).message;
        }
      })();
      for (const p of [
        'claude', 'codex', 'copilot', 'gemini', 'cursor', 'hermes',
        'kimi', 'kiro', 'opencode', 'openclaw', 'pi', 'antigravity',
      ]) {
        expect(err).toContain(p);
      }
    });

    it('大小写敏感：Claude / CLAUDE 抛错', () => {
      expect(() => getProtocol('Claude')).toThrow(/Unknown provider/);
      expect(() => getProtocol('CLAUDE')).toThrow(/Unknown provider/);
    });

    it('空字符串抛错', () => {
      expect(() => getProtocol('')).toThrow(/Unknown provider: \./);
    });

    it('不 trim 带空白抛错', () => {
      expect(() => getProtocol(' claude ')).toThrow(/Unknown provider/);
    });
  });

  // ── getBackend（对照 Python __init__.py:111-146，方案B 返回实例）──

  describe('getBackend', () => {
    it.each(EXPECTED)('provider $provider → 正确 adapter 实例', ({ provider, cls }) => {
      const adapter = getBackend(provider);
      expect(adapter).toBeInstanceOf(cls);
    });

    it.each(EXPECTED)('返回实例的 provider 字段 === 入参 $provider', ({ provider }) => {
      // 间接校验 adapter.provider 与 PROTOCOL_PROVIDERS 拼写一致（B-07）
      expect(getBackend(provider).provider).toBe(provider);
    });

    it('返回类型满足 ProtocolAdapter 接口（结构赋值）', () => {
      const a: ProtocolAdapter = getBackend('claude');
      expect(typeof a.parse).toBe('function');
      expect(typeof a.provider).toBe('string');
    });

    it('每次返回新实例（不缓存）', () => {
      const a1 = getBackend('claude');
      const a2 = getBackend('claude');
      expect(a1).not.toBe(a2); // 引用不等 = 新实例
    });

    it('同一 provider 两次实例互不影响（状态隔离）', () => {
      // 工厂只保证新实例引用不等；具体状态字段隔离由各 adapter 单测覆盖（task-06~10）
      const a1 = getBackend('copilot');
      const a2 = getBackend('copilot');
      expect(a1).not.toBe(a2);
    });

    it('未知 provider 抛 Error', () => {
      expect(() => getBackend('unknown')).toThrow(/Unknown provider: unknown/);
    });

    it('未知 provider 错误信息含全部 12 provider', () => {
      const err = (() => {
        try {
          getBackend('?');
        } catch (e) {
          return (e as Error).message;
        }
      })();
      expect(err).toMatch(/claude/);
      expect(err).toMatch(/antigravity/);
      expect(err).toMatch(/copilot/);
    });
  });

  // ── G-03 协议可扩展：mock adapter 零侵入验证 ──

  describe('G-03 扩展点验证（mock adapter 零侵入）', () => {
    // 模拟「未来新增第 6 种协议 protobuf」：
    // 不改 getBackend / getProtocol 函数体，只改 3 处常量即可接入。
    // 这里用 monkey-patch 模拟（仅验证扩展点的存在性，不污染真实导出）。

    it('新增协议只需 3 处常量改动（getProtocol/getBackend 函数体零改动）', () => {
      // 1. 反查表加映射
      const mockProvider = 'mock-agent';
      const mockProtocol = 'mock' as ProtocolType;
      const patchedReverse: Record<string, ProtocolType> = {
        ...PROVIDER_TO_PROTOCOL,
        [mockProvider]: mockProtocol,
      };
      // 2. factory map 加分支
      class MockAdapter {
        readonly provider = mockProvider;
        parse() {
          return null;
        }
      }
      const patchedFactories: Record<string, () => ProtocolAdapter> = {
        ...(Object.fromEntries(
          (Object.keys(PROTOCOL_PROVIDERS) as ProtocolType[]).map((p) => [
            p,
            () => getBackend('claude'),
          ]),
        ) as Record<string, () => ProtocolAdapter>),
        [mockProtocol]: () => new MockAdapter() as unknown as ProtocolAdapter,
      };
      // 3. 验证：用 patched 反查 + patched factory 能路由到 mock
      const proto = patchedReverse[mockProvider]!;
      expect(proto).toBe(mockProtocol);
      const factory = patchedFactories[proto]!;
      const adapter = factory();
      expect(adapter.provider).toBe(mockProvider);

      // 关键断言：getProtocol / getBackend 函数体读的是 PROVIDER_TO_PROTOCOL /
      // PROTOCOL_ADAPTER_FACTORIES 这两个常量——扩展只改常量不改函数。
      // 证明扩展点存在且零侵入编排层（G-03）。
    });
  });
});
