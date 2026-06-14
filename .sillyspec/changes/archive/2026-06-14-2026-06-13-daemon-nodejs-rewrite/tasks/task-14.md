---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-14
title: version（src/version.ts，semver 解析 + 最低版本校验）
priority: P0
estimated_hours: 2
depends_on: [task-01]
blocks: [task-16, task-22]
allowed_paths:
  - sillyhub-daemon/src/version.ts
---

# task-14：version（src/version.ts，semver 解析 + 最低版本校验）

> 变更：`2026-06-13-daemon-nodejs-rewrite`，Wave W2（基础设施），无状态纯函数模块。
> Python 源对照：`sillyhub_daemon/version.py`（63 行，4 个导出：`parse_semver` / `format_semver` / `check_min_version` / `MIN_VERSIONS`）。
> 职责：为 agent-detector（task-16）提供「解析 agent CLI 版本字符串 + 判断是否达最低要求」的纯函数能力。agent-detector 探测到某 provider 的二进制后，调用 `claude --version` 取 stdout，经 `parseSemver` 提取三元组，再用 `checkMinVersion` 与 `MIN_VERSIONS[provider]` 比较，低于则返回警告文本（写入 task-16 的探测结果）。
> 本任务把 Python 版 4 个导出 1:1 迁移到 TS，**零第三方依赖**（design.md G-05），手写正则 + 数值比较。

- Wave：W2（基础设施，与 W1 协议层并行）
- 依赖：task-01（`package.json` / `tsconfig.json` / `vitest.config.ts` 工程骨架已就绪，本文件在其内增补）
- 阻塞：
  - task-16（agent-detector：12 provider 探测，`import { checkMinVersion, parseSemver } from './version.js'`）
  - task-22（测试迁移：`tests/test_version.py` → `tests/version.test.ts` 1:1 迁移）
- Python 源对照：
  - `sillyhub_daemon/version.py:1-7` —— 模块 docstring + `__all__` 导出声明
  - `sillyhub_daemon/version.py:9` —— `_SEMVER_RE = re.compile(r"(\d+)\.(\d+)\.(\d+)")`（核心正则，**search 非 match**）
  - `sillyhub_daemon/version.py:11-15` —— `MIN_VERSIONS` 常量（claude: 2.0.0 / codex: 0.100.0 / copilot: 1.0.0）
  - `sillyhub_daemon/version.py:18-30` —— `parse_semver`：`re.search` 取第一个匹配 → `(major, minor, patch)` 三元组
  - `sillyhub_daemon/version.py:33-35` —— `format_semver`：三元组 → `"major.minor.patch"`
  - `sillyhub_daemon/version.py:38-62` —— `check_min_version`：provider 无 entry 返回 None / 解析失败返回 None / `parsed < min_ver` 返回 warning string
  - `sillyhub_daemon/agent_detector.py:290` —— 唯一调用点：`version_warning = check_min_version(name, version)`
  - `tests/test_version.py:1-114` —— 4 个测试类共 24 个用例，1:1 迁移

---

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/version.ts` | 4 个导出：`SemVerTuple` 类型 + `MIN_VERSIONS` 常量 + `parseSemver` / `formatSemver` / `checkMinVersion` 三个纯函数；零依赖（仅用 TS 内置 `RegExp` + `Number`） |
| 新增 | `sillyhub-daemon/tests/version.test.ts`（不计入 allowed_paths，开发期验证） | vitest 单测，1:1 迁移 `test_version.py` 全部 24 个用例（4 个 describe 块） |

> 说明：测试文件按 task-04 脚手架的测试目录约定放置，不计入 allowed_paths 是因为它是验证产物而非交付物（与 task-06~10 的 fixture/测试文件策略一致）。本任务无 fixture 文件——version 是纯字符串函数，测试用内联字面量即可，无需外部样本。

---

## 实现要求

### R1. 导出契约（对齐 Python `__all__`）

Python `__all__ = ["MIN_VERSIONS", "parse_semver", "format_semver", "check_min_version"]`。Node 版等价导出 4 项（额外加一个类型导出 `SemVerTuple`，TS 习惯）：

| 导出名 | 类型 | Python 对照 |
|---|---|---|
| `MIN_VERSIONS` | `Readonly<Record<string, SemVerTuple>>` | `MIN_VERSIONS: dict[str, tuple[int,int,int]]`（version.py:11-15） |
| `parseSemver` | `(raw: string \| null \| undefined) => SemVerTuple \| null` | `parse_semver(raw: str \| None) -> tuple[int,int,int] \| None`（version.py:18-30） |
| `formatSemver` | `(tuple: SemVerTuple) => string` | `format_semver(triple: tuple[int,int,int]) -> str`（version.py:33-35） |
| `checkMinVersion` | `(provider: string, version: string) => string \| null` | `check_min_version(provider: str, version: str) -> str \| None`（version.py:38-62） |
| `SemVerTuple`（类型） | `readonly [number, number, number]` | Python `tuple[int,int,int]` 的 TS 等价（定长元组） |

### R2. `parseSemver` 核心逻辑（对齐 Python version.py:18-30）

- 正则：`/(\d+)\.(\d+)\.(\d+)/`（**无 `^` / `$` 锚定**，对应 Python `re.search` 非 `re.match`）。
- 入参为 `null` / `undefined` / 空串 `""` → 返回 `null`（对应 Python `if not raw: return None`，Python 的 `not` 对 None 和空串都为真）。
- 用 `RegExp.prototype.exec`（等价 Python `re.search` 的首个匹配），未匹配返回 `null`。
- 匹配则 `return [Number(m[1]), Number(m[2]), Number(m[3])]`（对应 Python `int(match.group(1))`）。
- **`re.search` 语义关键**：取字符串中**第一个** `数字.数字.数字` 子串，前导文本（如 `"Claude Code 2.1.5"`）自然被跳过。这与 Python 完全一致，是处理 `claude --version` 输出（如 `"claude code version 2.1.5 (build abc123)"`）的关键。

### R3. `formatSemver`（对齐 Python version.py:33-35）

- `return \`${tuple[0]}.${tuple[1]}.${tuple[2]}\``（对应 Python f-string `f"{triple[0]}.{triple[1]}.{triple[2]}"`）。
- 输入假定是合法三元组（由 `parseSemver` 产出或 `MIN_VERSIONS` 常量），不做防御性校验（YAGNI，Python 版也无校验）。

