---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-04
title: 测试脚手架（tests/ + fixture 目录复用 Python 样本）
priority: P0
estimated_hours: 1
depends_on: [task-01]
blocks: [task-06, task-07, task-08, task-09, task-10, task-22]
allowed_paths:
  - sillyhub-daemon/tests/
  - sillyhub-daemon/tests/fixtures/
  - sillyhub-daemon/tests/helpers.ts
  - sillyhub-daemon/tests/_sanity.test.ts
---

# task-04 测试脚手架（tests/ + fixture 目录复用 Python 样本）

## 修改文件

| 操作 | 路径 | 说明 |
|------|------|------|
| 新建 | `sillyhub-daemon/tests/helpers.ts` | fixture 加载辅助函数（`loadFixture` / `loadLines`），供所有 adapter 测试复用 |
| 新建 | `sillyhub-daemon/tests/_sanity.test.ts` | 占位 sanity 测试，验证 vitest 可启动、helper 可 import |
| 新建 | `sillyhub-daemon/tests/fixtures/README.md` | fixture 目录结构、命名约定、提取策略说明（指导 task-06~10） |
| 新建目录 | `sillyhub-daemon/tests/fixtures/stream-json/` | stream-json 协议样本（claude/gemini/cursor），task-06 填充 |
| 新建目录 | `sillyhub-daemon/tests/fixtures/json-rpc/` | JSON-RPC 样本（codex/hermes/kimi/kiro），task-07 填充 |
| 新建目录 | `sillyhub-daemon/tests/fixtures/jsonl/` | JSONL 样本（copilot），task-08 填充 |
| 新建目录 | `sillyhub-daemon/tests/fixtures/ndjson/` | NDJSON 样本（opencode/openclaw/pi），task-09 填充 |
| 新建目录 | `sillyhub-daemon/tests/fixtures/text/` | 纯文本样本（antigravity），task-10 填充 |

> 本任务只搭骨架（目录 + helpers + sanity + README），fixture 文件的实际内容在各 adapter task（task-06~10）从对应 Python `test_*_backend.py` 的 inline `json.dumps(...)` 样本中提取落盘。

## 实现要求

### 1. 目录结构

`tests/` 顶层最终形态（task-04 负责画线部分，其余在后续 task 增量填充）：

```
sillyhub-daemon/tests/
├── helpers.ts                    ★ task-04：loadFixture / loadLines
├── _sanity.test.ts               ★ task-04：vitest 可用性验证
├── fixtures/
│   ├── README.md                 ★ task-04：命名约定 + 提取策略
│   ├── stream-json/              ★ task-04 建空目录，task-06 填 .jsonl/.txt 样本
│   │   └── .gitkeep
│   ├── json-rpc/                 ★ task-04 建空目录，task-07 填
│   │   └── .gitkeep
│   ├── jsonl/                    ★ task-04 建空目录，task-08 填
│   │   └── .gitkeep
│   ├── ndjson/                   ★ task-04 建空目录，task-09 填
│   │   └── .gitkeep
│   └── text/                     ★ task-04 建空目录，task-10 填
│       └── .gitkeep
├── stream-json.test.ts           task-06
├── json-rpc.test.ts              task-07
├── jsonl.test.ts                 task-08
├── ndjson.test.ts                task-09
├── text.test.ts                  task-10
└── ...（其余在 task-22 迁移）
```

空目录用 `.gitkeep` 占位，保证 git 能提交目录结构。

### 2. fixture 子目录规划

每个子目录存放该协议的真实 stdout 样本行，命名约定（写入 `fixtures/README.md`）：

- 协议目录名 = 适配器协议名（与 `src/adapters/*.ts` 一一对应）。
- 文件名格式：`<provider>-<scenario>.<ext>`
  - `<provider>`：来源 backend（claude / gemini / cursor / codex / copilot / opencode / antigravity ...）。
  - `<scenario>`：用例语义（`system-init` / `assistant-text` / `tool-use` / `result-error` / `full-session` ...）。
  - `<ext>`：`.jsonl`（每行一个 JSON 对象）/ `.txt`（纯文本行）/ `.jsonrpc`（每行一个 JSON-RPC 消息）。
