---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-10
title: text adapter（src/adapters/text.ts，antigravity）
priority: P0
estimated_hours: 2
depends_on: [task-05]
blocks: [task-11]
allowed_paths:
  - sillyhub-daemon/src/adapters/text.ts
  - sillyhub-daemon/tests/fixtures/text/
---

# task-10：text adapter（src/adapters/text.ts，antigravity）

> 变更：`2026-06-13-daemon-nodejs-rewrite`，Wave W1（协议抽象层），最简单的 adapter。
> Python 源对照：`sillyhub_daemon/backends/text.py`（85-102 行 `parse_line`）。
> 协议语义：antigravity（agy CLI）的 stdout 是纯文本，按行输出，无结构化事件。每条非空行即一条 text 事件。
> 本任务把 Python 版的 `parse_line` 逻辑 1:1 迁移到 TS，落地为 `ProtocolAdapter` 接口（task-05）的实现类 `TextAdapter`。

- Wave：W1（协议抽象层）
- 依赖：task-05（`ProtocolAdapter` 接口已定义，`AgentEvent` 从 `types.ts` import）
- 阻塞：task-11（`getBackend` 工厂 + `PROTOCOL_PROVIDERS` 映射，需 import `TextAdapter`）
- Python 源对照：
  - `sillyhub_daemon/backends/text.py:85-102` —— `parse_line` 核心逻辑
  - `sillyhub_daemon/backends/text.py:38-49` —— class 元信息（provider='antigravity'）
  - `sillyhub_daemon/tests/test_text_backend.py:85-132` —— 纯文本样本用例，1:1 提取