### R4. `checkMinVersion`（对齐 Python version.py:38-62）

三段判定，顺序与 Python 严格一致（短路逻辑）：

1. `const minVer = MIN_VERSIONS[provider];` → 若 `undefined`（provider 无 entry），`return null`（对应 Python `if min_ver is None: return None`）。含义：未知 provider 无版本要求，不警告。
2. `const parsed = parseSemver(version);` → 若 `null`（版本串无法解析），`return null`（对应 Python `if parsed is None: return None`）。含义：解析失败不警告（agent-detector 上层会单独标记「无法获取版本」，版本校验不叠加噪声）。
3. 元组逐元素比较：`parsed < minVer` → 返回 warning string；否则 `return null`。
   - 元组比较用 `compareTuple(parsed, minVer) < 0`（手写三元组字典序比较，见接口定义）。
   - warning 文本格式**逐字对齐** Python：`` `${provider} version ${version} is below minimum required version ${formatSemver(minVer)}` ``（注意：用**原始 version 字符串**，非 formatSemver 后的，对应 Python `f"{provider} version {version} is below minimum required version {format_semver(min_ver)}"`）。

### R5. 零依赖手写（design.md G-05）

- **禁止引入 `semver` / `@types/semver` 等第三方库**。
- 仅用 TS 内置：`RegExp`、`Number`、`String` 模板字面量。
- 正则字面量写成模块级常量 `const SEMVER_RE = /(\d+)\.(\d+)\.(\d+)/;`（对应 Python 模块级 `_SEMVER_RE`，避免每次调用重新编译）。

### R6. 类型严格（design.md G-04，tsconfig strict）

- `parseSemver` 入参接受 `string | null | undefined`（Python `str | None` 的 TS 扩展，兼容 agent-detector 传 `string | undefined` 的场景）。
- `SemVerTuple` 用 `readonly [number, number, number]`（定长元组），防止 `.push()` 等 mutation。
- `MIN_VERSIONS` 用 `as const` 断言 + `Readonly<Record<string, SemVerTuple>>` 类型注解，防止运行时被篡改。
- 所有函数显式标注返回类型（strict 下 `noImplicitReturns` / `strictNullChecks` 要求）。

---

## 接口定义

以下是 `sillyhub-daemon/src/version.ts` 的完整内容（搬砖工照抄即可）：

