// tests/interactive/provider-registry.test.ts
// task-05（FR-05 / D-002@v1 / design §5.2）：providers.ts 注册表与 InteractiveProvider 推导。
//
// 覆盖（task-05 验收）：
//   1. 注册表键集合 = InteractiveProvider 联合（编译层 canary + 运行时键集断言）
//   2. 两 provider 的 createDriver 可实例化（mock deps；零参构造等价 cli.ts 现行 new）
//   3. 未注册键经 SessionManager.create → UnsupportedProviderError（错误语义不变）
//   4. descriptor.caps 与 PROVIDER_CAPS 单源：同引用（toBe）且逐值相等
//   5. family 值合法：属于 6 协议联合，且与 adapters 反查表 PROVIDER_TO_PROTOCOL 一致
//   6. descriptor 基本形状（provider 键自洽 / displayName 非空 / createDriver 是函数）

import { describe, it, expect, vi } from 'vitest';
import {
  INTERACTIVE_PROVIDERS,
  PROVIDER_CAPS,
  type InteractiveProvider,
  type ProviderDescriptor,
} from '../../src/interactive/providers.js';
import {
  PROTOCOL_PROVIDERS,
  PROVIDER_TO_PROTOCOL,
} from '../../src/adapters/index.js';
import { ClaudeSdkDriver } from '../../src/interactive/claude-sdk-driver.js';
import { CodexAppServerDriver } from '../../src/interactive/codex-app-server-driver.js';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type { SessionManagerDeps } from '../../src/interactive/types.js';
import { UnsupportedProviderError } from '../../src/interactive/types.js';
import type {
  InteractiveDriver,
  InteractiveDriverCallbacks,
  InteractiveDriverHandle,
  UserTurnInput,
} from '../../src/interactive/driver.js';

// ── 编译层断言（tsc / IDE 报错即失败；先例：tests/interactive/driver.test.ts） ──

/**
 * 键集 canary：InteractiveProvider 联合当前恰为 claude|codex。
 * 注册表新增 provider 而未更新此字面量 → 此处编译报错，强制同步确认联合扩展
 *（编译层守护：keyof 推导本身不会「漂移」，此 canary 防的是误删键 / 键改名）。
 */
const _compileTimeKeySet: Record<InteractiveProvider, true> = {
  claude: true,
  codex: true,
};
void _compileTimeKeySet;

/** createDriver 契约签名：接受 ProviderDriverDeps（预留形态）、返回 InteractiveDriver。 */
const _factoryType: ProviderDescriptor['createDriver'] = () => new ClaudeSdkDriver();
void _factoryType;

// ── fake driver（未注册键用例：注入形态对齐 session-manager-driver-registry.test.ts） ──

/** 最小 fake driver（InteractiveDriver 契约）；start 为 spy 供「不应被调」断言。 */
function makeFakeDriver(provider: 'claude' | 'codex'): InteractiveDriver {
  const handle: InteractiveDriverHandle = {
    provider,
    close: vi.fn(async () => {}),
  };
  return {
    start: vi.fn(
      async (
        _input: AsyncIterable<UserTurnInput>,
        _opts: unknown,
      ): Promise<InteractiveDriverHandle> => handle,
    ),
    consume: vi.fn(
      async (
        _h: InteractiveDriverHandle,
        _cb: InteractiveDriverCallbacks,
      ): Promise<void> => {},
    ),
    interrupt: vi.fn(async (_h: InteractiveDriverHandle | null) => true),
  };
}