- 示例：`stream-json/claude-assistant-text.jsonl`、`json-rpc/codex-full-session.jsonrpc`、`text/antigravity-plain.txt`。
- 每个 fixture 文件 = 一段真实 stdout 输出（按行分割，**不含**人为加工）。
- 跨协议共享的语义（如 "空 fixture"）放各自目录，命名 `<protocol>-empty.<ext>`，便于 adapter 测试统一加载。

提取来源（task-06~10 执行，本任务只在 README 注明）：
- `stream-json/` ← `tests/test_stream_json_backend.py` 内 `json.dumps({...})` 样本（约 15 处）。
- `json-rpc/` ← `tests/test_json_rpc.py` 内 `_build_response/_build_notification` 构造的行。
- `jsonl/` ← `tests/test_jsonl_backend.py` 内 `_build_line({...})`。
- `ndjson/` ← `tests/test_ndjson_backend.py` 内 `_build_line({...})`。
- `text/` ← `tests/test_text_backend.py` 内纯文本字符串。

### 3. helpers API

在 `tests/helpers.ts` 提供：

- `loadFixture(relativePath: string): string` — 读取 `tests/fixtures/<relativePath>` 的完整文本。
- `loadLines(relativePath: string): string[]` — 同上但按 `\n` 切成行数组，**丢弃末尾空行**（最后一行通常是文件结尾换行）。
- 常量 `FIXTURES_DIR` — fixture 根绝对路径（基于 `import.meta.url` 计算），供需要直接拼路径的场景使用。

实现要点：
- 用 `node:fs` 的 `readFileSync` + `node:path` 的 `join`，**禁止用 `__dirname`**（ESM 下不存在），用 `fileURLToPath(import.meta.url)`。
- `loadFixture`/`loadLines` 同步函数（测试里同步加载即可，简单可预测）。

### 4. sanity 测试

`tests/_sanity.test.ts` 验证三件事：
- vitest 能启动并跑断言。
- `helpers.ts` 可被 import 且 `FIXTURES_DIR` 指向真实存在的目录。
- `loadLines` 对一个明确不存在的 fixture 抛错（边界契约）。

测试用例 2 个即可（一个 happy path、一个 error path），不依赖任何 fixture 文件实际内容（避免和 task-06~10 的填充顺序耦合）。

### 5. 命名约定

写入 `fixtures/README.md`，要点：
- 测试文件命名：`<module>.test.ts`，与 Python `test_<module>.py` 对齐。
- fixture 命名见上文 §2。
- helper 只导出函数，不放测试数据。
- 一个 fixture 可被多个 adapter 测试引用（如果同一样本需要验证多种解析行为）。

## 接口定义

### `tests/helpers.ts`

```typescript
// tests/helpers.ts
// 测试脚手架辅助：fixture 加载。供所有 adapter 测试复用。
// task-04 只搭骨架，fixture 内容由 task-06~10 从 Python 测试 inline 样本提取落盘。

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** fixture 根目录绝对路径：tests/fixtures/ */
export const FIXTURES_DIR: string = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

/**
 * 读取 fixture 文件完整文本。
 *
 * @param relativePath 相对 fixtures/ 的路径，如 "stream-json/claude-assistant-text.jsonl"
 * @returns 文件完整字符串
 * @throws Error 当文件不存在（含明确路径信息，便于排错）
 */
export function loadFixture(relativePath: string): string {
  const abs = join(FIXTURES_DIR, relativePath);
  // readFileSync 在文件不存在时抛 ENOENT，这里包一层让消息更友好
  try {
    return readFileSync(abs, "utf-8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    throw new Error(
      `loadFixture: fixture not found: ${relativePath} (resolved: ${abs}, code: ${err.code ?? "unknown"})`,
    );
  }
}

/**
 * 读取 fixture 文件并按行切分数组。
 *
 * - 按 \n 切分。
 * - 丢弃末尾因文件结尾换行产生的空行（保留行间合法空行）。
 *
 * @param relativePath 相对 fixtures/ 的路径
 * @returns 行数组（已去除尾部空行）
 */
export function loadLines(relativePath: string): string[] {
  const raw = loadFixture(relativePath);
  const lines = raw.split("\n");
  // 仅当末行是空串（源于文件结尾 \n）时移除
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}
```

### `tests/_sanity.test.ts`