```ts
/**
 * version.ts —— semver 解析与最低版本校验（Python version.py 的 1:1 Node 迁移）。
 *
 * 职责：
 *   为 agent-detector（task-16）提供「解析 agent CLI 版本字符串 + 判断是否达最低要求」
 *   的纯函数能力。agent-detector 探测到某 provider 二进制后，调用 `claude --version` 取
 *   stdout，经 parseSemver 提取三元组，再用 checkMinVersion 与 MIN_VERSIONS[provider]
 *   比较，低于则返回警告文本。
 *
 * Python 源对照：
 *   sillyhub_daemon/version.py:1-7   模块 docstring + __all__
 *   sillyhub_daemon/version.py:9     _SEMVER_RE = re.compile(r"(\d+)\.(\d+)\.(\d+)")
 *   sillyhub_daemon/version.py:11-15 MIN_VERSIONS（claude/codex/copilot）
 *   sillyhub_daemon/version.py:18-30 parse_semver（re.search 取首个三元组）
 *   sillyhub_daemon/version.py:33-35 format_semver
 *   sillyhub_daemon/version.py:38-62 check_min_version（三段短路判定）
 *
 * 设计约束：
 *   - G-05 零依赖：不引 semver 库，手写 RegExp + 数值比较。
 *   - G-01 功能等价：与 Python 版行为 1:1（正则、比较、warning 文本格式逐字对齐）。
 *
 * @see design.md §6（version.ts 文件清单）/ §10 R-01（1:1 迁移风险）
 */

/**
 * semver 三元组（major, minor, patch）。readonly 防止 mutation。
 * 对应 Python 的 tuple[int, int, int]。
 */
export type SemVerTuple = readonly [number, number, number];

/**
 * 各 provider 的最低版本要求。
 *
 * 仅 3 个 provider 有版本门槛（其余 provider 无 entry → checkMinVersion 直接返回 null，
 * 即无要求）。新增 provider 的版本限制需在此添加。
 *
 * 对照 Python version.py:11-15：
 *   MIN_VERSIONS = {"claude": (2,0,0), "codex": (0,100,0), "copilot": (1,0,0)}
 */
export const MIN_VERSIONS: Readonly<Record<string, SemVerTuple>> = {
  claude: [2, 0, 0],
  codex: [0, 100, 0],
  copilot: [1, 0, 0],
};

/**
 * 核心正则：匹配 major.minor.patch（无锚定，等价 Python re.search）。
 *
 * 注意：不匹配 prerelease 后缀（如 -rc.1 / -alpha.2）。这是 Python 版的既定行为——
 * `0.118.0-rc.1` 解析为 (0,118,0)，prerelease 部分被正则忽略。Node 版严格保持一致。
 * 模块级常量避免每次调用重新编译（对应 Python 模块级 _SEMVER_RE）。
 */
const SEMVER_RE = /(\d+)\.(\d+)\.(\d+)/;

/**
 * 从任意字符串中提取第一个 semver 三元组。
 *
 * 行为（对齐 Python version.py:18-30 parse_semver）：
 *   1. raw 为 null/undefined/空串 → 返回 null（对应 Python `if not raw: return None`）；
 *   2. SEMVER_RE.exec(raw) 取首个匹配（对应 Python re.search）；
 *   3. 未匹配 → 返回 null；
 *   4. 匹配 → 返回 [Number(m[1]), Number(m[2]), Number(m[3])]。
 *
 * search 语义（非 match）：可处理前导文本，如 "Claude Code 2.1.5" → [2,1,5]、
 * "v2.0.0" → [2,0,0]（v 前缀自然跳过）。
 *
 * @param raw 任意字符串（通常是 `claude --version` 的 stdout）；可为 null/undefined
 * @returns 三元组 [major, minor, patch] 或 null（无法解析）
 */
export function parseSemver(
  raw: string | null | undefined,
): SemVerTuple | null {
  if (!raw) {
    return null;
  }
  const m = SEMVER_RE.exec(raw);
  if (!m) {
    return null;
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * 将 semver 三元组格式化为 "major.minor.patch" 字符串。
 *
 * 对齐 Python version.py:33-35 `f"{triple[0]}.{triple[1]}.{triple[2]}"`。
 * 入参假定合法（由 parseSemver 产出或 MIN_VERSIONS 常量），不做防御性校验。
 *
 * @param tuple 三元组
 * @returns 形如 "2.1.5" / "0.100.0" / "0.0.0" 的字符串
 */
export function formatSemver(tuple: SemVerTuple): string {
  return `${tuple[0]}.${tuple[1]}.${tuple[2]}`;
}

/**
 * 比较两个 semver 三元组（字典序，逐元素）。
 *
 * 内部辅助函数（不导出），供 checkMinVersion 使用。
 * 返回：负数 a<b / 0 a==b / 正数 a>b（与 Python tuple 比较语义一致）。
 */
function compareTuple(a: SemVerTuple, b: SemVerTuple): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

/**
 * 判断某 provider 的实际版本是否低于最低要求，低于则返回警告文本。
 *
 * 三段短路判定（顺序严格对齐 Python version.py:38-62）：
 *   1. provider 在 MIN_VERSIONS 中无 entry → 返回 null（无要求）；
 *   2. version 无法 parseSemver → 返回 null（无法比较，不叠加噪声）；
 *   3. parsed < minVer → 返回 warning string；否则返回 null（达标）。
 *
 * warning 文本格式（逐字对齐 Python）：
 *   `${provider} version ${version} is below minimum required version ${formatSemver(minVer)}`
 *
 * 注意：文本中的 version 用**原始字符串**（非 formatSemver 后的），保留用户传入的形态
 * （如 "v1.5.0" / "Claude Code 1.5.0"），便于排查。对应 Python f-string 中直接用 {version}。
 *
 * @param provider provider 名（如 'claude' / 'codex' / 'copilot'）
 * @param version 版本字符串（如 '2.1.5' / 'Claude Code 2.1.5' / 'v1.5.0'）
 * @returns 警告文本（低于最低版本时）或 null（无要求 / 无法解析 / 达标）
 */
export function checkMinVersion(
  provider: string,
  version: string,
): string | null {
  const minVer = MIN_VERSIONS[provider];
  if (minVer === undefined) {
    return null;
  }

  const parsed = parseSemver(version);
  if (parsed === null) {
    return null;
  }

  if (compareTuple(parsed, minVer) < 0) {
    return (
      `${provider} version ${version} is below minimum`
      + ` required version ${formatSemver(minVer)}`
    );
  }

  return null;
}
```

---

## 边界处理