---

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/adapters/text.ts` | `TextAdapter` 类，`implements ProtocolAdapter`；无状态、无 `onControl`（text 协议无 stdin 应答需求） |
| 新增 | `sillyhub-daemon/tests/fixtures/text/antigravity/*.txt` | 若干典型纯文本行 + 空行 + 纯空白行样本（fixture 文件，供测试读入） |
| 新增 | `sillyhub-daemon/tests/adapters/text.test.ts`（不计入 allowed_paths，开发期验证） | vitest 单测，1:1 迁移 `test_text_backend.py` 中 `TestTextParseOutput` + 边界用例 |

> 说明：fixture 与测试文件用于验证，但 allowed_paths 只锁定产出物本身（`text.ts` + `fixtures/text/`）。测试文件按 task-04 脚手架的测试目录约定放置，不写入 allowed_paths 是因为它是验证产物而非交付物。

---

## 实现要求

1. **`export class TextAdapter implements ProtocolAdapter`**：实现 task-05 定义的 `ProtocolAdapter` 接口。`provider` 字段为只读字面量 `'antigravity'`（与 task-11 `PROTOCOL_PROVIDERS.text` 数组中的值逐字一致）。

2. **`parse(line)` 核心逻辑（对齐 Python `parse_line:85-102`）**：
   - 对入参 `line` 做 `.trim()`（对应 Python `line.strip()`）。
   - trim 后为空串 → 返回 `null`（对应 Python `return None`，表示该行主动丢弃、不产事件）。
   - trim 后非空 → 返回 `[{ type: 'text', content: trimmed }]`（单元素数组；对应 Python 的 `AgentEvent(event_type="text", content=stripped)`）。
   - **content 用 trim 后的值**（Python `content=stripped`，非原 `line`），保留 Python 行为：前导/尾随空白被吃掉。

3. **complete 事件判定（关键决策）**：
   - **本 adapter 不主动产出 `complete` 事件**。
   - 依据 Python 源 `text.py`：`parse_line` 只产出 `text` 事件，无 complete 分支；`TextBackend.execute`（Python）在子进程退出后通过 `await proc.wait()` 获得终态，写入 `TaskResult.status`，**不经 parse_line**。
   - Node 版方案B：子进程终态（exit code / timeout / abort）由 task-19 TaskRunner 在 `spawn` 退出回调中判定，再据此合成 `complete` 或 `error` 事件提交给 server。text adapter 的 parse 不参与终态判定。
   - 因此 `TextAdapter.parse` 对任何 `line` 只会返回 `null`（空行）或 `[{type:'text', ...}]`（非空行），**永不返回 `type: 'complete'` 的事件**。JSDoc 须写明此决策与 Python 源的对应关系。

4. **无状态（最简单 adapter）**：
   - Python 版的 `_TextState`（output 累积字段）在 Node 版**不复刻**。理由：方案B 把「输出累积」职责从 adapter 剥离到 TaskRunner（task-19）单点——adapter 只负责把一行解析成 event，由 TaskRunner 把所有事件累积成最终 `output` 字段。
   - `TextAdapter` 实例字段为零（仅 `readonly provider`），每次 `parse` 调用都是纯函数行为（相同输入永远相同输出）。
   - JSDoc 注明：「Python 版 `TextBackend._state.output` 的行累积逻辑下沉到 task-19 TaskRunner，本 adapter 不持有跨行状态」。

5. **不实现 `onControl`**：text 协议（antigravity/agy）无 stdin 应答需求（Python `text.py` 全文无 stdin write）。按 task-05 B-02 约定，`onControl` 是可选方法，`TextAdapter` 不声明它，TaskRunner 调用前用 `typeof adapter.onControl === 'function'` 守卫跳过。

6. **错误行处理（对齐 task-05 B-04）**：text 协议没有「无法解析」的概念（任何字符串都是合法文本）。唯一会被丢弃的是空/纯空白行（返回 null）。parse 不抛异常。

---

## 接口定义

以下是 `sillyhub-daemon/src/adapters/text.ts` 的完整内容（搬砖工照抄即可）：

```ts
/**
 * TextAdapter —— antigravity（agy CLI）纯文本 stdout 协议的 adapter 实现。
 *
 * 协议语义：
 *   antigravity 的 stdout 是逐行纯文本（无结构化事件 / 无 JSON）。
 *   每条非空（trim 后非空）行即一条 text 事件；空行被丢弃。
 *
 * Python 源对照：
 *   sillyhub_daemon/backends/text.py:85-102  parse_line —— 本文件 parse 的 1:1 迁移
 *   sillyhub_daemon/backends/text.py:38-49   class 元信息（provider='antigravity'）
 *
 * 方案B 拆分（design.md §5.1）：
 *   Python 版 TextBackend 同时承担「执行子进程」（execute）+「解析输出」（parse_line）
 *   +「累积 output」（_state.output）。Node 版拆开——
 *     - 子进程执行 → task-19 TaskRunner 单点；
 *     - output 累积 → task-19 TaskRunner 累积事件 content；
 *     - 本 adapter 只保留纯解析职责：parse(line) → AgentEvent[]。
 *   因此本类无实例状态（除了 readonly provider）。
 *
 * complete 事件判定（关键）：
 *   本 adapter 不主动产出 complete 事件。Python text.py 的 parse_line 同样只产 text，
 *   终态（completed/failed/timeout）由 execute() 内的 proc.wait() 获得，不经 parse_line。
 *   Node 版由 task-19 TaskRunner 在子进程退出回调中据 exit code 合成 complete/error 事件。
 *
 * @see design.md §5.1（方案B 拆分）/ §7.2（ProtocolAdapter 接口）/ §7.3（PROTOCOL_PROVIDERS）
 */

import type { AgentEvent } from '../types.js';
import type { ProtocolAdapter } from './protocol-adapter.js';

/**
 * antigravity 纯文本协议 adapter。
 *
 * 无状态：每次 parse 调用互不影响，相同输入永远相同输出。
 * 多个 lease 可共享同一个 TextAdapter 实例（task-11 工厂可缓存单例）。
 */
export class TextAdapter implements ProtocolAdapter {
  /**
   * provider 标识，必须与 PROTOCOL_PROVIDERS.text 数组中的值逐字一致。
   * 对照 Python text.py:41 `provider: str = "antigravity"`。
   */
  readonly provider = 'antigravity' as const;