describe('task-05 provider registry（INTERACTIVE_PROVIDERS / design §5.2）', () => {
  it('1. 运行时键集合 = 编译层 InteractiveProvider 联合（claude/codex）', () => {
    expect(Object.keys(INTERACTIVE_PROVIDERS).sort()).toEqual(['claude', 'codex']);
    // 编译层 canary 字面量与运行时注册表键两视角对齐（同集）。
    expect(Object.keys(_compileTimeKeySet).sort()).toEqual(
      Object.keys(INTERACTIVE_PROVIDERS).sort(),
    );
  });

  it('2. descriptor 基本形状：provider 键自洽 + displayName 非空 + createDriver 可调', () => {
    for (const [key, d] of Object.entries(INTERACTIVE_PROVIDERS)) {
      expect(d.provider).toBe(key);
      expect(typeof d.displayName).toBe('string');
      expect(d.displayName.length).toBeGreaterThan(0);
      expect(typeof d.createDriver).toBe('function');
    }
  });

  it('3. family 值合法：属于 6 协议联合，且与 adapters 反查表 PROVIDER_TO_PROTOCOL 一致', () => {
    const sixProtocols = Object.keys(PROTOCOL_PROVIDERS);
    expect(sixProtocols.slice().sort()).toEqual([
      'json_rpc',
      'jsonl',
      'ndjson',
      'pi_json',
      'stream_json',
      'text',
    ]);
    for (const d of Object.values(INTERACTIVE_PROVIDERS)) {
      // 合法性：family 必须落在 6 协议联合内。
      expect(sixProtocols).toContain(d.family);
      // 一致性：与批量层反查表同源（interactive 注册表不得另立映射）。
      expect(d.family).toBe(PROVIDER_TO_PROTOCOL[d.provider]);
    }
    // 现值锚点（漂移可见）：PROTOCOL_PROVIDERS 中 claude∈stream_json、codex∈json_rpc。
    expect(INTERACTIVE_PROVIDERS.claude?.family).toBe('stream_json');
    expect(INTERACTIVE_PROVIDERS.codex?.family).toBe('json_rpc');
  });

  it('4. caps 与 PROVIDER_CAPS 单源：同引用（toBe）且逐值相等、8 契约键齐全', () => {
    const eightKeys = [
      'edit_patch',
      'mcp',
      'model_select',
      'multimodal',
      'permission_dialog',
      'resume',
      'subagent',
      'thinking',
    ];
    for (const [key, d] of Object.entries(INTERACTIVE_PROVIDERS)) {
      // 单源引用（非复制值）：descriptor.caps 必须就是 PROVIDER_CAPS 的表项对象。
      expect(d.caps).toBe(PROVIDER_CAPS[key]);
      expect(Object.keys(d.caps).slice().sort()).toEqual(eightKeys);
      for (const [capKey, capValue] of Object.entries(d.caps)) {
        expect(capValue).toBe(PROVIDER_CAPS[key]?.[capKey as keyof typeof d.caps]);
        expect(typeof capValue).toBe('boolean');
      }
    }
  });

  it('5. createDriver 可实例化（mock deps）：claude→ClaudeSdkDriver / codex→CodexAppServerDriver', () => {
    // mock deps：预留占位入参（工厂现状零参构造不消费，传占位验证签名兼容）。
    const mockDeps = { env: { SILLYHUB_TEST: '1' } };

    const claudeDriver = INTERACTIVE_PROVIDERS.claude?.createDriver(mockDeps);
    expect(claudeDriver).toBeInstanceOf(ClaudeSdkDriver);
    expect(claudeDriver?.provider).toBe('claude'); // E5：driver 归属标识自洽

    const codexDriver = INTERACTIVE_PROVIDERS.codex?.createDriver(mockDeps);
    expect(codexDriver).toBeInstanceOf(CodexAppServerDriver);
    expect(codexDriver?.provider).toBe('codex');
  });

  it('6. 未注册键 → UnsupportedProviderError（经 SessionManager.create，错误语义不变）', async () => {
    const fakeClaude = makeFakeDriver('claude');
    // deps.driver 必填为 ClaudeSdkDriver 类型；运行时 duck-type 兼容
    //（先例：session-manager-driver-registry.test.ts 1.1/1.4 同款构造）。
    const deps = {
      drivers: { claude: fakeClaude },
      onTurnResult: vi.fn(async () => {}),
      onTurnMessage: vi.fn(async () => {}),
      onSessionEnd: vi.fn(async () => {}),
    } as unknown as SessionManagerDeps;
    const sm = new SessionManager(deps, {});

    // 联合外字符串（运行时可能来自持久层/daemon 透传），类型层用 as 模拟。
    await expect(
      sm.create({
        sessionId: 'sess-registry-1',
        leaseId: 'lease-registry-1',
        claimToken: 'token-registry-1',
        firstPrompt: 'hi',
        firstRunId: 'run-registry-1',
        cwd: '/tmp',
        provider: '__unregistered__' as InteractiveProvider,
        pathToClaudeCodeExecutable: '/fake/claude',
      }),
    ).rejects.toBeInstanceOf(UnsupportedProviderError);
    // 错误在写 store 前抛出：已注入的 claude driver 不应被误调。
    expect(fakeClaude.start).not.toHaveBeenCalled();
  });
});