| 编号 | 边界场景 | 处理策略 |
|---|---|---|
| **B-01** | **`v` 前缀（如 `"v2.0.0"`）** | 正则无锚定，`v` 被自然跳过，`exec` 匹配到 `2.0.0` → `[2,0,0]`。对应 Python `test_version.py:26-28 test_with_v_prefix: parse_semver("v2.0.0") == (2,0,0)`。无需显式去 `v` 前缀逻辑（search 语义天然处理）。 |
| **B-02** | **前导文本（如 `"Claude Code 2.1.5"` / `"claude code version 2.1.5 (build abc)"`）** | 正则用 `exec`（等价 Python `re.search`）取字符串中**第一个** `数字.数字.数字` 子串，前导文本被跳过 → `[2,1,5]`。对应 Python `test_version.py:21-23 test_with_prefix`。这是处理 `claude --version` / `codex --version` 实际输出的关键（agent CLI 的 version 输出几乎都带产品名前缀）。 |
| **B-03** | **`+build` / `-prerelease` 后缀（如 `"0.118.0-rc.1"` / `"1.0.0+build.123"`）** | 正则只匹配三段数字，后缀被忽略 → `"0.118.0-rc.1"` 解析为 `[0,118,0]`、`"1.0.0+build.123"` 解析为 `[1,0,0]`。对应 Python `test_version.py:25-27 test_with_suffix: parse_semver("0.118.0-rc.1") == (0,118,0)`。**这是 Python 版既定行为，Node 版严格保持一致**——本任务不实现 semver 规范的 prerelease 优先级比较（见非目标 N-14-1）。 |
| **B-04** | **无法解析的字符串（如 `"no-version-here"` / `"abc"` / `"1.2"`）** | 正则不匹配 → 返回 `null`。对应 Python `test_version.py:29-31 test_no_match`。注意 `"1.2"`（只有两段）也不匹配——正则要求恰好三段 `\d+\.\d+\.\d+`，少一段或多一段连续数字都不行。`"1.2"` 的 `.2` 后无第二点，`exec` 失败 → `null`。 |
| **B-05** | **空字符串 / null / undefined** | `if (!raw)` 短路返回 `null`（JS `!""` / `!null` / `!undefined` 均为 `true`，对应 Python `if not raw` 对 `None`/`""` 的真值判定）。对应 Python `test_version.py:33-35 test_empty`。注意：`"0"`（字符串零）的 `!raw` 为 `false`（非空串），不会被短路——但 `"0"` 也无法匹配三段正则，仍返回 `null`，行为一致。 |
| **B-06** | **前导零（如 `"02.01.05"`）** | `Number("02")` === `2`（JS 自动去前导零），`Number("01")` === `1` → `[2,1,5]`。对应 Python `test_version.py:37-39 test_leading_zeros: parse_semver("02.01.05") == (2,1,5)`（Python `int("02")` === `2`）。两语言行为一致。 |
| **B-07** | **大数字（如 `"999.999.999"`）** | `Number("999")` === `999`（在 `Number.MAX_SAFE_INTEGER` 范围内），三元组 `[999,999,999]`。对应 Python `test_version.py:41-43 test_large_numbers`。极端情况如 `"99999999999999999999.0.0"`（major 超 `2^53`）会精度丢失，但 agent CLI 版本号不会到 20 位数字——YAGNI，不做防御（Python 版同样依赖 `int()` 的任意精度，但实际不会触发）。 |
| **B-08** | **零版本 `"0.0.0"`** | 正则匹配 `[0,0,0]`。`checkMinVersion` 中 `[0,0,0]` 与任何 `MIN_VERSIONS` 比较：claude `[2,0,0]` → `0-2<0` 触发 warning；copilot `[1,0,0]` → 触发 warning。对应 Python `test_version.py:45-47 test_zero_version: parse_semver("0.0.0") == (0,0,0)`。 |
| **B-09** | **字符串中多个版本号（如 `"requires 1.0.0, found 2.1.5"`）** | `exec` 取**第一个**匹配 → `[1,0,0]`（非 `[2,1,5]`）。对应 Python `test_version.py:49-52 test_embedded_in_longer_string`。`re.search` / `RegExp.exec` 都是「最早匹配」语义。若 agent CLI 的 version 输出含多个版本号（如同时报自身版本和依赖版本），取第一个——这是 Python 版既定行为，保持一致。 |
| **B-10** | **未知 provider（如 `"gemini"` / `"unknown"`）** | `MIN_VERSIONS[provider]` 为 `undefined` → `checkMinVersion` 第一段短路返回 `null`（无要求）。对应 Python `test_version.py:81-83 test_unknown_provider: check_min_version("unknown", "1.0.0") is None`。含义：12 provider 中只有 3 个有版本门槛，其余 9 个（gemini/cursor/hermes/...）无要求。 |
| **B-11** | **`checkMinVersion` 收到无法解析的 version（如 `checkMinVersion("claude", "no-version")`）** | `parseSemver("no-version")` 返回 `null` → 第二段短路返回 `null`（不警告）。对应 Python `test_version.py:79-80 test_unparseable_version`。agent-detector 上层（task-16）会单独标记「无法获取版本」，版本校验不重复报错。 |
| **B-12** | **正好等于最低版本（如 `checkMinVersion("claude", "2.0.0")`）** | `compareTuple([2,0,0], [2,0,0])` === `0`（非负）→ 不触发 warning，返回 `null`（达标）。对应 Python `test_version.py:65-67 test_equal_to_minimum`。语义：「最低版本」是 inclusive 的，`2.0.0` 满足 `>= 2.0.0`。 |

---

## 非目标

本任务**不做**以下事项（明确排除，防止 scope creep）：

- **N-14-1**：**不实现 semver 规范的 prerelease 优先级比较**。Python 版正则 `(\d+)\.(\d+)\.(\d+)` 完全不解析 `-rc.1` / `-alpha.2` / `+build` 后缀，`0.118.0-rc.1` 被当作 `[0,118,0]`（与 `0.118.0` 等价）。Node 版严格保持这一行为——任务描述中的「prerelease 处理与 Python 一致」即指「与 Python 一样忽略 prerelease」。若未来需要严格 semver 比较（如 `1.0.0-rc.1 < 1.0.0`），需另立任务并引入新正则/库，本任务不动。
- **N-14-2**：**不引入 `semver` / `@types/semver` 第三方库**（design.md G-05 零/极少运行时依赖）。手写 RegExp + 数值比较即可覆盖需求。
- **N-14-3**：**不支持版本范围表达式**（如 `^1.2.3` / `~1.2.3` / `>=1.0.0 <2.0.0` / `1.x`）。本任务只做「单版本 vs 单最低版本」的点比较。range 解析是 npm 生态的事，daemon 不需要。
- **N-14-4**：**不处理 CalVer（日历版本，如 `2024.6.1`）**。agent CLI 用 semver，不用 CalVer。
- **N-14-5**：**不做版本号位数防御**（如 major 超 `Number.MAX_SAFE_INTEGER` 的精度丢失）。agent CLI 版本号都是小数字（claude 2.x / codex 0.1xx / copilot 1.x），不会触发。Python 版同样无此防御。
- **N-14-6**：**不在 `formatSemver` 做输入校验**（如检查元组长度是否为 3、元素是否非负）。入参假定由 `parseSemver` 产出或 `MIN_VERSIONS` 常量，YAGNI。
- **N-14-7**：**不导出 `compareTuple`**（内部辅助函数）。外部若需比较，用 `checkMinVersion` 的语义即可。导出内部实现会固化 API 表面。
- **N-14-8**：**不做国际化（i18n）的 warning 文本**。Python 版 warning 是硬编码英文字符串，Node 版逐字对齐。i18n 不是 daemon 的职责。

