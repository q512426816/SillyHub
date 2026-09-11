// tests/provider-adapter-registry.test.ts
// change 2026-09-11-provider-adapter-registry task-06（FR-05 / design Wave 4）：
// ProviderAdapter 聚合契约守护测试——五组用例把「新引擎接入一份声明」的完整度
// 从编译期 satisfies（字段齐备）升格到跨注册表运行时对账，杜绝任一侧新增引擎
// 而聚合表未同步（或反向：聚合表收口漏改派生注册表）的静默漂移：
//
//   ① 跨注册表对账（双向夹逼，包含关系——三表键数天然不同：聚合表 4 /
//      detector 12 / backend 词表 3，严格三表相等不可实现也不必要）：
//      聚合表键 ⊆ PROVIDER_SPECS 检测键全集（interactive 引擎必须可探测）；
//      backend agent_kind 词表 ⊆ 聚合表键（backend 可下发 kind 必有声明，
//      词表读 backend 源文件解析——对齐 test_provider_caps_alignment.py「源文件
//      读取式」先例，避免跨语言 import）；同组锁 REGISTRY 惰性派生等价
//      （getInjector 与 adapter.envInjector 逐键一致）。
//   ② smokeSuite 存在性：声明即存在（writer 条目强制非空；空串=未声明冒烟
//      仅非 writer 条目允许）。
//   ③ 词表扫描：writer 条目的 smokeSuite 文件文本含 api_format 词表全量
//      字面量（表驱动覆盖的静态代理判据，R-05 保守规则：词表全出现才过，
//      规则写在本注释可演进；claude/cursor 的 smokeSuite 无写盘器语义不校验）。
//   ④ caps 一致：caps.provider_switch 与 adapter.switchable 逐引擎同值
//      （caps 10 键集合联动已由 tests/interactive/provider-registry.test.ts
//      tenKeys canary 覆盖，不重复）。
//   ⑤ 生成脚本幂等：gen-provider-caps.mjs 两连跑，第二遍前后双产物
//      （frontend provider-caps.ts + backend provider_caps.py）逐字节不变。
//
// 本文件只读源对账不复制值断言（对齐测试先例）；不改任何实现源码。

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERACTIVE_PROVIDERS } from '../src/interactive/providers.js';
import { PROVIDER_SPECS } from '../src/agent-detector.js';
import { getInjector } from '../src/credential-injector.js';

// ── 路径定位 ─────────────────────────────────────────────────────────────────
//
// 测试位于 sillyhub-daemon/tests/：上一级 = daemon 仓根（smokeSuite 声明的
// 相对路径基准），再上一级 = monorepo 仓根（backend 词表源 / 生成双产物）。
// worktree 内运行时读到的是本 worktree 的源（与 backend 对齐测试同前提）。

const testsDir = dirname(fileURLToPath(import.meta.url));
const daemonRoot = resolve(testsDir, '..');
const repoRoot = resolve(daemonRoot, '..');

/** backend agent_kind 词表源文件（Literal 声明在 schema.py:22）。 */
const BACKEND_SCHEMA_PATH = join(
  repoRoot,
  'backend',
  'app',
  'modules',
  'llm_provider',
  'schema.py',
);

/**
 * api_format 词表（词表常量在测试内声明，注释锚 backend/app/modules/
 * llm_provider/schema.py:33 `api_format: Literal["anthropic", "openai_chat"]`
 * ——同 provider-registry.test.ts nineKeys→tenKeys canary 先例：词表加值时
 * 此处与 pi/codex-settings 表驱动用例组同步，③ 的静态扫描随字面量收紧）。
 */
const API_FORMAT_VOCAB: readonly string[] = ['anthropic', 'openai_chat'];

/**
 * 读 backend agent_kind Literal 词表（源文件读取式解析，不跨语言 import）。
 *
 * 失败语义响亮：文件缺失 / Literal 声明不匹配 / 解析为空都直接抛错（防哑绿
 * ——「找不到词表」绝不能伪装成「词表为空子集恒真」）。
 */