  /**
   * 解析一行 antigravity stdout。
   *
   * 行为（对齐 Python text.py:85-102 parse_line）：
   *   1. line.trim() 得到 stripped；
   *   2. stripped === '' → 返回 null（该行被主动丢弃，不产事件）；
   *   3. stripped !== '' → 返回 [{ type: 'text', content: stripped }]。
   *
   * content 用 trim 后的值（与 Python content=stripped 一致），前导/尾随空白被去除。
   *
   * @param line 子进程 stdout 的一行（已去换行符，UTF-8 字符串；由 task-19 readline 负责）
   * @returns 单元素数组（非空行）或 null（空/纯空白行）；永不返回 complete/error 类型事件
   */
  parse(line: string): AgentEvent[] | null {
    const stripped = line.trim();
    if (stripped === '') {
      return null;
    }
    return [{ type: 'text', content: stripped }];
  }
}
```

---

## 边界处理

| 编号 | 边界场景 | 处理策略 |
|---|---|---|
| **B-01** | **空行（`""`）** | `line.trim() === ''` → 返回 `null`。对应 Python `text.py:94-95` `if not stripped: return None` + `test_text_backend.py:95-98` `test_parse_output_empty_line_skipped`。TaskRunner 收到 null 即跳过该行，不向 server 发空消息。 |
| **B-02** | **纯空白行（`"   "` / `"\t\t"` / 混合 tab+space）** | trim 后为空串 → 同 B-01 返回 `null`。对应 Python `test_parse_output_whitespace_line_skipped`（`test_text_backend.py:100-103`）。Python `str.strip()` 与 JS `String.prototype.trim()` 行为一致（都去除 Unicode 空白）。 |
| **B-03** | **CRLF / CR 行尾（`"hello\r\n"` / `"hello\r"`）** | **parse 不直接处理换行符**——line 由 task-19 TaskRunner 用 `readline` 切行后传入，`readline` 默认按 `\n` / `\r\n` / `\r` 切割并去除行尾分隔符（Node `readline` 的 `crlfDelay` 默认 100ms 支持 CRLF 混用）。故 parse 收到的 line 无 `\n`，但可能残留尾部 `\r`（若 readline 配置异常）。`line.trim()` 会吃掉残留的 `\r`（trim 去除所有 Unicode 空白含 `\r`），content 为干净文本。**双保险**：trim 同时覆盖了换行符残留与正常的前后空白。 |
| **B-04** | **超大行（如单行 > 1MB）** | parse 本身不限制长度，直接 trim 后包成 event 返回。潜在风险：内存膨胀 + server submit_messages 的 body 超限。**应对**：text 协议（antigravity）实际不会输出超长单行（agent 输出是自然语言段落，分行合理）；若需保护，由 task-19 TaskRunner 在累积 output 时做截断（对齐 Python `task_runner.py` 的 output ≤ 10000 字符限制），**不在 adapter 层截断**（保持 adapter 纯解析、零业务策略）。 |
| **B-05** | **非 UTF-8 字节 / 二进制噪声** | parse 不负责编码修复。Node readline 默认按 UTF-8 解码，无法解码的字节被替换为 U+FFFD（�）。parse 对替换后的字符串照常 trim + 返回 text 事件（content 含 �）。若整行都是二进制（极端），trim 后若非空仍当 text 返回（对齐 Python `text.py:160` `raw_line.decode(errors="replace")` 的容错策略）。编码修复不是 adapter 职责。 |
| **B-06** | **complete 事件何时触发** | **本 adapter 不产 complete**。Python `text.py:179-185` 的终态（`self._state.final_status`）由 `execute()` 内 `proc.wait()` 后写入 `TaskResult.status`，不经 parse_line。Node 版对应：task-19 TaskRunner 在子进程 `exit` 事件中据 code（0=completed / 非0=failed）+ 看门狗（timeout）合成终态，再向 server 发 complete/error 事件。parse 只负责把 stdout 行转成 text 事件流，不参与终态判定。 |
| **B-07** | **`provider` 字段大小写与工厂一致性** | `provider` 必须为小写 `'antigravity'`（无空格、无大写），与 task-11 `PROTOCOL_PROVIDERS.text = ['antigravity']` 逐字一致。task-11 工厂会做 `if (adapter.provider !== expectedProvider) throw` 断言。本实现用 `as const` 锁定字面量类型，防止拼写漂移。 |

---

## 非目标

本任务**不做**以下事项（明确排除，防止 scope creep）：

- **N-10-1**：不执行子进程（spawn / stdin / 超时 / 退出码处理）。执行职责在 task-19 TaskRunner。本 adapter 只解析已切好的行。
- **N-10-2**：不实现 `getBackend` 工厂和 `PROTOCOL_PROVIDERS` 映射。在 task-11。
- **N-10-3**：不迁移 `test_text_backend.py` 的 `TestTextBuildArgs`（build_args 测试，85-78 行）。Python 版的 `build_args`（组装 agy CLI argv）在 Node 版下沉到 task-19 TaskRunner 的 spawn 参数构造，不是 adapter 职责。本任务只迁移 `TestTextParseOutput`（parse 相关）+ `TestTextBackendMeta` 的 provider 断言。
- **N-10-4**：不做行缓冲（buffer 未 complete 的行）。行切分由 task-19 TaskRunner 用 `readline` 负责，传入 parse 的永远是完整一行（已去换行符）。adapter 不感知「行边界」概念。
- **N-10-5**：不累积 output（Python `_state.output` 的多行拼接）。累积职责在 task-19 TaskRunner。本 adapter 无实例状态。
- **N-10-6**：不实现 `onControl`（text 协议无 stdin 应答）。声明为可选方法，本类不实现。
- **N-10-7**：不处理 antigravity 的 stderr。stderr 由 task-19 TaskRunner 单独捕获并合成 error 事件（或写入日志），不经 adapter parse。

---

## 参考

### Python 源文件

| 文件 | 行 | 提取内容 |
|---|---|---|
| `sillyhub-daemon/sillyhub_daemon/backends/text.py` | 1-5 | 模块 docstring：antigravity 纯文本 stdout 协议 |
| `sillyhub-daemon/sillyhub_daemon/backends/text.py` | 38-49 | `class TextBackend(AgentBackend)`：`provider='antigravity'`、`binary_name='agy'`、`_TextState` 初始化 |
| `sillyhub-daemon/sillyhub_daemon/backends/text.py` | 85-102 | **核心** `parse_line`：`stripped = line.strip()` → 空则 None / 非空则 `AgentEvent(event_type="text", content=stripped)` |
| `sillyhub-daemon/sillyhub_daemon/backends/text.py` | 104-106 | `parse_output` async wrapper（Node 版不需要，parse 直接同步） |
| `sillyhub-daemon/sillyhub_daemon/backends/text.py` | 110-185 | `execute`（子进程执行 + output 累积）—— **不在本任务范围**，下沉 task-19 |
| `sillyhub-daemon/tests/test_text_backend.py` | 85-132 | `TestTextParseOutput`：非空行→text event / 空行→None / 纯空白→None / output 累积（累积部分下沉 task-19，不迁移） |
| `sillyhub-daemon/tests/test_text_backend.py` | 140-153 | `TestTextBackendMeta`：`provider == 'antigravity'`、issubclass(AgentBackend)（Node 版对应 `instanceof ProtocolAdapter` 或结构赋值断言） |
| `sillyhub-daemon/sillyhub_daemon/backends/__init__.py` | 19-31 | `AgentEvent` dataclass → task-02 已映射为 TS interface |
| `sillyhub-daemon/sillyhub_daemon/backends/__init__.py` | 81-87 | `PROTOCOL_PROVIDERS['text'] = ['antigravity']` → task-11 映射 |

### 设计文档

| 文档 | 章节 | 说明 |
|---|---|---|
| `design.md` | §5.1 分层架构 | ProtocolAdapter 抽象层定位 + 方案B 拆分原理（执行/解析分离） |
| `design.md` | §7.1 统一中间表示 AgentEvent（IR） | `{ type, content, metadata? }` 结构，本 adapter 产出的 text 事件形态 |
| `design.md` | §7.2 ProtocolAdapter 抽象接口 | `parse(line): AgentEvent[] \| null` 签名 + `onControl?` 可选 |
| `design.md` | §7.3 工厂与映射 | `PROTOCOL_PROVIDERS.text = ['antigravity']`，task-11 注册本 adapter |
| `design.md` | §10 R-01 | 协议翻译偏差风险（P0）：1:1 迁移 Python fixture |
| `design.md` | §10 R-04 | 子进程 stdout 行切分（readline，task-19 负责，本 adapter 不感知） |

### 模块文档

| 文档 | 说明 |
|---|---|
| `.sillyspec/docs/sillyhub-daemon/modules/backends.md` | `AgentEvent.event_type` 值域（text/tool_use/tool_result/thinking/status/error），本 adapter 只产 text；`PROTOCOL_PROVIDERS` 映射约定 |

### 关联 task

| task | 关系 |
|---|---|
| task-02 | 提供 `AgentEvent` 类型（`src/types.ts`），本 adapter import |
| task-05 | 提供 `ProtocolAdapter` 接口（`src/adapters/protocol-adapter.ts`），本 adapter implements |
| task-11 | `getBackend` 工厂 + `PROTOCOL_PROVIDERS`，import 本 `TextAdapter` 并注册到 `text: ['antigravity']` |
| task-19 | TaskRunner：用 readline 切行 → 调 `TextAdapter.parse` → 累积事件 → 子进程退出后合成 complete/error 终态 |

---

## TDD 步骤

> 严格遵循「文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收」。本任务的测试是 1:1 迁移 Python `test_text_backend.py` 的 parse 相关用例（不迁移 build_args / output 累积，已在非目标 N-10-3 / N-10-5 排除）。

### 步骤 1：读 Python 源与现有代码

- 读 `sillyhub-daemon/sillyhub_daemon/backends/text.py`（确认 parse_line 逻辑）。
- 读 `sillyhub-daemon/tests/test_text_backend.py`（提取 fixture 样本：`"Hello, I am an agent"`、`""`、`"   "`、`"Line 1"` / `"Line 2"` / `"Line 3"`）。
- 确认 task-05 的 `src/adapters/protocol-adapter.ts` 已产出（`ProtocolAdapter` 接口可 import）。若未就绪，本任务阻塞（depends_on task-05）。

### 步骤 2：写 fixture 文本样本

在 `sillyhub-daemon/tests/fixtures/text/antigravity/` 下创建样本文件（纯文本，供测试 `fs.readFile` 读入）：

```
tests/fixtures/text/antigravity/
├── single-line.txt        # "Hello, I am an agent"
├── empty.txt              # ""（空文件）
├── whitespace.txt         # "   "（纯空白）
├── multi-line.txt         # "Line 1\n\nLine 2\n   \nLine 3"（含空行 + 纯空白行）
└── crlf.txt               # "Hello\r\nWorld\r\n"（CRLF 行尾，验证 trim 兜底）
```

> fixture 文件用于验证「从真实文件读入 → 切行 → parse」的端到端行为，覆盖 R-04（行切分）与 B-03（CRLF）。

### 步骤 3：写测试（tests/adapters/text.test.ts）

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextAdapter } from '../../src/adapters/text.js';
import type { ProtocolAdapter } from '../../src/adapters/protocol-adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'text', 'antigravity');

describe('TextAdapter — antigravity 纯文本协议', () => {
  let adapter: TextAdapter;

  beforeEach(() => {
    adapter = new TextAdapter();
  });

  // ── 元信息（对照 test_text_backend.py:140-153 TestTextBackendMeta）──

  describe('meta', () => {
    it('provider 为 "antigravity"', () => {
      expect(adapter.provider).toBe('antigravity');
    });

    it('实现 ProtocolAdapter 接口（结构赋值）', () => {
      const a: ProtocolAdapter = adapter;
      expect(a).toBe(adapter);
    });
  });

  // ── parse 非空行（对照 test_text_backend.py:88-93 TestTextParseOutput.test_parse_output_non_empty_line）──

  describe('parse — 非空行', () => {
    it('非空行 → 单元素数组 [{type:"text", content:line}]', () => {
      const events = adapter.parse('Hello, I am an agent');
      expect(events).toEqual([{ type: 'text', content: 'Hello, I am an agent' }]);
    });

    it('含前后空白的非空行 → content 为 trim 后值', () => {
      const events = adapter.parse('  hello world  ');
      expect(events).toEqual([{ type: 'text', content: 'hello world' }]);
    });

    it('fixture single-line.txt 读入后 parse', () => {
      const line = readFileSync(join(FIXTURE_DIR, 'single-line.txt'), 'utf8').trim();
      const events = adapter.parse(line);
      expect(events).toEqual([{ type: 'text', content: 'Hello, I am an agent' }]);
    });
  });

  // ── parse 空行 / 纯空白行（对照 test_text_backend.py:95-103）──

  describe('parse — 空行 / 纯空白行', () => {
    it('空字符串 → null', () => {
      expect(adapter.parse('')).toBeNull();
    });

    it('纯空格 → null', () => {
      expect(adapter.parse('   ')).toBeNull();
    });

    it('纯 tab → null', () => {
      expect(adapter.parse('\t\t')).toBeNull();
    });

    it('混合空白（空格+tab+换行残留 \\r）→ null', () => {
      expect(adapter.parse(' \t\r ')).toBeNull();
    });
  });

  // ── 无状态验证（对照 Python _state.output 累积已下沉 task-19）──

  describe('无状态', () => {
    it('连续 parse 多行，每次结果独立（无累积副作用）', () => {
      const e1 = adapter.parse('Line 1');
      const e2 = adapter.parse('');
      const e3 = adapter.parse('Line 2');
      expect(e1).toEqual([{ type: 'text', content: 'Line 1' }]);
      expect(e2).toBeNull();
      expect(e3).toEqual([{ type: 'text', content: 'Line 2' }]);
    });

    it('两个 TextAdapter 实例互不影响', () => {
      const a = new TextAdapter();
      const b = new TextAdapter();
      a.parse('foo');
      expect(b.parse('bar')).toEqual([{ type: 'text', content: 'bar' }]);
    });
  });

  // ── 不产 complete / error 事件（B-06）──

  describe('事件类型约束', () => {
    it('parse 永不返回 complete 事件', () => {
      // 任何输入都只产 text 或 null
      const inputs = ['', 'done', 'task completed', 'error occurred', 'EXIT'];
      for (const line of inputs) {
        const events = adapter.parse(line);
        if (events !== null) {
          for (const ev of events) {
            expect(ev.type).toBe('text');
          }
        }
      }
    });
  });

  // ── CRLF fixture（B-03 双保险）──

  describe('CRLF 行尾', () => {
    it('残留 \\r 被 trim 吃掉', () => {
      // 模拟 readline 切行后残留 \r 的极端情况
      const events = adapter.parse('hello\r');
      expect(events).toEqual([{ type: 'text', content: 'hello' }]);
    });
  });
});
```