```typescript
// tests/_sanity.test.ts
// 验证测试脚手架可用：vitest 能跑 + helpers 可 import + 边界契约成立。

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { loadFixture, loadLines, FIXTURES_DIR } from "./helpers";

describe("test scaffolding sanity", () => {
  it("FIXTURES_DIR points to an existing directory", () => {
    expect(existsSync(FIXTURES_DIR)).toBe(true);
  });

  it("loadFixture throws on missing fixture (not silent empty)", () => {
    expect(() => loadFixture("does/not/exist.jsonl")).toThrow(/fixture not found/);
    expect(() => loadLines("does/not/exist.jsonl")).toThrow(/fixture not found/);
  });
});
```

### `tests/fixtures/README.md`（内容大纲）

```markdown
# fixtures

本目录存放各协议 backend 的真实 stdout 样本，供 adapter 测试复用。

## 目录结构

- `stream-json/` — claude / gemini / cursor（src/adapters/stream-json.ts）
- `json-rpc/`   — codex / hermes / kimi / kiro（src/adapters/json-rpc.ts）
- `jsonl/`      — copilot（src/adapters/jsonl.ts）
- `ndjson/`     — opencode / openclaw / pi（src/adapters/ndjson.ts）
- `text/`       — antigravity（src/adapters/text.ts）

## 命名约定

`<provider>-<scenario>.<ext>`

- provider：claude / gemini / codex / copilot / opencode / antigravity ...
- scenario：system-init / assistant-text / assistant-thinking / tool-use /
            tool-result / result-error / full-session / empty ...
- ext：.jsonl（每行一 JSON）/ .txt（纯文本行）/ .jsonrpc（每行一 JSON-RPC 消息）

示例：
- stream-json/claude-assistant-text.jsonl
- json-rpc/codex-full-session.jsonrpc
- text/antigravity-plain.txt

## 提取来源

fixture 内容从 Python 测试的 inline 样本提取（task-06~10 各自执行）：

- stream-json ← tests/test_stream_json_backend.py（json.dumps({...})）
- json-rpc    ← tests/test_json_rpc.py（_build_response / _build_notification）
- jsonl       ← tests/test_jsonl_backend.py（_build_line({...})）
- ndjson      ← tests/test_ndjson_backend.py（_build_line({...})）
- text        ← tests/test_text_backend.py（纯文本字符串）

## 加载方式

通过 tests/helpers.ts：

  import { loadLines } from "../helpers";
  const lines = loadLines("stream-json/claude-assistant-text.jsonl");
```

## 边界处理