function readBackendAgentKindVocab(): string[] {
  if (!existsSync(BACKEND_SCHEMA_PATH)) {
    throw new Error(`backend schema 源文件缺失: ${BACKEND_SCHEMA_PATH}（对账前提）`);
  }
  const text = readFileSync(BACKEND_SCHEMA_PATH, 'utf-8');
  const literal = /agent_kind\s*:\s*Literal\[([^\]]*)\]/.exec(text);
  if (literal === null) {
    throw new Error(
      `未在 ${BACKEND_SCHEMA_PATH} 找到 agent_kind Literal 声明（词表锚点漂移，检查解析器与源）`,
    );
  }
  const vocab = [...literal[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  if (vocab.length === 0) {
    throw new Error(
      `agent_kind Literal 词表解析为空: ${BACKEND_SCHEMA_PATH}（词表不可能为空，解析器失配）`,
    );
  }
  return vocab;
}

/** fileSettings 是否为写盘器（ProviderFileSettingsWriter 有 write 方法；none 形态有 kind 键）。 */
function isWriter(
  fileSettings: unknown,
): fileSettings is { write: unknown } {
  return (
    typeof fileSettings === 'object' &&
    fileSettings !== null &&
    'write' in fileSettings
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 跨注册表对账（双向夹逼：聚合表 ⊆ detector 键；backend 词表 ⊆ 聚合表）
// ─────────────────────────────────────────────────────────────────────────────

describe('task-06 守护① 跨注册表对账（聚合表覆盖引擎全集，包含关系夹逼）', () => {
  it('聚合表每键 ∈ PROVIDER_SPECS 检测键全集（interactive 引擎必须可探测，聚合表 ⊆ detector）', () => {
    const detectorKeys = Object.keys(PROVIDER_SPECS);
    // 防哑绿：detector 表非空（agent-detector.ts 12 键全集）。
    expect(detectorKeys.length).toBeGreaterThan(0);
    for (const key of Object.keys(INTERACTIVE_PROVIDERS)) {
      expect(
        detectorKeys.includes(key),
        `聚合表键 ${key} 不在 agent-detector PROVIDER_SPECS 检测键内（interactive 引擎必须可探测）`,
      ).toBe(true);
    }
  });

  it('backend agent_kind 词表（源读取解析）⊆ 聚合表键（backend 可下发 kind 必有声明）', () => {
    const vocab = readBackendAgentKindVocab();
    const aggregateKeys = Object.keys(INTERACTIVE_PROVIDERS);
    for (const kind of vocab) {
      expect(
        aggregateKeys.includes(kind),
        `backend agent_kind 词表含 ${kind} 但聚合表未声明（backend 可下发的 kind 必须在 INTERACTIVE_PROVIDERS 有条目）`,
      ).toBe(true);
    }
  });

  it('REGISTRY 惰性派生等价：getInjector 与 adapter.envInjector 逐键一致（聚合表与派生注册表不漂移）', () => {
    for (const [key, adapter] of Object.entries(INTERACTIVE_PROVIDERS)) {
      const injector = getInjector(key);
      if (typeof adapter.envInjector === 'function') {
        // 实例声明 → 派生注册表返回注入器（agentKind 自洽）。
        expect(
          injector,
          `${key} 声明 envInjector 懒工厂但 getInjector 未注册（REGISTRY 派生漂移）`,
        ).toBeDefined();
        expect(injector?.agentKind).toBe(key);
        expect(typeof injector?.toEnv).toBe('function');
      } else {
        // none 声明 → 按现行语义不注册（codex/cursor：无 env 注入面）。
        expect(
          injector,
          `${key} 声明 envInjector=none 但 getInjector 注册了（REGISTRY 派生漂移）`,
        ).toBeUndefined();
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② smokeSuite 存在性
// ─────────────────────────────────────────────────────────────────────────────

describe('task-06 守护② smokeSuite 存在性（声明即存在）', () => {
  it('writer 条目（codex/pi）smokeSuite 非空且声明的测试文件真实存在；非 writer 若声明也必须存在', () => {
    for (const [key, adapter] of Object.entries(INTERACTIVE_PROVIDERS)) {
      const writer = isWriter(adapter.fileSettings);
      const suite = adapter.smokeSuite;
      if (writer) {
        // FR-05：写盘器强制冒烟——writer 条目空串即红。
        expect(
          suite.length > 0,
          `${key} 的 fileSettings 是写盘器但 smokeSuite 为空（FR-05 写盘器强制声明冒烟套件）`,
        ).toBe(true);
      }
      if (suite.length > 0) {
        // 空串=未声明冒烟（仅非 writer 允许），跳过文件断言。
        expect(
          suite.startsWith('tests/'),
          `${key} 的 smokeSuite 须为相对 daemon 仓根的 tests/ 下路径，实际: ${suite}`,
        ).toBe(true);
        const suitePath = join(daemonRoot, suite);
        expect(
          existsSync(suitePath),
          `${key} 的 smokeSuite 声明的文件不存在: ${suitePath}（冒烟套件改名/删除须同步聚合表）`,
        ).toBe(true);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ 词表扫描（R-05 保守规则：词表全出现才过）
// ─────────────────────────────────────────────────────────────────────────────

describe('task-06 守护③ smokeSuite 词表扫描（writer 的冒烟文件含 api_format 词表全量字面量）', () => {
  it("writer 条目的 smokeSuite 文本均含 'anthropic' 与 'openai_chat'（全词表表驱动覆盖的静态代理判据）", () => {
    // 只校验 fileSettings 为 writer 的引擎（codex/pi）——claude/cursor 的
    // smokeSuite 锚 env 注入器 / driver 层，无「api_format → 协议字段」写盘
    // 语义，词表扫描不适用。带引号匹配（'anthropic'）避免误匹配
    // 'anthropic-messages' 等派生词；扫描规则保守可演进（R-05）。
    const writers = Object.entries(INTERACTIVE_PROVIDERS).filter(([, adapter]) =>
      isWriter(adapter.fileSettings),
    );
    // 防哑绿：现状 writer 恰 codex/pi 两引擎，writer 判定失配（0 条）即红。
    expect(writers.length).toBeGreaterThan(0);
    for (const [key, adapter] of writers) {
      const suitePath = join(daemonRoot, adapter.smokeSuite);
      const text = readFileSync(suitePath, 'utf-8');
      for (const literal of API_FORMAT_VOCAB) {
        expect(
          text.includes(`'${literal}'`),
          `${key} 的 smokeSuite ${adapter.smokeSuite} 缺少词表字面量 '${literal}'（FR-05：写盘器冒烟须覆盖全部支持格式——词表加值时补用例并同步 API_FORMAT_VOCAB）`,
        ).toBe(true);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ caps 一致
// ─────────────────────────────────────────────────────────────────────────────

describe('task-06 守护④ caps 一致（provider_switch 单源）', () => {
  it('caps.provider_switch 与 adapter.switchable 逐引擎同值', () => {
    // caps 10 键集合 / 键序联动已由 tests/interactive/provider-registry.test.ts
    // 用例 4（tenKeys canary + 同引用断言）覆盖，此处不重复，只锁单源一致。
    for (const [key, adapter] of Object.entries(INTERACTIVE_PROVIDERS)) {
      expect(
        adapter.caps.provider_switch,
        `${key} 的 caps.provider_switch 与 switchable 不同值（单源失同步）`,
      ).toBe(adapter.switchable);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ 生成脚本幂等
// ─────────────────────────────────────────────────────────────────────────────

describe('task-06 守护⑤ 生成脚本幂等（gen-provider-caps.mjs 两连跑双产物逐字节不变）', () => {
  it('第二遍前后 frontend/backend 双产物内容逐字节相等（脚本 exit 非 0 直接 fail 透传）', () => {
    const scriptPath = join(daemonRoot, 'scripts', 'gen-provider-caps.mjs');
    expect(existsSync(scriptPath), `生成脚本缺失: ${scriptPath}`).toBe(true);
    const products = [
      join(repoRoot, 'frontend', 'src', 'lib', 'provider-caps.ts'),
      join(repoRoot, 'backend', 'app', 'modules', 'agent', 'provider_caps.py'),
    ];
    for (const p of products) {
      expect(existsSync(p), `生成产物缺失: ${p}（先跑一次脚本产出并提交）`).toBe(true);
    }

    // execFileSync 直跑 node 二进制（TaskCard 语义的 execSync('node …') 稳健
    // 形态——免 shell 引号 / Windows PATH 差异）；脚本守卫失败 exit 1 时
    // execFileSync 抛错即本用例红（响亮失败透传）。
    const run = () =>
      execFileSync(process.execPath, [scriptPath], {
        cwd: daemonRoot,
        stdio: 'pipe',
      });

    run(); // 第一遍
    const afterFirst = products.map((p) => readFileSync(p, 'utf-8'));
    run(); // 第二遍
    const afterSecond = products.map((p) => readFileSync(p, 'utf-8'));

    // 幂等判据 = 第二遍前后逐字节相等（比 git diff 稳：不依赖 git 状态）。
    // 注：若 daemon 单源 caps 改值后未重跑生成，第一遍会刷新产物（工作树变
    // 脏）——那是三端失同步，由 backend 对齐测试红出；本组只锁幂等。脚本
    // 意外改坏产物时本用例 fail，还原走：
    //   git checkout -- frontend/src/lib/provider-caps.ts backend/app/modules/agent/provider_caps.py
    for (let i = 0; i < products.length; i++) {
      expect(
        afterSecond[i],
        `${products[i]} 第二遍生成后内容漂移（脚本非幂等：检查渲染键序/缩进/引号稳定性）`,
      ).toBe(afterFirst[i]);
    }
  });
});