### 步骤 4：写实现（src/adapters/text.ts）

照抄上文「接口定义」章节的完整 TS 代码。

### 步骤 5：跑测试 + tsc

```bash
cd sillyhub-daemon
npx tsc --noEmit                                           # AC-04: 零错误
npx vitest run tests/adapters/text.test.ts                 # AC-03: 全绿
```

### 步骤 6：对照 Python 用例人工核对

逐条对照 `test_text_backend.py:85-132`：
- `test_parse_output_non_empty_line` → 本测试「非空行 → 单元素数组」✅
- `test_parse_output_empty_line_skipped` → 本测试「空字符串 → null」✅
- `test_parse_output_whitespace_line_skipped` → 本测试「纯空格 → null」✅
- `test_parse_output_accumulates_output` / `test_parse_output_empty_lines_not_in_output` / `test_parse_output_non_empty_lines_separated_by_newline` → **不迁移**（output 累积下沉 task-19，见 N-10-5）

---

## 验收标准

| 编号 | 验收项 | 验证方法 | 通过标准 |
|---|---|---|---|
| **AC-01** | 非空行 parse 产出 text event | `npx vitest run tests/adapters/text.test.ts -t "非空行"` | `parse('Hello, I am an agent')` 返回 `[{type:'text', content:'Hello, I am an agent'}]`，断言通过 |
| **AC-02** | 空行 / 纯空白行 parse 返回 null | `npx vitest run tests/adapters/text.test.ts -t "空行"` | `parse('')` / `parse('   ')` / `parse('\t\t')` 全部返回 `null`，断言通过 |
| **AC-03** | vitest 全绿 | `cd sillyhub-daemon && npx vitest run tests/adapters/text.test.ts` | exit code 0，所有 describe 块通过，无 fail/skip |
| **AC-04** | tsc 零错误 | `cd sillyhub-daemon && npx tsc --noEmit` | exit code 0，无任何 error/warning 输出（strict + noImplicitAny） |
| **AC-05** | `TextAdapter` 实现 `ProtocolAdapter` 接口 | 测试中 `const a: ProtocolAdapter = new TextAdapter()` 编译通过 | tsc 不报类型错误；结构赋值断言通过 |
| **AC-06** | `provider` 字段为 `'antigravity'`（小写、与 PROTOCOL_PROVIDERS 一致） | `grep "readonly provider" src/adapters/text.ts` | 命中 `readonly provider = 'antigravity' as const;` 一行；值与 task-11 `PROTOCOL_PROVIDERS.text` 数组元素逐字相等 |
| **AC-07** | parse 返回的数组中事件 `type` 恒为 `'text'` | 测试「事件类型约束」块 | 任意非空输入 parse 后，所有 event.type === 'text'；永不出现 complete/error/tool_use 等 |
| **AC-08** | 无实例状态（除 readonly provider） | `grep -E "private \|protected " src/adapters/text.ts` | 返回空（无私有/保护字段）；`grep "this\." src/adapters/text.ts` 仅命中 parse 内的 `line` 入参引用（无 `this._state` 等） |
| **AC-09** | 不实现 `onControl` | `grep "onControl" src/adapters/text.ts` | 返回空（本类不声明 onControl 方法，依赖 task-05 接口的可选性） |
| **AC-10** | fixture 文件存在且可读 | `ls sillyhub-daemon/tests/fixtures/text/antigravity/` | 至少含 single-line.txt / empty.txt / whitespace.txt / multi-line.txt / crlf.txt 5 个文件，非空文件可被 `readFileSync` 读入 |
| **AC-11** | 仅触碰 allowed_paths 内文件 | `git diff --name-only HEAD` | 产出物为 `sillyhub-daemon/src/adapters/text.ts` + `sillyhub-daemon/tests/fixtures/text/**`；测试文件 `tests/adapters/text.test.ts` 作为开发期验证产物不计入 allowed_paths（task-04 脚手架约定） |
| **AC-12** | 与 Python `parse_line` 行为 1:1 | 人工对照 `text.py:85-102` | trim 策略一致、空判定一致、content 取值一致（trim 后）、返回 null 的条件一致 |

---

## 自审清单（生成者自查）

- [x] 接口定义完整，搬砖工照抄即可产出可编译的 text.ts
- [x] parse 逻辑与 Python `text.py:85-102` 1:1（trim → 空 null / 非空 text event）
- [x] complete 事件决策有 Python 源依据（text.py 终态由 execute 内 proc.wait 决定，不经 parse_line）
- [x] 无状态决策有方案B 依据（output 累积下沉 task-19，design.md §5.1）
- [x] 边界处理 ≥ 5 条（实际 7 条：空行/纯空白/CRLF/超大行/非UTF-8/complete触发/provider一致性）
- [x] 非目标 ≥ 4 条（实际 7 条，明确划界 build_args / output 累积 / 行缓冲 / onControl / stderr）
- [x] 验收标准表格化、每条可机器或人工验证，无笼统「正确」
- [x] TDD 步骤含 fixture 文件清单 + 测试代码骨架，1:1 对照 Python 用例编号
- [x] 参考章节标注 Python 源行号 + design 章节 + 模块文档 + 关联 task
- [x] frontmatter 字段完整（id/priority/estimated_hours/depends_on/blocks/allowed_paths）