| # | 场景 | 处理 |
|---|------|------|
| 1 | fixture 文件不存在 | `loadFixture` / `loadLines` **抛 Error**（消息含 resolved 绝对路径 + errno code），**禁止返回空字符串或空数组**——否则 adapter 测试会拿到假阳性 pass。sanity 测试 `_sanity.test.ts` 显式断言此契约。 |
| 2 | 跨平台路径分隔符 | 一律用 `node:path` 的 `join`（自动处理 `/` vs `\`），**禁止字符串拼接 `/`**。`FIXTURES_DIR` 基于 `import.meta.url` 计算，不依赖 cwd。 |
| 3 | fixture 编码非 UTF-8 | `readFileSync` 固定 `"utf-8"` 读取。若后续有非 UTF-8 样本（暂无），由对应 task 显式处理（本任务不引入 Buffer 分支，避免过度设计）。Python 测试样本均为 UTF-8 字符串，无此风险。 |
| 4 | 空 fixture 文件（存在但 0 字节） | `loadFixture` 返回 `""`，`loadLines` 返回 `[]`（split 后只剩一个空串，pop 掉）。adapter 测试应自行断言对空样本的行为，helper 不做强校验。 |
| 5 | vitest include 配置不匹配 | task-01 的 `vitest.config.ts` 的 `include` 必须覆盖 `tests/**/*.test.ts`。本任务在 sanity 测试完成后执行 `pnpm test` 验证；若 vitest 报 "No test files found"，回查 task-01 配置而非本任务。 |
| 6 | ESM 下 `__dirname` 未定义 | 用 `fileURLToPath(import.meta.url)` + `dirname`，**禁止引用 `__dirname`**（会导致 ReferenceError）。 |
| 7 | fixture 文件含 CRLF（Windows 来源样本） | `loadLines` 只按 `\n` 切，CRLF 会残留 `\r`。提取阶段（task-06~10）应确保样本以 LF 保存；本任务 README 注明"fixture 必须用 LF 换行"。 |

## 非目标

- **不实现任何 adapter**（stream-json / json-rpc / jsonl / ndjson / text 的 parse 逻辑）——那是 task-06~10。
- **不迁移全部 Python 测试用例**——16 个文件 ~6660 行 1:1 迁移在 task-22。本任务只搭骨架 + helpers。
- **不提取 fixture 实际内容**——fixture 文件内容由各 adapter task 在实现时从对应 Python `test_*` 的 inline 样本提取落盘。本任务只建空目录 + `.gitkeep` + README。
- **不写 mock HTTP / mock 子进程框架**——子进程 mock 在 task-11+（TaskRunner），HTTP mock 在 task-12+（HubClient），本任务不涉及。
- **不改 task-01 的 `vitest.config.ts`**——若需调整 include 范围，回退到 task-01 处理。
- **不引入额外测试工具链**（如 supertest / nock / sinon）——本任务零新依赖。

## 参考

- Python 测试目录：`sillyhub-daemon/tests/`（16 个 `test_*.py`，本任务只读不改）。
  - `test_stream_json_backend.py`（inline `json.dumps` 样本约 15 处，task-06 提取目标）。
  - `test_json_rpc.py`（`_build_response`/`_build_notification`/`_build_server_request` helper，task-07 提取目标）。
  - `test_jsonl_backend.py`（`_build_line({...})` helper，task-08 提取目标）。
  - `test_ndjson_backend.py`（`_build_line({...})` helper，task-09 提取目标）。
  - `test_text_backend.py`（纯文本字符串，task-10 提取目标）。
- 扫描文档：`.sillyspec/docs/sillyhub-daemon/scan/TESTING.md`（测试策略：pytest / mock 策略 / 覆盖重点）。
- 模块文档：`.sillyspec/docs/sillyhub-daemon/modules/`（各 backend 协议定义，adapter 实现时对照）。
- task-01：`vitest.config.ts`（include 配置本任务依赖）。
- task-06~10：各 adapter 实现 + fixture 提取落盘。
- task-22：1:1 迁移 16 个 Python 测试到 `*.test.ts`。

## TDD 步骤

1. **建目录骨架**：创建 `tests/`、`tests/fixtures/` 及 5 个协议子目录，每个放 `.gitkeep`。
2. **写 helpers.ts**：按接口定义实现 `loadFixture` / `loadLines` / `FIXTURES_DIR`。
3. **写 sanity 测试**：`_sanity.test.ts` 两个用例（FIXTURES_DIR 存在 + loadFixture 抛错契约）。
4. **写 fixtures/README.md**：命名约定 + 提取策略说明（指导 task-06~10）。
5. **跑绿**：`cd sillyhub-daemon && pnpm test`，确认 vitest 启动、sanity 测试 2 个用例全 pass、退出码 0。
6. **验证 import 可达**：sanity 测试能 `import { loadFixture } from "./helpers"` 成功即证明 helper 模块解析正确（无需额外步骤）。

## 验收标准

| AC | 标准 | 验证方式 |
|----|------|----------|
| AC-01 | `cd sillyhub-daemon && pnpm test` 启动 vitest，`_sanity.test.ts` 2 个用例全部 pass，退出码 0 | 执行命令查看输出，断言 `Test Files 1 passed` 且 `exit code 0` |
| AC-02 | `tests/fixtures/` 下存在 5 个协议子目录（stream-json / json-rpc / jsonl / ndjson / text），每个含 `.gitkeep`；`tests/fixtures/README.md` 存在且含"命名约定"章节 | `ls tests/fixtures/` 列出 5 目录 + README.md；`grep "命名约定" tests/fixtures/README.md` 命中 |
| AC-03 | `tests/helpers.ts` 导出 `loadFixture`、`loadLines`、`FIXTURES_DIR` 三者；`loadFixture("nope")` 抛含 "fixture not found" 的 Error | sanity 测试用例 2 覆盖；或 `pnpm test` 中该断言 pass |
| AC-04 | `tests/helpers.ts` 使用 `fileURLToPath(import.meta.url)` 而非 `__dirname`；路径拼接使用 `path.join` | `grep "__dirname" tests/helpers.ts` 无命中；`grep "path.join\|join(" tests/helpers.ts` 有命中 |