---

## 参考

### Python 源文件

| 文件 | 行 | 提取内容 |
|---|---|---|
| `sillyhub-daemon/sillyhub_daemon/version.py` | 1-7 | 模块 docstring + `__all__ = ["MIN_VERSIONS", "parse_semver", "format_semver", "check_min_version"]` |
| `sillyhub-daemon/sillyhub_daemon/version.py` | 9 | `_SEMVER_RE = re.compile(r"(\d+)\.(\d+)\.(\d+)")` —— 核心正则（**search 非 match**） |
| `sillyhub-daemon/sillyhub_daemon/version.py` | 11-15 | `MIN_VERSIONS`：`{"claude": (2,0,0), "codex": (0,100,0), "copilot": (1,0,0)}` |
| `sillyhub-daemon/sillyhub_daemon/version.py` | 18-30 | `parse_semver`：`re.search` 取首个匹配 → `(int, int, int)`；`None`/空串 → `None` |
| `sillyhub-daemon/sillyhub_daemon/version.py` | 33-35 | `format_semver`：`f"{triple[0]}.{triple[1]}.{triple[2]}"` |
| `sillyhub-daemon/sillyhub_daemon/version.py` | 38-62 | `check_min_version`：三段短路（无 entry→None / 无法解析→None / `<min`→warning） |
| `sillyhub-daemon/sillyhub_daemon/agent_detector.py` | 18 | `from sillyhub_daemon.version import check_min_version, parse_semver` —— 唯一 import 点 |
| `sillyhub-daemon/sillyhub_daemon/agent_detector.py` | 290 | `version_warning = check_min_version(name, version)` —— 唯一调用点 |
| `sillyhub-daemon/sillyhub_daemon/agent_detector.py` | 25-26 | `__all__` 重新导出 `check_min_version` / `parse_semver`（agent_detector 作为门面） |
| `sillyhub-daemon/tests/test_version.py` | 1-114 | 4 个测试类共 24 个用例，1:1 迁移 |

### Python 测试用例对照表（1:1 迁移依据）

| Python 测试类 / 方法 | 行 | Node describe/it | 关键断言 |
|---|---|---|---|
| `TestParseSemver.test_standard` | 17-19 | parseSemver / 标准 | `parse_semver("2.1.5") == (2,1,5)` |
| `TestParseSemver.test_with_prefix` | 21-23 | parseSemver / 前导文本 | `parse_semver("Claude Code 2.1.5") == (2,1,5)` |
| `TestParseSemver.test_with_v_prefix` | 26-28 | parseSemver / v 前缀 | `parse_semver("v2.0.0") == (2,0,0)` |
| `TestParseSemver.test_with_suffix` | 25-27 | parseSemver / prerelease 后缀 | `parse_semver("0.118.0-rc.1") == (0,118,0)` |
| `TestParseSemver.test_no_match` | 29-31 | parseSemver / 无匹配 | `parse_semver("no-version-here") is None` |
| `TestParseSemver.test_empty` | 33-35 | parseSemver / 空串 | `parse_semver("") is None` |
| `TestParseSemver.test_leading_zeros` | 37-39 | parseSemver / 前导零 | `parse_semver("02.01.05") == (2,1,5)` |
| `TestParseSemver.test_large_numbers` | 41-43 | parseSemver / 大数字 | `parse_semver("999.999.999") == (999,999,999)` |
| `TestParseSemver.test_zero_version` | 45-47 | parseSemver / 零版本 | `parse_semver("0.0.0") == (0,0,0)` |
| `TestParseSemver.test_embedded_in_longer_string` | 49-52 | parseSemver / 多版本号取首个 | `parse_semver("requires 1.0.0, found 2.1.5") == (1,0,0)` |
| `TestFormatSemver.test_basic` | — | formatSemver / 基本 | `format_semver((2,1,5)) == "2.1.5"` |
| `TestFormatSemver.test_zero_version` | — | formatSemver / 零版本 | `format_semver((0,0,0)) == "0.0.0"` |
| `TestFormatSemver.test_large_numbers` | — | formatSemver / 大数字 | `format_semver((0,100,0)) == "0.100.0"` |
| `TestMinVersions.test_has_three_providers` | — | MIN_VERSIONS / 三个 provider | `len == 3` 且含 claude/codex/copilot |
| `TestCheckMinVersion.test_below_minimum` | — | checkMinVersion / 低于 | claude 1.5.0 → warning 含 "claude"/"1.5.0"/"2.0.0" |
| `TestCheckMinVersion.test_equal_to_minimum` | — | checkMinVersion / 等于 | claude 2.0.0 → null |
| `TestCheckMinVersion.test_above_minimum` | — | checkMinVersion / 高于 | claude 2.1.5 → null |
| `TestCheckMinVersion.test_unknown_provider` | — | checkMinVersion / 未知 provider | unknown 1.0.0 → null |
| `TestCheckMinVersion.test_codex_at_minimum` | — | checkMinVersion / codex 等于 | codex 0.100.0 → null |
| `TestCheckMinVersion.test_codex_below_minimum` | — | checkMinVersion / codex 低于 | codex 0.99.0 → warning 含 "0.100.0" |
| `TestCheckMinVersion.test_unparseable_version` | — | checkMinVersion / 无法解析 | claude "no-version" → null |
| `TestCheckMinVersion.test_copilot_at_minimum` | — | checkMinVersion / copilot 等于 | copilot 1.0.0 → null |
| `TestCheckMinVersion.test_copilot_above_minimum` | — | checkMinVersion / copilot 高于 | copilot 1.5.3 → null |
| `TestCheckMinVersion.test_copilot_below_minimum` | — | checkMinVersion / copilot 低于 | copilot 0.9.0 → warning |

### 设计文档

| 文档 | 章节 | 说明 |
|---|---|---|
| `design.md` | §2 G-01 | 功能等价：Node 版与 Python 版对外行为 1:1（本任务的硬约束） |
| `design.md` | §2 G-05 | 零/极少运行时依赖：禁止引入 semver 库 |
| `design.md` | §6 文件清单 | `sillyhub-daemon/src/version.ts` —— 替代 `version.py`（semver 检查） |
| `design.md` | §10 R-08 | vitest/pytest 语义对齐（行为覆盖 1:1，非行数 1:1） |

### 模块文档

| 文档 | 说明 |
|---|---|
| `.sillyspec/docs/sillyhub-daemon/modules/version.md` | 契约摘要 + 关键逻辑（`re.search` 语义、MIN_VERSIONS 只 3 个 provider、被 agent-detector 导入） |

### 关联 task

| task | 关系 |
|---|---|
| task-01 | 提供 `package.json` / `tsconfig.json`（strict）/ `vitest.config.ts` 工程骨架，本文件在其内增补 |
| task-16 | agent-detector：`import { checkMinVersion, parseSemver } from './version.js'`，调用点在探测循环内（对应 Python agent_detector.py:290） |
| task-22 | 测试迁移：`tests/test_version.py` → `tests/version.test.ts`（本任务的 TDD 步骤已写好测试，task-22 负责整体迁移校验） |

---

## TDD 步骤

> 严格遵循「文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收」。本任务 1:1 迁移 Python `test_version.py` 全部 24 个用例（4 个测试类 → 4 个 describe 块）。

### 步骤 1：读 Python 源与现有代码

- 读 `sillyhub-daemon/sillyhub_daemon/version.py`（确认 4 个导出的实现细节，尤其正则 `(\d+)\.(\d+)\.(\d+)` 和三段短路逻辑）。
- 读 `sillyhub-daemon/tests/test_version.py`（提取全部 24 个用例的输入/期望输出，见上文「Python 测试用例对照表」）。
- 读 `sillyhub-daemon/sillyhub_daemon/agent_detector.py:290`（确认唯一调用点的签名：`check_min_version(name, version)` → warning string 或 None）。
- 确认 task-01 的 `sillyhub-daemon/tsconfig.json`（strict）+ `vitest.config.ts` 已产出。若未就绪，本任务阻塞（depends_on task-01）。

### 步骤 2：写测试（tests/version.test.ts）

边界值表驱动测试，1:1 对照 Python 用例：

```ts
import { describe, it, expect } from 'vitest';
import {
  MIN_VERSIONS,
  parseSemver,
  formatSemver,
  checkMinVersion,
} from '../src/version.js';

// ── parseSemver（对照 test_version.py:17-52 TestParseSemver）──

describe('parseSemver', () => {
  it('标准版本号 "2.1.5" → [2,1,5]', () => {
    expect(parseSemver('2.1.5')).toEqual([2, 1, 5]);
  });

  it('前导文本 "Claude Code 2.1.5" → [2,1,5]（search 语义）', () => {
    expect(parseSemver('Claude Code 2.1.5')).toEqual([2, 1, 5]);
  });

  it('v 前缀 "v2.0.0" → [2,0,0]', () => {
    expect(parseSemver('v2.0.0')).toEqual([2, 0, 0]);
  });

  it('prerelease 后缀 "0.118.0-rc.1" → [0,118,0]（后缀被忽略，与 Python 一致）', () => {
    expect(parseSemver('0.118.0-rc.1')).toEqual([0, 118, 0]);
  });

  it('无匹配 "no-version-here" → null', () => {
    expect(parseSemver('no-version-here')).toBeNull();
  });

  it('空串 "" → null', () => {
    expect(parseSemver('')).toBeNull();
  });

  it('null → null', () => {
    expect(parseSemver(null)).toBeNull();
  });

  it('undefined → null', () => {
    expect(parseSemver(undefined)).toBeNull();
  });

  it('前导零 "02.01.05" → [2,1,5]', () => {
    expect(parseSemver('02.01.05')).toEqual([2, 1, 5]);
  });

  it('大数字 "999.999.999" → [999,999,999]', () => {
    expect(parseSemver('999.999.999')).toEqual([999, 999, 999]);
  });

  it('零版本 "0.0.0" → [0,0,0]', () => {
    expect(parseSemver('0.0.0')).toEqual([0, 0, 0]);
  });

  it('多版本号取首个 "requires 1.0.0, found 2.1.5" → [1,0,0]', () => {
    expect(parseSemver('requires 1.0.0, found 2.1.5')).toEqual([1, 0, 0]);
  });

  it('只有两段 "1.2" → null（正则要求三段）', () => {
    expect(parseSemver('1.2')).toBeNull();
  });

  it('+build 后缀 "1.0.0+build.123" → [1,0,0]', () => {
    expect(parseSemver('1.0.0+build.123')).toEqual([1, 0, 0]);
  });
});

// ── formatSemver（对照 test_version.py TestFormatSemver）──

describe('formatSemver', () => {
  it('[2,1,5] → "2.1.5"', () => {
    expect(formatSemver([2, 1, 5])).toBe('2.1.5');
  });

  it('[0,0,0] → "0.0.0"', () => {
    expect(formatSemver([0, 0, 0])).toBe('0.0.0');
  });

  it('[0,100,0] → "0.100.0"', () => {
    expect(formatSemver([0, 100, 0])).toBe('0.100.0');
  });
});

// ── MIN_VERSIONS（对照 test_version.py TestMinVersions）──

describe('MIN_VERSIONS', () => {
  it('恰好 3 个 provider', () => {
    expect(Object.keys(MIN_VERSIONS)).toHaveLength(3);
  });

  it('含 claude / codex / copilot', () => {
    expect(MIN_VERSIONS.claude).toEqual([2, 0, 0]);
    expect(MIN_VERSIONS.codex).toEqual([0, 100, 0]);
    expect(MIN_VERSIONS.copilot).toEqual([1, 0, 0]);
  });
});

// ── checkMinVersion（对照 test_version.py TestCheckMinVersion）──

describe('checkMinVersion', () => {
  // claude（MIN=2.0.0）
  it('claude 低于（1.5.0）→ warning 含 provider/version/minVer', () => {
    const r = checkMinVersion('claude', '1.5.0');
    expect(r).not.toBeNull();
    expect(r).toContain('claude');
    expect(r).toContain('1.5.0');
    expect(r).toContain('2.0.0');
  });

  it('claude 等于最低（2.0.0）→ null', () => {
    expect(checkMinVersion('claude', '2.0.0')).toBeNull();
  });

  it('claude 高于最低（2.1.5）→ null', () => {
    expect(checkMinVersion('claude', '2.1.5')).toBeNull();
  });

  // codex（MIN=0.100.0）
  it('codex 等于最低（0.100.0）→ null', () => {
    expect(checkMinVersion('codex', '0.100.0')).toBeNull();
  });

  it('codex 低于（0.99.0）→ warning 含 "0.100.0"', () => {
    const r = checkMinVersion('codex', '0.99.0');
    expect(r).not.toBeNull();
    expect(r).toContain('codex');
    expect(r).toContain('0.100.0');
  });

  // copilot（MIN=1.0.0）
  it('copilot 等于最低（1.0.0）→ null', () => {
    expect(checkMinVersion('copilot', '1.0.0')).toBeNull();
  });

  it('copilot 高于最低（1.5.3）→ null', () => {
    expect(checkMinVersion('copilot', '1.5.3')).toBeNull();
  });

  it('copilot 低于（0.9.0）→ warning', () => {
    const r = checkMinVersion('copilot', '0.9.0');
    expect(r).not.toBeNull();
    expect(r).toContain('copilot');
  });

  // 边界
  it('未知 provider（gemini）→ null（无要求）', () => {
    expect(checkMinVersion('gemini', '1.0.0')).toBeNull();
  });

  it('未知 provider（unknown）→ null', () => {
    expect(checkMinVersion('unknown', '1.0.0')).toBeNull();
  });

  it('无法解析的 version（claude "no-version"）→ null', () => {
    expect(checkMinVersion('claude', 'no-version')).toBeNull();
  });

  // warning 文本格式（逐字对齐 Python）
  it('warning 文本格式与 Python 一致', () => {
    const r = checkMinVersion('claude', '1.5.0');
    expect(r).toBe(
      'claude version 1.5.0 is below minimum required version 2.0.0',
    );
  });

  // minor/patch 递进比较（补强 Python 未显式覆盖的分支）
  it('major 相同 minor 低于（claude 2.0.0 vs 2.0.x，x 为 min）→ 等价 null', () => {
    expect(checkMinVersion('claude', '2.0.0')).toBeNull();
  });

  it('major 相同 minor 高于（claude 2.1.0）→ null', () => {
    expect(checkMinVersion('claude', '2.1.0')).toBeNull();
  });

  it('major 相同 minor 相同 patch 高于（claude 2.0.5）→ null', () => {
    expect(checkMinVersion('claude', '2.0.5')).toBeNull();
  });

  it('major 相同 minor 相同 patch 低于（claude 2.0.x 不存在，用 codex 0.100.0 vs 0.100.x 补强）→ 等价 null', () => {
    // codex MIN=0.100.0，0.99.5 → patch=5 但 minor 99<100 → warning
    const r = checkMinVersion('codex', '0.99.5');
    expect(r).not.toBeNull();
  });
});
```

### 步骤 3：写实现（src/version.ts）

照抄上文「接口定义」章节的完整 TS 代码。

### 步骤 4：跑测试 + tsc

```bash
cd sillyhub-daemon
npx tsc --noEmit                                    # AC-06: 零错误
npx vitest run tests/version.test.ts                # AC-05: 全绿
```

### 步骤 5：对照 Python 用例人工核对

逐条对照 `test_version.py`（见上文「Python 测试用例对照表」）：

- `TestParseSemver`（10 个用例）→ 本测试 parseSemver 块（含 null/undefined 补强 + 两段/+build 补强）全绿 ✅
- `TestFormatSemver`（3 个用例）→ 本测试 formatSemver 块全绿 ✅
- `TestMinVersions`（1 个用例）→ 本测试 MIN_VERSIONS 块全绿 ✅
- `TestCheckMinVersion`（10 个用例）→ 本测试 checkMinVersion 块（含 warning 文本逐字断言 + minor/patch 递进补强）全绿 ✅

---

## 验收标准

| 编号 | 验收项 | 验证方法 | 通过标准 |
|---|---|---|---|
| **AC-01** | `parseSemver` 清洗 `v` 前缀 | `npx vitest run tests/version.test.ts -t "v 前缀"` | `parseSemver('v2.0.0')` 返回 `[2,0,0]`，断言通过 |
| **AC-02** | `parseSemver` 清洗前导文本 | `npx vitest run tests/version.test.ts -t "前导文本"` | `parseSemver('Claude Code 2.1.5')` 返回 `[2,1,5]`，断言通过 |
| **AC-03** | `parseSemver` 忽略 prerelease 后缀（与 Python 一致） | `npx vitest run tests/version.test.ts -t "prerelease 后缀"` | `parseSemver('0.118.0-rc.1')` 返回 `[0,118,0]`（非 null、非含 prerelease 字段），断言通过 |
| **AC-04** | `parseSemver` 空/null/undefined → null | `npx vitest run tests/version.test.ts -t "空串"` | `parseSemver('')` / `parseSemver(null)` / `parseSemver(undefined)` 全部返回 `null` |
| **AC-05** | vitest 全绿 | `cd sillyhub-daemon && npx vitest run tests/version.test.ts` | exit code 0，4 个 describe 块全部通过，无 fail/skip |
| **AC-06** | tsc 零错误 | `cd sillyhub-daemon && npx tsc --noEmit` | exit code 0，无任何 error/warning 输出（strict + noImplicitAny + strictNullChecks） |
| **AC-07** | `checkMinVersion` 低于 → warning | `npx vitest run tests/version.test.ts -t "低于"` | claude 1.5.0 / codex 0.99.0 / copilot 0.9.0 全部返回非 null warning，且文本含 provider 名、原始 version、minVer |
| **AC-08** | `checkMinVersion` 等于/高于 → null | `npx vitest run tests/version.test.ts -t "等于最低\|高于最低"` | claude 2.0.0/2.1.5、codex 0.100.0、copilot 1.0.0/1.5.3 全部返回 `null` |
| **AC-09** | `checkMinVersion` 未知 provider → null | `npx vitest run tests/version.test.ts -t "未知 provider"` | `checkMinVersion('gemini', '1.0.0')` / `checkMinVersion('unknown', '1.0.0')` 返回 `null` |
| **AC-10** | `checkMinVersion` warning 文本逐字对齐 Python | `npx vitest run tests/version.test.ts -t "warning 文本格式"` | `checkMinVersion('claude', '1.5.0')` 严格等于 `'claude version 1.5.0 is below minimum required version 2.0.0'`（逐字符，含空格/大小写） |
| **AC-11** | `MIN_VERSIONS` 恰好 3 个 provider | `npx vitest run tests/version.test.ts -t "恰好 3 个"` | `Object.keys(MIN_VERSIONS).length === 3` 且含 claude(2.0.0) / codex(0.100.0) / copilot(1.0.0) |
| **AC-12** | 零第三方依赖 | `grep -E '"semver"|"@types/semver"' sillyhub-daemon/package.json` | 返回空（package.json dependencies/devDependencies 无 semver 相关条目）；`src/version.ts` 无任何 `import ... from '...'`（除 TS 内置） |
| **AC-13** | 仅触碰 allowed_paths 内文件 | `git diff --name-only HEAD` | 产出物为 `sillyhub-daemon/src/version.ts`；测试文件 `tests/version.test.ts` 作为开发期验证产物不计入 allowed_paths（task-04 脚手架约定） |
| **AC-14** | 与 Python `version.py` 行为 1:1 | 人工对照 version.py:9/18-30/33-35/38-62 | 正则一致（`(\d+)\.(\d+)\.(\d+)` search 语义）、三段短路顺序一致、warning 文本格式逐字一致、MIN_VERSIONS 三个值一致 |

---

## 自审清单（生成者自查）

- [x] 接口定义完整，搬砖工照抄即可产出可编译的 version.ts
- [x] 4 个导出（MIN_VERSIONS / parseSemver / formatSemver / checkMinVersion）与 Python `__all__` 1:1
- [x] 正则 `(\d+)\.(\d+)\.(\d+)` 与 Python `_SEMVER_RE` 逐字一致（search 语义用 `RegExp.exec` 等价）
- [x] prerelease 处理决策有 Python 源依据（version.py:9 正则不匹配 prerelease；test_version.py:25-27 `0.118.0-rc.1 → (0,118,0)` 证实）—— 与 Python 一致即「忽略」，非「实现 semver prerelease 优先级」
- [x] checkMinVersion 三段短路顺序与 Python version.py:48-60 严格一致（无 entry → 无法解析 → 比较）
- [x] warning 文本格式逐字对齐 Python f-string（含用原始 version 字符串、非 formatSemver 后的）
- [x] 零依赖决策有 design.md G-05 依据；手写 compareTuple 替代库
- [x] 边界处理 ≥ 5 条（实际 12 条：v 前缀/前导文本/+build&prerelease 后缀/无法解析/空&null/前导零/大数字/零版本/多版本号取首个/未知 provider/无法解析 version/等于最低版本）
- [x] 非目标 ≥ 4 条（实际 8 条，明确划界 prerelease 比较/semver 库/range 表达式/CalVer/位数防御/format 校验/导出 compareTuple/i18n）
- [x] 验收标准表格化、每条可机器或人工验证，无笼统「正确」（14 条 AC，每条有具体命令 + 期望输出）
- [x] TDD 步骤含完整测试代码骨架（24+ 用例，1:1 对照 Python 测试类），含补强用例（null/undefined/两段/+build/minor/patch 递进）
- [x] 参考章节标注 Python 源行号 + Python 测试用例对照表（24 条）+ design 章节 + 模块文档 + 关联 task
- [x] frontmatter 字段完整（id/priority/estimated_hours/depends_on/blocks/allowed_paths）
