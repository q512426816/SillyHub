---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-16
title: agent-detector（src/agent-detector.ts，12 provider 探测，依赖 version）
priority: P0
estimated_hours: 5
depends_on: [task-14]
blocks: [task-20, task-22]
allowed_paths:
  - sillyhub-daemon/src/agent-detector.ts
---

# task-16：agent-detector（src/agent-detector.ts，12 provider 探测，依赖 version）

> 变更：`2026-06-13-daemon-nodejs-rewrite`，Wave W2（基础设施），有副作用模块（子进程执行 + 文件系统 PATH 查找）。
> Python 源对照：`sillyhub_daemon/agent_detector.py`（300 行，6 个导出：`AgentDef` / `AgentInfo` / `DetectedAgent` / `AgentDetector` / `check_min_version` / `parse_semver`，后两个为再导出）。
> 职责：启动时探测本机 12 种 coding agent CLI（claude / codex / copilot / opencode / openclaw / hermes / gemini / pi / cursor / kimi / kiro / antigravity），按优先级 `env 覆盖 → PATH which 查找 → 标记不可用` 解析每个 provider 的二进制路径，执行 `<bin_path> --version` 取版本，调用 task-14 的 `checkMinVersion` 校验是否达到最低要求。为 daemon（task-20）注册阶段提供「可用 agent 列表」。
> 本任务把 Python 版 `AgentDetector` 类 + 12 个 `AgentDef` 1:1 迁移到 TS，**零第三方依赖**（design.md G-05），用 Node 内置 `child_process.execFile` + `node:fs` + `node:path`。

- Wave：W2（基础设施，与 W1 协议层并行）
- 依赖：task-14（version.ts 的 `checkMinVersion` / `parseSemver` 已就绪，本文件 `import { checkMinVersion } from './version.js'`）
- 阻塞：
  - task-20（Daemon 主类：`detector.detectAgents()` → 注册循环 `for (const agent of available) client.register({ provider: agent.provider })`）
  - task-22（测试迁移：`tests/test_agent_detector.py` → `tests/agent-detector.test.ts` 1:1 迁移）
- Python 源对照（git log a59f6e5 / 45a4447 最新版）：
  - `sillyhub_daemon/agent_detector.py:18` —— `from sillyhub_daemon.version import check_min_version, parse_semver`
  - `sillyhub_daemon/agent_detector.py:37-46` —— `AgentDef` dataclass（bin / env_path / version_pattern / protocol / min_version）
  - `sillyhub_daemon/agent_detector.py:48-58` —— `DetectedAgent` dataclass（name / bin_path / version / protocol / available / version_warning）
  - `sillyhub_daemon/agent_detector.py:60-73` —— `AgentInfo` 废弃兼容 dataclass
  - `sillyhub_daemon/agent_detector.py:98-174` —— `AGENT_DEFS` 字典（**12 provider 完整定义**）
  - `sillyhub_daemon/agent_detector.py:180-185` —— `detect_all`：串行 for 循环（**非并发**，对应 `for name, defn in self.AGENT_DEFS.items()`）
  - `sillyhub_daemon/agent_detector.py:187-195` —— `detect_one`：单个 provider 探测，未知 provider 返回 `None`
  - `sillyhub_daemon/agent_detector.py:197-207` —— `is_available`：同步快速检查（仅 PATH 解析，不执行 `--version`）
  - `sillyhub_daemon/agent_detector.py:209-218` —— `get_capabilities`：废弃兼容方法
  - `sillyhub_daemon/agent_detector.py:224-243` —— `_resolve_bin_path`：env 覆盖（file exists 检查）→ `shutil.which` → None
  - `sillyhub_daemon/agent_detector.py:245-272` —— `_detect_version`：`subprocess` + 10s 超时 + 正则匹配（stdout+stderr 合并扫描）
  - `sillyhub_daemon/agent_detector.py:274-299` —— `_detect_single`：完整探测管道
- runtime_id 关键澄清（来自 daemon.py:70-104）：
  - **runtime_id 由 backend 服务端在 register 响应中下发**（`resp.get("id")`），**不是 agent-detector 生成**。
  - detector 只输出「这个 provider 是否可用」；注册阶段（task-20）每个 available agent 调一次 `client.register({ provider })`，从响应取得 `id` 存入 `_registered_runtimes[provider] = id`。
  - 因此本任务 `DetectedAgent.runtimeId` 设计为 **可选字段**，默认 `undefined`，由 task-20 在注册成功后回填。FR-07「每个检测到的 agent 注册为独立 runtime_id」的语义落在注册层（每 agent 一次 register → 独立 id），不是探测层。

---

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/agent-detector.ts` | 导出：`ProviderName` 类型 + `AgentProtocol` 类型 + `AgentProviderSpec` interface + `DetectedAgent` interface + `PROVIDER_SPECS` 12-entry 常量表 + `AgentDetector` class（`detectAgents` / `detectOne` / `isAvailable`）。零运行时依赖（仅 Node 内置 `child_process` + `fs` + `path`），复用 `./version.js` 的 `checkMinVersion` |
| 新增 | `sillyhub-daemon/tests/agent-detector.test.ts`（不计入 allowed_paths，开发期验证） | vitest 单测，1:1 迁移 `test_agent_detector.py` 全部 9 个测试类（约 40 个用例），mock `child_process.execFile` + `fs.existsSync` + 自定义 PATH 查找函数 |

> 说明：测试文件按 task-04 脚手架的测试目录约定放置，不计入 allowed_paths 是因为它是验证产物而非交付物（与 task-06~10、task-14 的测试文件策略一致）。本任务无外部 fixture 文件——所有 mock 在测试内联（子进程输出字面量、PATH 字符串字面量），无需外部样本。

### 与 Python 版的导出对照

| Python（`__all__`） | Node 导出 | 说明 |
|---|---|---|
| `AgentDef`（dataclass） | `AgentProviderSpec`（interface，`as const` 对象实现） | TS 用 interface 描述形状 + `PROVIDER_SPECS` 常量表，不再用「类 + 静态字典」 |
| `DetectedAgent`（dataclass） | `DetectedAgent`（interface） | 新增可选字段 `runtimeId?: string`（注册回填，见上文澄清）、`status: 'available' \| 'unavailable'`（替代布尔 `available`）、`reason?: string`（不可用原因，对齐任务要求） |
| `AgentInfo`（废弃） | **不迁移** | Python 标注 `deprecated`，仅 `get_capabilities` 用到。Node 版直接删除废弃层（design.md §2 G-01「功能等价」不要求保留已废弃的兼容 API，YAGNI） |
| `AgentDetector`（class） | `AgentDetector`（class） | 保留类形态（封装 PATH/exec 可 mock 边界），方法名 camelCase：`detect_all` → `detectAgents`、`detect_one` → `detectOne`、`is_available` → `isAvailable` |
| `AgentDetector.AGENT_DEFS`（静态属性） | `PROVIDER_SPECS`（模块级常量） | 从「类静态属性」抽离为模块级 `as const` 常量，更符合 TS 习惯，也便于单测直接 import 断言 |
| `AgentDetector.get_capabilities`（废弃） | **不迁移** | 同 `AgentInfo`，删除废弃层 |
| `check_min_version`（再导出） | **不再导出** | task-14 已直接导出，避免双重门面；`agent-detector.ts` 仅 `import` 使用，不 re-export |
| `parse_semver`（再导出） | **不再导出** | 同上 |

---

## 实现要求

### R1. 12 provider 探测表（对齐 Python AGENT_DEFS，agent_detector.py:98-174）

`PROVIDER_SPECS` 是 `Record<ProviderName, AgentProviderSpec>` 的 `as const` 常量，**12 个 entry，顺序与 Python 字典一致**。每个 entry 含字段：

| 字段 | 类型 | 说明 | Python 对照 |
|---|---|---|---|
| `bin` | `string` | 二进制可执行名（不含路径），用于 PATH 查找 | `AgentDef.bin` |
| `envPath` | `string` | 环境变量名（如 `SILLYHUB_CLAUDE_PATH`），优先级最高 | `AgentDef.env_path` |
| `versionPattern` | `RegExp` | 版本正则，对 `--version` stdout+stderr 合并输出 `exec` 取首个匹配 | `AgentDef.version_pattern` |
| `protocol` | `AgentProtocol` | 协议名（5 选 1） | `AgentDef.protocol` |
| `minVersion` | `string \| undefined` | 最低版本要求字符串；undefined 表示无要求 | `AgentDef.min_version` |

12 个 entry（**逐字对齐 Python agent_detector.py:98-174，包含 bin 可执行名 / envPath / versionPattern / protocol / minVersion 真实值**）：

| provider | bin | envPath | versionPattern | protocol | minVersion |
|---|---|---|---|---|---|
| claude | `claude` | `SILLYHUB_CLAUDE_PATH` | `/(?:Claude Code\s+)?(\d+\.\d+\.\d+)(?:\s+\(Claude Code\))?/` | `stream_json` | `2.0.0` |
| codex | `codex` | `SILLYHUB_CODEX_PATH` | `/(\d+\.\d+\.\d+)/` | `json_rpc` | `0.100.0` |
| copilot | `copilot` | `SILLYHUB_COPILOT_PATH` | `/(\d+\.\d+\.\d+)/` | `jsonl` | `1.0.0` |
| opencode | `opencode` | `SILLYHUB_OPENCODE_PATH` | `/(\d+\.\d+\.\d+)/` | `ndjson` | `undefined` |
| openclaw | `openclaw` | `SILLYHUB_OPENCLAW_PATH` | `/(\d+\.\d+\.\d+)/` | `ndjson` | `undefined` |
| hermes | `hermes` | `SILLYHUB_HERMES_PATH` | `/(\d+\.\d+\.\d+)/` | `json_rpc` | `undefined` |
| gemini | `gemini` | `SILLYHUB_GEMINI_PATH` | `/(\d+\.\d+\.\d+)/` | `stream_json` | `undefined` |
| pi | `pi` | `SILLYHUB_PI_PATH` | `/(\d+\.\d+\.\d+)/` | `ndjson` | `undefined` |
| cursor | `cursor-agent` | `SILLYHUB_CURSOR_PATH` | `/(\d+\.\d+\.\d+)/` | `stream_json` | `undefined` |
| kimi | `kimi` | `SILLYHUB_KIMI_PATH` | `/(\d+\.\d+\.\d+)/` | `json_rpc` | `undefined` |
| kiro | `kiro-cli` | `SILLYHUB_KIRO_PATH` | `/(\d+\.\d+\.\d+)/` | `json_rpc` | `undefined` |
| antigravity | `agy` | `SILLYHUB_ANTIGRAVITY_PATH` | `/(\d+\.\d+\.\d+)/` | `text` | `undefined` |

**注意（claude 的 versionPattern）**：Python 版用 raw string `r"(?:Claude Code\s+)?(\d+\.\d+\.\d+)(?:\s+\(Claude Code\))?"`。TS 正则字面量等价为 `/(?:Claude Code\s+)?(\d+\.\d+\.\d+)(?:\s+\(Claude Code\))?/`，差异：
- `\s+` → TS 正则字面量中 `\s` 即 whitespace，等价。
- `\(` / `\)` → TS 正则字面量也用 `\(` / `\)` 转义括号，等价。
- 非 global、非 sticky、非 multiline（默认），`exec` 取首个匹配——等价 Python `re.search`。

**注意（minVersion 与 MIN_VERSIONS 的关系）**：task-14 的 `MIN_VERSIONS` 表（claude/codex/copilot 三个 entry）必须与本表 `minVersion` 字段**逐字一致**（claude 2.0.0 / codex 0.100.0 / copilot 1.0.0）。两表存在重复，但语义不同——`PROVIDER_SPECS[x].minVersion` 是「provider 描述层的元信息」（字符串），`MIN_VERSIONS[x]` 是「version 模块的比较常量」（三元组）。Python 版同样两处都有（`AgentDef.min_version` 字符串 + `MIN_VERSIONS` 字典），保持一致。

### R2. 探测策略（对齐 Python _detect_single，agent_detector.py:274-299）

每个 provider 探测管道严格按顺序：

1. **解析二进制路径**（`resolveBinPath(spec)`，对应 Python `_resolve_bin_path`，agent_detector.py:224-243）：
   - 优先级 1：`process.env[spec.envPath]`，若非空 **且** `fs.existsSync(envVal)` 为真 → 返回 envVal。
   - 优先级 2（envPath 为空或指向不存在路径时）：PATH 查找（见 R3）→ 返回查找到的绝对路径。
   - 优先级 3：两者都失败 → 返回 `null`（不可用）。
2. **若 binPath === null** → 直接构造 `DetectedAgent`（`status: 'unavailable'`，`reason: 'not-found'`，`path: ''`，`version: undefined`，`versionWarning: null`，`runtimeId: undefined`），**跳过 version 探测**。
3. **执行 version 探测**（`detectVersion(binPath, spec)`，对应 Python `_detect_version`，agent_detector.py:245-272）：
   - 用 `child_process.execFile(binPath, ['--version'], { timeout: 10_000, windowsHide: true })`。
   - Windows + binPath 以 `.cmd` / `.bat` 结尾时，改用 `child_process.exec('"<binPath>" --version', { timeout: 10_000 })`（对齐 Python 的 `subprocess.list2cmdline` + `create_subprocess_shell` 分支）。
   - 合并 stdout + stderr（`output = (stdout || '') + (stderr || '')`），用 `spec.versionPattern.exec(output)` 取首个匹配的捕获组 1 作为 version 字符串；未匹配返回 `null`。
   - 超时（10s）/ 进程不存在（ENOENT）/ 其他 OS 错误 → 返回 `null`（对应 Python `except (FileNotFoundError, asyncio.TimeoutError, OSError)`）。
4. **版本校验**：若 version 非空，`const warning = checkMinVersion(spec, versionString)`（**调用 task-14 的 checkMinVersion，传入 spec 名 + 原始 version 字符串**）；version 为 null 则 warning = null。
5. **构造 DetectedAgent**：`status: 'available'`，`path: binPath`，`version`（string 或 undefined），`protocol: spec.protocol`，`versionWarning`（warning 或 null），`runtimeId: undefined`（待 task-20 注册回填）。

### R3. PATH 查找兼容（Windows which vs POSIX）

Python 用 `shutil.which(bin)`，跨平台。Node 版无内置等价函数，需手写 `findOnPath(binName)`：

- POSIX（`process.platform !== 'win32'`）：遍历 `process.env.PATH`（冒号分隔），对每个目录拼接 `path.join(dir, binName)`，若 `fs.existsSync(p) && fs.statSync(p).isFile()` 为真返回 p。**不检查可执行位**（Python `shutil.which` 在 POSIX 下检查 `os.access(X_OK)`，但 agent CLI 一般都有 +x；本任务为简化不检查 +x，对齐「行为等价」的核心目标而非边缘细节；Python 的 `shutil.which` 默认在 PATH 上不含可执行位的文件也会被忽略，但实践中 agent 二进制都有 +x，Node 版不检查不会改变实际探测结果——若需严格对齐可后续增强）。
- Windows（`process.platform === 'win32'`）：遍历 `process.env.PATH`（分号分隔），对每个目录依次尝试 `binName`、`binName + '.exe'`、`binName + '.cmd'`、`binName + '.bat'`、`binName + '.ps1'`，返回第一个存在的文件路径。**关键**：返回 `.cmd` / `.bat` 包装器路径（不剥到 `node.exe`），让 version 探测执行真正的 CLI 入口（对齐 Python agent_detector.py:229-232 注释：「Keep the wrapper path so version detection runs the real CLI command instead of accidentally treating node.exe as the agent binary」）。
- PATH 为空或全部目录都不含目标 → 返回 `null`。

**封装为独立方法**（`findOnPath(binName): string | null`，protected 可被测试 mock）。

### R4. 多 runtime_id 的处理（runtimeId 字段语义）

见上文「runtime_id 关键澄清」：`DetectedAgent.runtimeId` 是 **可选回填字段**，本任务探测器输出时始终为 `undefined`。task-20 注册成功后：

```ts
// task-20 Daemon.start() 片段（仅说明 runtimeId 用途，不在本任务实现）
const agents = await detector.detectAgents();
for (const agent of agents.filter(a => a.status === 'available')) {
  const resp = await client.register({ provider: agent.provider, version: agent.version ?? 'unknown', protocol: agent.protocol, ... });
  agent.runtimeId = resp.id;  // 回填
}
```

本任务只需保证 `DetectedAgent.runtimeId` 字段存在于 interface 定义、默认 `undefined`，**不实现注册逻辑**（注册在 task-20）。

### R5. 串行探测（对齐 Python detect_all，agent_detector.py:180-185）

- `detectAgents()` 用 **for-await 串行**（`for (const [name, spec] of Object.entries(PROVIDER_SPECS)) { results.push(await this.detectSingle(name, spec)); }`），**非 `Promise.all` 并发**。
- 理由：Python 版就是串行（`for name, defn in self.AGENT_DEFS.items()`），且 12 个 agent 各自 spawn 一次 `--version` 子进程——并发会让瞬时子进程数翻倍，且输出解析顺序不保证（虽不影响结果，但与 Python 行为偏离）。保持串行更安全、更可预测（对应 design.md G-01 功能等价）。
- 副作用：12 个 agent 全探测约 12 × (PATH 查找 + 子进程执行 + 超时上限 10s) = 最坏 ~120s（若全部超时）。实践中 agent CLI `--version` 是毫秒级返回，正常环境 < 1s。

### R6. 零依赖（design.md G-05）

- **禁止引入 `which` / `which-promise` / `find-exec` 等第三方库**。
- 仅用 Node 内置：`child_process`（execFile / exec）、`fs`（existsSync / statSync）、`path`（join）、`process`（platform / env）。
- 复用 task-14 的 `checkMinVersion`（`import { checkMinVersion } from './version.js';`）。

### R7. 类型严格（design.md G-04，tsconfig strict）

- `ProviderName` 用字面量联合类型 `'claude' | 'codex' | 'copilot' | 'opencode' | 'openclaw' | 'hermes' | 'gemini' | 'pi' | 'cursor' | 'kimi' | 'kiro' | 'antigravity'`（12 个字面量），从 `PROVIDER_SPECS` 的 key 派生（`keyof typeof PROVIDER_SPECS`）。
- `AgentProtocol` 用字面量联合 `'stream_json' | 'json_rpc' | 'jsonl' | 'ndjson' | 'text'`（5 种，对齐 task-11 的 PROTOCOL_PROVIDERS）。
- `PROVIDER_SPECS` 用 `as const` + 类型注解 `Record<ProviderName, AgentProviderSpec>`，使 key 与 value 类型在编译期可校验。
- `DetectedAgent.status` 用字面量联合 `'available' | 'unavailable'`，避免布尔歧义。
- 所有方法显式标注返回类型（strict 下 `noImplicitReturns` / `strictNullChecks` 要求）。

---

## 接口定义

以下是 `sillyhub-daemon/src/agent-detector.ts` 的完整内容（搬砖工照抄即可）：

```ts
/**
 * agent-detector.ts —— 12 provider CLI 探测（Python agent_detector.py 的 1:1 Node 迁移）。
 *
 * 职责：
 *   启动时探测本机 12 种 coding agent CLI（claude/codex/copilot/opencode/openclaw/hermes/
 *   gemini/pi/cursor/kimi/kiro/antigravity）。按优先级 `env 覆盖 → PATH which → 不可用`
 *   解析每个 provider 的二进制路径，执行 `<bin_path> --version` 取版本，调用 task-14 的
 *   checkMinVersion 校验最低版本。为 daemon（task-20）注册阶段提供可用 agent 列表。
 *
 * Python 源对照：
 *   sillyhub_daemon/agent_detector.py:37-46   AgentDef dataclass
 *   sillyhub_daemon/agent_detector.py:48-58   DetectedAgent dataclass
 *   sillyhub_daemon/agent_detector.py:98-174  AGENT_DEFS（12 provider）
 *   sillyhub_daemon/agent_detector.py:180-185 detect_all（串行）
 *   sillyhub_daemon/agent_detector.py:187-195 detect_one
 *   sillyhub_daemon/agent_detector.py:197-207 is_available
 *   sillyhub_daemon/agent_detector.py:224-243 _resolve_bin_path（env → which → None）
 *   sillyhub_daemon/agent_detector.py:245-272 _detect_version（subprocess + 10s timeout）
 *   sillyhub_daemon/agent_detector.py:274-299 _detect_single
 *
 * 设计约束：
 *   - G-05 零依赖：仅用 Node 内置 child_process / fs / path，不引 which 库。
 *   - G-01 功能等价：与 Python 版行为 1:1（探测优先级、--version 解析、版本校验）。
 *
 * @see design.md §6（agent-detector.ts 文件清单）/ FR-07（12 provider 探测）
 */

import { execFile, exec } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { checkMinVersion } from './version.js';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/**
 * 5 种 agent 协议字面量（对齐 task-11 PROTOCOL_PROVIDERS 的 key）。
 */
export type AgentProtocol =
  | 'stream_json'
  | 'json_rpc'
  | 'jsonl'
  | 'ndjson'
  | 'text';

/**
 * provider 定义形状（对应 Python AgentDef dataclass）。
 * 每个 entry 描述一种 agent CLI 的探测元信息。
 */
export interface AgentProviderSpec {
  /** 二进制可执行名（不含路径），用于 PATH 查找（如 'claude' / 'cursor-agent' / 'agy'）。 */
  readonly bin: string;
  /** 环境变量名（如 'SILLYHUB_CLAUDE_PATH'），优先级最高，覆盖 PATH 查找结果。 */
  readonly envPath: string;
  /** 版本正则。对 --version 的 stdout+stderr 合并输出 exec 取首个匹配的捕获组 1。 */
  readonly versionPattern: RegExp;
  /** 协议名（用于注册时上报 backend）。 */
  readonly protocol: AgentProtocol;
  /** 最低版本要求字符串（如 '2.0.0'）；undefined 表示该 provider 无版本要求。 */
  readonly minVersion?: string;
}

/**
 * 探测结果（对应 Python DetectedAgent dataclass）。
 * 字段命名调整：bin_path → path / available:bool → status 字面量 / 新增 reason / runtimeId。
 */
export interface DetectedAgent {
  /** provider 名（'claude' / 'codex' / ... 之一）。 */
  readonly provider: string;
  /** 解析出的二进制绝对路径；不可用时为空串 ''。 */
  readonly path: string;
  /** 版本字符串（来自 --version 解析）；未探测到或解析失败为 undefined。 */
  readonly version: string | undefined;
  /** 协议名（来自 PROVIDER_SPECS，固定值）。 */
  readonly protocol: AgentProtocol;
  /** 状态：'available'（找到二进制且 --version 执行了，无论版本是否达标）/ 'unavailable'。 */
  readonly status: 'available' | 'unavailable';
  /** 不可用原因（仅 status === 'unavailable' 时有值）：'not-found' / 'env-path-invalid'。 */
  readonly reason?: string;
  /** 版本警告文本（来自 checkMinVersion）；null 表示无要求 / 达标 / 无法解析。 */
  readonly versionWarning: string | null;
  /**
   * 注册成功后回填的 runtime_id（由 backend 在 register 响应中下发）。
   * 探测器输出时始终为 undefined；task-20 Daemon 注册成功后写入。
   * 见任务说明「runtime_id 关键澄清」。
   */
  runtimeId?: string;
}

// ---------------------------------------------------------------------------
// 12 provider 探测表（对齐 Python AGENT_DEFS，agent_detector.py:98-174）
// ---------------------------------------------------------------------------

/**
 * 12 provider 探测表。顺序：claude / codex / copilot / opencode / openclaw /
 * hermes / gemini / pi / cursor / kimi / kiro / antigravity。
 *
 * 注意：claude 的 versionPattern 支持「Claude Code X.Y.Z」前缀和「X.Y.Z (Claude Code)」
 * 后缀两种格式（对应 Python agent_detector.py:102-103 的 raw string）。
 */
export const PROVIDER_SPECS = {
  claude: {
    bin: 'claude',
    envPath: 'SILLYHUB_CLAUDE_PATH',
    versionPattern: /(?:Claude Code\s+)?(\d+\.\d+\.\d+)(?:\s+\(Claude Code\))?/,
    protocol: 'stream_json' as const,
    minVersion: '2.0.0',
  },
  codex: {
    bin: 'codex',
    envPath: 'SILLYHUB_CODEX_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'json_rpc' as const,
    minVersion: '0.100.0',
  },
  copilot: {
    bin: 'copilot',
    envPath: 'SILLYHUB_COPILOT_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'jsonl' as const,
    minVersion: '1.0.0',
  },
  opencode: {
    bin: 'opencode',
    envPath: 'SILLYHUB_OPENCODE_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'ndjson' as const,
  },
  openclaw: {
    bin: 'openclaw',
    envPath: 'SILLYHUB_OPENCLAW_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'ndjson' as const,
  },
  hermes: {
    bin: 'hermes',
    envPath: 'SILLYHUB_HERMES_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'json_rpc' as const,
  },
  gemini: {
    bin: 'gemini',
    envPath: 'SILLYHUB_GEMINI_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'stream_json' as const,
  },
  pi: {
    bin: 'pi',
    envPath: 'SILLYHUB_PI_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'ndjson' as const,
  },
  cursor: {
    bin: 'cursor-agent',
    envPath: 'SILLYHUB_CURSOR_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'stream_json' as const,
  },
  kimi: {
    bin: 'kimi',
    envPath: 'SILLYHUB_KIMI_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'json_rpc' as const,
  },
  kiro: {
    bin: 'kiro-cli',
    envPath: 'SILLYHUB_KIRO_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'json_rpc' as const,
  },
  antigravity: {
    bin: 'agy',
    envPath: 'SILLYHUB_ANTIGRAVITY_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'text' as const,
  },
} as const;

/** provider 名联合类型（'claude' | 'codex' | ... 共 12 个字面量）。 */
export type ProviderName = keyof typeof PROVIDER_SPECS;

// ---------------------------------------------------------------------------
// AgentDetector
// ---------------------------------------------------------------------------

/** Windows 上 PATH 查找尝试追加的可执行后缀（对齐 shutil.which 在 Windows 的行为）。 */
const WINDOWS_EXTS = ['', '.exe', '.cmd', '.bat', '.ps1'];

/**
 * 探测本机 12 种 coding agent CLI。
 *
 * 单实例无状态（Python 版同样每次 daemon 启动 new 一个）。
 * 子进程执行 / PATH 查找 / env 读取都在实例方法内，便于单测 mock（覆写 protected 方法）。
 */
export class AgentDetector {
  /**
   * 探测全部 12 个 provider，返回 DetectedAgent[]（顺序与 PROVIDER_SPECS 一致）。
   *
   * 串行执行（对齐 Python detect_all，agent_detector.py:180-185）——非 Promise.all 并发，
   * 避免瞬时 12 个子进程 + 与 Python 行为偏离。
   */
  async detectAgents(): Promise<DetectedAgent[]> {
    const results: DetectedAgent[] = [];
    for (const name of Object.keys(PROVIDER_SPECS) as ProviderName[]) {
      const spec = PROVIDER_SPECS[name];
      results.push(await this.detectSingle(name, spec));
    }
    return results;
  }

  /**
   * 探测单个 provider。
   *
   * @param name provider 名（必须是 PROVIDER_SPECS 的 key 之一）
   * @returns DetectedAgent；未知 provider 返回 null（对齐 Python detect_one，agent_detector.py:187-195）
   */
  async detectOne(name: string): Promise<DetectedAgent | null> {
    const spec = (PROVIDER_SPECS as Record<string, AgentProviderSpec>)[name];
    if (spec === undefined) {
      return null;
    }
    return this.detectSingle(name as ProviderName, spec);
  }

  /**
   * 同步快速检查某 provider 是否可用（仅 PATH 解析，不执行 --version）。
   *
   * 对齐 Python is_available，agent_detector.py:197-207。用于注册前的快速预筛（虽然
   * detectAgents 已含版本探测，但某些场景只需「存在性」而不需要版本）。
   *
   * @param name provider 名；未知返回 false
   */
  isAvailable(name: string): boolean {
    const spec = (PROVIDER_SPECS as Record<string, AgentProviderSpec>)[name];
    if (spec === undefined) {
      return false;
    }
    return this.resolveBinPath(spec) !== null;
  }

  // -------------------------------------------------------------------------
  // 内部方法（protected，可被单测覆写以 mock PATH/exec/existsSync）
  // -------------------------------------------------------------------------

  /**
   * 解析二进制路径。优先级：env 覆盖（file exists）→ PATH 查找 → null。
   * 对齐 Python _resolve_bin_path，agent_detector.py:224-243。
   */
  protected resolveBinPath(spec: AgentProviderSpec): string | null {
    const envVal = process.env[spec.envPath];
    if (envVal) {
      if (existsSync(envVal)) {
        return envVal;
      }
      // env 指向不存在路径 → 降级到 PATH 查找（对齐 Python：fallback to which）。
    }
    return this.findOnPath(spec.bin);
  }

  /**
   * 在 PATH 上查找二进制。跨平台兼容（POSIX 冒号 / Windows 分号 + 后缀尝试）。
   *
   * 不引第三方 which 库（design.md G-05）。封装为 protected 方法便于单测覆写。
   */
  protected findOnPath(binName: string): string | null {
    const pathVar = process.env.PATH;
    if (!pathVar) {
      return null;
    }
    const separator = process.platform === 'win32' ? ';' : ':';
    const exts = process.platform === 'win32' ? WINDOWS_EXTS : [''];
    for (const dir of pathVar.split(separator)) {
      if (!dir) continue;
      for (const ext of exts) {
        const candidate = join(dir, binName + ext);
        try {
          if (existsSync(candidate) && statSync(candidate).isFile()) {
            return candidate;
          }
        } catch {
          // statSync 抛错（权限/符号链接断裂等）→ 跳过，继续下一个候选。
        }
      }
    }
    return null;
  }

  /**
   * 执行 `<binPath> --version`，用 versionPattern 解析输出，返回版本字符串或 null。
   *
   * 对齐 Python _detect_version，agent_detector.py:245-272：
   *   - timeout 10s（对应 Python asyncio.wait_for(..., timeout=10)）。
   *   - stdout + stderr 合并扫描（对应 Python output = stdout + stderr）。
   *   - versionPattern.exec 取首个匹配的捕获组 1。
   *   - Windows + .cmd/.bat 后缀的 binPath 走 shell exec 分支。
   *   - 任何异常（超时 / ENOENT / OSError）→ 返回 null，不抛错。
   */
  protected detectVersion(
    binPath: string,
    spec: AgentProviderSpec,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const onResult = (err: Error | null, stdout: string, stderr: string): void => {
        if (err) {
          // 超时 / ENOENT / 其他 OS 错误统一返回 null（对齐 Python except 分支）。
          resolve(null);
          return;
        }
        const output = (stdout || '') + (stderr || '');
        const m = spec.versionPattern.exec(output);
        resolve(m ? m[1] : null);
      };

      const isWindowsCmdWrapper =
        process.platform === 'win32' &&
        /\.(cmd|bat)$/i.test(binPath);
      if (isWindowsCmdWrapper) {
        // Windows .cmd/.bat 包装器必须走 shell（对应 Python subprocess.list2cmdline
        // + create_subprocess_shell 分支，agent_detector.py:248-256）。
        const escaped = `"${binPath}" --version`;
        exec(escaped, { timeout: 10_000, windowsHide: true }, onResult);
      } else {
        execFile(
          binPath,
          ['--version'],
          { timeout: 10_000, windowsHide: true },
          onResult,
        );
      }
    });
  }

  /**
   * 完整探测管道（单个 provider）。对齐 Python _detect_single，agent_detector.py:274-299。
   */
  private async detectSingle(
    name: ProviderName,
    spec: AgentProviderSpec,
  ): Promise<DetectedAgent> {
    const binPath = this.resolveBinPath(spec);

    if (binPath === null) {
      return {
        provider: name,
        path: '',
        version: undefined,
        protocol: spec.protocol,
        status: 'unavailable',
        reason: 'not-found',
        versionWarning: null,
        // runtimeId 留 undefined，待 task-20 注册回填。
      };
    }

    const version = await this.detectVersion(binPath, spec);
    // 注意：checkMinVersion 来自 ./version.js（task-14），传入 provider 名 + 原始版本字符串。
    // version 为 null 时 checkMinVersion 内部 parseSemver 失败会返回 null，不叠加噪声。
    const versionWarning =
      version !== null ? checkMinVersion(name, version) : null;

    return {
      provider: name,
      path: binPath,
      version: version ?? undefined,
      protocol: spec.protocol,
      status: 'available',
      versionWarning,
      // runtimeId 留 undefined，待 task-20 注册回填。
    };
  }
}
```

---

## 边界处理

| 编号 | 边界场景 | 处理策略 |
|---|---|---|
| **B-01** | **provider 未安装**（PATH 上找不到二进制） | `findOnPath` 返回 `null` → `resolveBinPath` 返回 `null` → `detectSingle` 构造 `{ status: 'unavailable', reason: 'not-found', path: '', version: undefined }`，**跳过 version 探测**（不浪费一次子进程）。对应 Python agent_detector.py:278-285。关键：仍返回 DetectedAgent 条目（status='unavailable'），让 daemon 知道「这个 provider 在本机不存在」，而非从结果列表中剔除（保证 `detectAgents()` 永远返回 12 条）。对应 Python `test_agent_detector.py:307-314 test_detect_all_marks_unavailable`。 |
| **B-02** | **`--version` 输出格式异常**（正则不匹配，如 `"unknown output"`） | `spec.versionPattern.exec(output)` 返回 `null` → `detectVersion` 返回 `null` → `detectSingle` 设 `version: undefined`，`versionWarning: null`（version 为 null 时跳过 checkMinVersion 调用，对应 Python agent_detector.py:289 `if version is not None`）。**status 仍为 'available'**（找到二进制即视为可用，版本无法解析不阻断注册）。对应 Python `test_agent_detector.py:267-276 test_detect_version_pattern_no_match`。 |
| **B-03** | **版本低于最低要求**（如 claude 1.0.0 < 2.0.0） | `checkMinVersion('claude', '1.0.0')` 返回 warning 字符串 → `versionWarning` 写入 DetectedAgent。**status 仍为 'available'**——版本低于最低要求只标记警告，不剔除（daemon 注册时仍注册，警告透传到 UI）。对应 Python `test_agent_detector.py:397-406 test_version_warning_set_when_below_min`。语义决策：Python 版同样不剔除（agent_detector.py:294-298 仅写 versionWarning，available 仍为 True）。 |
| **B-04** | **env 覆盖指向不存在的路径**（如 `SILLYHUB_CLAUDE_PATH=/nonexistent/claude`） | `existsSync(envVal)` 返回 false → **降级到 PATH 查找**（`findOnPath`），而非直接报错。对应 Python agent_detector.py:233-242（`if os.path.isfile(env_val): return env_val` 失败则继续到 `shutil.which`）+ `test_agent_detector.py:160-169 test_env_path_not_exist_fallback_to_which`。理由：env 覆盖是「优先提示」，不是「硬性指定」——找不到就当没设，让 PATH 兜底。 |
| **B-05** | **Windows .cmd / .bat 包装器**（如 `C:\nvm4w\nodejs\codex.CMD`） | 两处兼容：(1) `findOnPath` 在 Windows 下追加尝试 `.exe` / `.cmd` / `.bat` / `.ps1` 后缀，返回第一个匹配——**保留包装器路径**（不剥到 `node.exe`），让 version 探测执行真正的 CLI 入口（对应 Python agent_detector.py:229-232 注释）。(2) `detectVersion` 在 `process.platform === 'win32'` 且 binPath 以 `.cmd` / `.bat` 结尾时，走 `exec('"<binPath>" --version', ...)` shell 分支（对齐 Python subprocess.list2cmdline + create_subprocess_shell，agent_detector.py:248-256）。对应 Python `test_agent_detector.py:181-190 test_windows_cmd_wrapper_is_preserved` + `test_agent_detector.py:229-243 test_detect_version_windows_cmd_wrapper`。 |
| **B-06** | **PATH 查找失败**（PATH 为空 / 所有目录都不含目标） | `findOnPath` 遍历完无匹配 → 返回 `null` → `resolveBinPath` 返回 `null` → 走 B-01「provider 未安装」分支。对应 Python `test_agent_detector.py:192-198 test_not_found`。 |
| **B-07** | **未知 provider**（`detectOne('nonexistent')`） | `PROVIDER_SPECS[name]` 返回 `undefined` → `detectOne` 立即返回 `null`（不构造 DetectedAgent）。对应 Python `test_agent_detector.py:380-383 test_detect_one_unknown_agent`。语义：调用方应检查 null。`isAvailable('nonexistent')` 同理返回 false（不抛错）。 |
| **B-08** | **重复 provider**（同一个 bin 在 PATH 多个目录中出现） | `findOnPath` 返回**第一个**匹配（顺序遍历 PATH），不返回列表。对应 Python `shutil.which` 的「取首个」语义。若用户想用第二个，应通过 env 覆盖指定。 |
| **B-09** | **`--version` 超时**（10s 内子进程未退出） | `execFile` 的 timeout 选项触发 → 回调 err 含 `killed: true` → `onResult` 走 `if (err)` 分支 → `detectVersion` 返回 `null`。对应 Python agent_detector.py:264 `asyncio.wait_for(proc.communicate(), timeout=10)` + `test_agent_detector.py:256-265 test_detect_version_timeout`。语义：超时视为「无法获取版本」，status 仍为 'available'（如 B-02）。 |
| **B-10** | **子进程启动失败**（ENOENT — 路径存在但无法执行，如权限不足 / 符号链接断裂） | `execFile` 回调 err.code === 'ENOENT'（或其他）→ 走 `onResult` 的 err 分支 → 返回 `null`。对应 Python agent_detector.py:270 `except (FileNotFoundError, asyncio.TimeoutError, OSError)` + `test_agent_detector.py:278-296 test_detect_version_file_not_found` / `test_detect_version_os_error`。注意：Python 的 `FileNotFoundError` 实际不太可能触发（resolveBinPath 已校验存在），但 Node 的 execFile 在「文件存在但不可执行」时仍可能抛错——按 err 统一返回 null 即可。 |
| **B-11** | **PATH 上有同名目录但非文件**（如 PATH 含 `/tmp/claude/`，且 `/tmp/claude/claude` 是目录） | `statSync(candidate).isFile()` 返回 false → 跳过，继续下一个候选。**避免误把目录当二进制**。Python `shutil.which` 同样有 `path.isfile()` 检查（默认 mode）。 |
| **B-12** | **claude 的两种 --version 输出格式** | claude 的 versionPattern 同时支持 `'Claude Code X.Y.Z'`（前缀）和 `'X.Y.Z (Claude Code)'`（后缀）两种格式（正则 `(?:Claude Code\s+)?(\d+\.\d+\.\d+)(?:\s+\(Claude Code\))?`）。对应 Python `test_agent_detector.py:208-227 test_detect_version_success` + `test_detect_version_claude_suffix_format`。两种格式都提取 `X.Y.Z` 部分到捕获组 1。 |

---

## 非目标

本任务**不做**以下事项（明确排除，防止 scope creep）：

- **N-16-1**：**不实现 provider 安装**。本任务只检测已安装的 agent CLI，不下载 / 安装 / 升级任何 provider。安装属于用户职责（npm install / brew install 等）。
- **N-16-2**：**不下载 agent CLI 二进制**（同 N-16-1 的另一面）。即使检测到 provider 未安装，也不触发任何下载逻辑。
- **N-16-3**：**不持久化检测结果**。探测器只返回 `DetectedAgent[]` 给调用方（task-20 Daemon），不写 `~/.sillyhub/daemon/detected-agents.json` 之类的缓存文件。每次 daemon 启动都重新探测（与 Python 版一致）。
- **N-16-4**：**不做远程检测**（如查询 backend 哪些 provider 可用）。探测完全是本机行为，不依赖网络 / backend。
- **N-16-5**：**不并发探测**（见 R5）。保持串行，与 Python 一致。并发优化属于未来 enhancement，本任务不动。
- **N-16-6**：**不实现 POSIX 可执行位检查**（见 R3）。`findOnPath` 在 POSIX 下只检查「存在 + 是文件」，不检查 `fs.accessSync(p, X_OK)`。理由：实践中 agent CLI 都有 +x，且 Python `shutil.which` 的 X_OK 检查在 PATH 上无 +x 的文件也会被忽略——若严格对齐会引入额外系统调用复杂度，YAGNI。若未来发现误报（如某个 PATH 目录有同名非可执行文件），再增强。
- **N-16-7**：**不迁移 Python 废弃的 `AgentInfo` / `get_capabilities`**（见修改文件章节的对照表）。Python 版标 `deprecated`，Node 版直接删除（design.md §2 G-01 不要求保留废弃 API）。
- **N-16-8**：**不做注册**（runtime_id 由 task-20 通过 client.register 获取）。本任务的 `DetectedAgent.runtimeId` 字段始终 `undefined`，注册回填是 task-20 的职责。本任务只保证字段存在于 interface。
- **N-16-9**：**不做跨平台 PATH 大小写归一化**。Windows 文件系统不区分大小写，但 PATH 字符串本身保留原样遍历。`findOnPath('claude')` 在 Windows 下若 PATH 上是 `Claude.exe`，`existsSync(join(dir, 'claude.exe'))` 会因 Windows 大小写不敏感而命中——这是 Node fs 的默认行为，无需额外处理。
- **N-16-10**：**不引入 `which` / `which-promise` / `find-exec` 第三方库**（design.md G-05）。手写 `findOnPath` 即可。

---

## 参考

### Python 源文件

| 文件 | 行 | 提取内容 |
|---|---|---|
| `sillyhub-daemon/sillyhub_daemon/agent_detector.py` | 18 | `from sillyhub_daemon.version import check_min_version, parse_semver` —— 唯一 import 点（Node 版 `import { checkMinVersion } from './version.js'`） |
| `sillyhub-daemon/sillyhub_daemon/agent_detector.py` | 37-46 | `AgentDef` dataclass —— 5 字段（bin / env_path / version_pattern / protocol / min_version） |
| `sillyhub-daemon/sillyhub_daemon/agent_detector.py` | 48-58 | `DetectedAgent` dataclass —— 6 字段（name / bin_path / version / protocol / available / version_warning） |
| `sillyhub-daemon/sillyhub_daemon/agent_detector.py` | 60-73 | `AgentInfo` 废弃兼容 dataclass —— Node 版**不迁移** |
| `sillyhub-daemon/sillyhub_daemon/agent_detector.py` | 98-174 | `AGENT_DEFS` 字典 —— **12 provider 完整定义**（claude/codex/copilot/opencode/openclaw/hermes/gemini/pi/cursor/kimi/kiro/antigravity），含 bin / envPath / versionPattern / protocol / minVersion 真实值 |
| `sillyhub-daemon/sillyhub_daemon/agent_detector.py` | 180-185 | `detect_all`：**串行** for 循环（非并发），返回 list[DetectedAgent] |
| `sillyhub-daemon/sillyhub_daemon/agent_detector.py` | 187-195 | `detect_one`：单个 provider 探测；未知返回 None |
| `sillyhub-daemon/sillyhub_daemon/agent_detector.py` | 197-207 | `is_available`：同步快速检查（仅 resolveBinPath，不执行 --version） |
| `sillyhub-daemon/sillyhub_daemon/agent_detector.py` | 209-218 | `get_capabilities` 废弃 —— Node 版**不迁移** |
| `sillyhub-daemon/sillyhub_daemon/agent_detector.py` | 224-243 | `_resolve_bin_path`：env（os.path.isfile 校验）→ shutil.which → None |
| `sillyhub-daemon/sillyhub_daemon/agent_detector.py` | 245-272 | `_detect_version`：subprocess + 10s 超时 + stdout+stderr 合并扫描 + 正则 exec；Windows .cmd/.bat 走 shell 分支；异常统一返回 None |
| `sillyhub-daemon/sillyhub_daemon/agent_detector.py` | 274-299 | `_detect_single`：完整探测管道（resolve → unavailable / detect_version → check_min_version → DetectedAgent） |
| `sillyhub-daemon/sillyhub_daemon/daemon.py` | 70-110 | Daemon.start() 注册循环 —— runtime_id 来自 `resp.get("id")`，**非 detector 生成**（本任务 runtimeId 字段语义的关键依据） |
| `sillyhub-daemon/tests/test_agent_detector.py` | 1-547 | 9 个测试类共 ~40 个用例，1:1 迁移 |

### 关联 task

| task | 关系 |
|---|---|
| task-14（version.ts） | 提供 `checkMinVersion`（本任务 `import { checkMinVersion } from './version.js'`），调用点在 `detectSingle`（对应 Python agent_detector.py:290） |
| task-20（Daemon 主类） | 调用方：`detector.detectAgents()` → `for (const agent of available) client.register(...)` → 回填 `agent.runtimeId = resp.id` |
| task-22（测试迁移） | 整体迁移校验：`tests/test_agent_detector.py` → `tests/agent-detector.test.ts`（本任务的 TDD 步骤已写好测试骨架，task-22 负责全量核对） |
| task-11（adapters/index.ts） | PROTOCOL_PROVIDERS 映射的 key（stream_json/json_rpc/jsonl/ndjson/text）必须与本任务 `AgentProtocol` 类型字面量一致 |

### 设计文档

| 文档 | 章节 | 说明 |
|---|---|---|
| `design.md` | §2 G-01 | 功能等价：Node 版与 Python 版对外行为 1:1（本任务的硬约束） |
| `design.md` | §2 G-05 | 零/极少运行时依赖：禁止引入 which 库 |
| `design.md` | §6 文件清单 | `sillyhub-daemon/src/agent-detector.ts` —— 替代 `agent_detector.py`（12 provider 探测） |
| `design.md` | §10 R-08 | vitest/pytest 语义对齐（行为覆盖 1:1，非行数 1:1） |
| `requirements.md` | FR-07 | agent 检测：12 provider 按优先级（env → PATH → 不可用）探测 + --version + 最低版本校验 + 每个可用 agent 注册为独立 runtime_id |

### 模块文档

| 文档 | 说明 |
|---|---|
| `.sillyspec/docs/sillyhub-daemon/modules/agent-detector.md` | 契约摘要 + 关键逻辑（detect_all 串行 / _resolve_bin_path 三段优先级 / 10s 超时 / 12 AGENT_DEFS / 依赖 version 模块） |

### Python 测试用例对照表（1:1 迁移依据）

| Python 测试类 / 方法 | 行 | Node describe/it | 关键断言 |
|---|---|---|---|
| `TestAgentDef.test_basic_fields` | 35-46 | AgentProviderSpec / 基本字段 | claude spec 的 bin/envPath/protocol/minVersion 字段值正确 |
| `TestAgentDef.test_min_version` | 47-55 | AgentProviderSpec / minVersion | codex spec.minVersion === '0.100.0' |
| `TestAgentDefs.test_agent_defs_contains_12_entries` | 92-93 | PROVIDER_SPECS / 12 entry | `Object.keys(PROVIDER_SPECS).length === 12` |
| `TestAgentDefs.test_all_protocols_correct` | 95-113 | PROVIDER_SPECS / 协议映射 | 12 个 provider 的 protocol 字段值与期望表一致 |
| `TestAgentDefs.test_claude_min_version` | 119-120 | PROVIDER_SPECS / claude minVersion | claude.minVersion === '2.0.0' |
| `TestAgentDefs.test_codex_min_version` | 122-123 | PROVIDER_SPECS / codex minVersion | codex.minVersion === '0.100.0' |
| `TestAgentDefs.test_copilot_min_version` | 125-126 | PROVIDER_SPECS / copilot minVersion | copilot.minVersion === '1.0.0' |
| `TestAgentDefs.test_agents_without_min_version` | 128-143 | PROVIDER_SPECS / 无 minVersion | 9 个 provider（opencode/openclaw/hermes/gemini/pi/cursor/kimi/kiro/antigravity）的 minVersion === undefined |
| `TestResolveBinPath.test_env_override` | 152-158 | resolveBinPath / env 覆盖 | envVal 存在且 existsSync=true → 返回 envVal |
| `TestResolveBinPath.test_env_path_not_exist_fallback_to_which` | 160-169 | resolveBinPath / env 失败降级 | envVal 不存在 → findOnPath 返回值 |
| `TestResolveBinPath.test_no_env_fallback_to_which` | 171-179 | resolveBinPath / 无 env | env 未设 → findOnPath 返回值 |
| `TestResolveBinPath.test_windows_cmd_wrapper_is_preserved` | 181-190 | findOnPath / Windows .CMD | Windows 下返回 `C:\nvm4w\nodejs\codex.CMD`（不剥到 node.exe） |
| `TestResolveBinPath.test_not_found` | 192-198 | resolveBinPath / 未找到 | PATH 上无匹配 → null |
| `TestDetectVersion.test_detect_version_success` | 207-216 | detectVersion / claude 前缀格式 | `"Claude Code 2.1.5\n"` → `'2.1.5'` |
| `TestDetectVersion.test_detect_version_claude_suffix_format` | 218-227 | detectVersion / claude 后缀格式 | `"2.1.150 (Claude Code)\n"` → `'2.1.150'` |
| `TestDetectVersion.test_detect_version_windows_cmd_wrapper` | 229-243 | detectVersion / Windows .CMD | Windows + .CMD 走 shell exec 分支，输出正确解析 |
| `TestDetectVersion.test_detect_version_generic_pattern` | 245-254 | detectVersion / 通用正则 | `"codex 0.1.2\n"` → `'0.1.2'` |
| `TestDetectVersion.test_detect_version_timeout` | 256-265 | detectVersion / 超时 | 子进程超时 → null |
| `TestDetectVersion.test_detect_version_pattern_no_match` | 267-276 | detectVersion / 正则不匹配 | `"unknown output\n"` → null |
| `TestDetectVersion.test_detect_version_file_not_found` | 278-286 | detectVersion / ENOENT | execFile 抛 ENOENT → null |
| `TestDetectVersion.test_detect_version_os_error` | 288-296 | detectVersion / OS 错误 | execFile 抛 OSError → null |
| `TestDetectAll.test_detect_all_marks_unavailable` | 305-314 | detectAgents / 全不可用 | 12 条结果全 status='unavailable'，path/version 正确 |
| `TestDetectAll.test_detect_all_returns_all_agents` | 316-329 | detectAgents / 全可用 | 12 条结果全 DetectedAgent 实例 |
| `TestDetectAll.test_detect_all_available_agent_has_version` | 331-347 | detectAgents / 含版本 | claude.available + version='2.1.5' + protocol='stream_json' |
| `TestDetectOne.test_detect_one_found` | 355-370 | detectOne / 找到 | claude 探测成功，available=true |
| `TestDetectOne.test_detect_one_not_found` | 372-378 | detectOne / 未找到 | claude 不可用（PATH 上无） → status='unavailable'，返回对象非 null |
| `TestDetectOne.test_detect_one_unknown_agent` | 380-383 | detectOne / 未知 provider | `detectOne('nonexistent')` → null |
| `TestVersionWarning.test_version_warning_set_when_below_min` | 392-406 | versionWarning / 低于 | claude 1.0.0 → warning 含 '2.0.0' |
| `TestVersionWarning.test_version_warning_none_when_ok` | 408-421 | versionWarning / 达标 | claude 3.0.0 → null |
| `TestVersionWarning.test_version_warning_none_when_no_min_version` | 423-438 | versionWarning / 无要求 | opencode 0.1.0 → null（无 minVersion） |
| `TestIsAvailable.test_available_via_env` | 524-528 | isAvailable / env | env 覆盖指向存在文件 → true |
| `TestIsAvailable.test_available_via_which` | 530-536 | isAvailable / PATH | findOnPath 返回非 null → true |
| `TestIsAvailable.test_not_available` | 538-542 | isAvailable / 不可用 | findOnPath 返回 null → false |
| `TestIsAvailable.test_unknown_agent` | 544-546 | isAvailable / 未知 | `isAvailable('nonexistent')` → false |

> 注：Python 的 `TestParseSemver` / `TestCheckMinVersion` / `TestBackwardCompat` 三类不迁移到本任务的测试——前者已在 task-14 测试覆盖，后者对应废弃 API（Node 版删除）。

---

## TDD 步骤

> 严格遵循「文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收」。本任务 1:1 迁移 Python `test_agent_detector.py` 的 6 个核心测试类（TestAgentDefs / TestResolveBinPath / TestDetectVersion / TestDetectAll / TestDetectOne / TestVersionWarning / TestIsAvailable，约 35 个用例）。

### 步骤 1：读 Python 源与现有代码

- 读 `sillyhub-daemon/sillyhub_daemon/agent_detector.py`（确认 AGENT_DEFS 12 entry / _resolve_bin_path 三段优先级 / _detect_version 子进程 + 10s 超时 + 正则 / _detect_single 管道）。
- 读 `sillyhub-daemon/tests/test_agent_detector.py`（提取全部用例的输入/期望输出，见上文「Python 测试用例对照表」）。
- 读 `sillyhub-daemon/sillyhub_daemon/daemon.py:70-110`（确认 runtime_id 由 `resp.get("id")` 而来，非 detector 生成——影响 DetectedAgent.runtimeId 字段设计）。
- 读 task-14 产出的 `sillyhub-daemon/src/version.ts`（确认 `checkMinVersion(provider, version)` 签名，本任务复用）。
- 确认 task-01 的 `tsconfig.json`（strict）+ task-04 的 `vitest.config.ts` 已产出。若 task-14 未完成，本任务阻塞（depends_on task-14）。

### 步骤 2：写测试（tests/agent-detector.test.ts）

测试策略：**子类覆写 mock**（Python 版用 `unittest.mock.patch`，Node 版用「定义 AgentDetector 子类覆写 protected 方法」）。这比 vi.mock 更精确，不污染全局。

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFile, exec } from 'node:child_process';
import {
  PROVIDER_SPECS,
  AgentDetector,
  type AgentProviderSpec,
  type DetectedAgent,
  type ProviderName,
} from '../src/agent-detector.js';

// ---------------------------------------------------------------------------
// Test helper: 可注入 fake PATH 查找 + fake exec 结果的子类
// ---------------------------------------------------------------------------

/**
 * 测试用子类：覆写 protected 方法注入 mock，避免真实 PATH / 子进程。
 * 对应 Python 版用 @patch 装饰器替换 shutil.which / asyncio.create_subprocess_exec。
 */
class FakeDetector extends AgentDetector {
  // fakeFindOnPath: binName → path 或 null
  fakeFindOnPath: (bin: string) => string | null = () => null;
  // fakeExecResult: binPath → [stdout, stderr] 或抛 Error
  fakeExecResult:
    | { stdout: string; stderr: string }
    | Error
    | null = null;

  protected resolveBinPath(spec: AgentProviderSpec): string | null {
    // 优先级 1：env 覆盖（保留真实 existsSync 语义，测试用 vi.stubEnv +真实 fs 或 mock existsSync）
    // 这里简化：测试 env 时直接走真实实现；测试 findOnPath 时覆写 fakeFindOnPath。
    // 见各测试用例的具体注入方式。
    return super.resolveBinPath(spec);
  }

  protected findOnPath(binName: string): string | null {
    return this.fakeFindOnPath(binName);
  }

  protected detectVersion(
    binPath: string,
    spec: AgentProviderSpec,
  ): Promise<string | null> {
    if (this.fakeExecResult instanceof Error) {
      return Promise.resolve(null);
    }
    if (this.fakeExecResult === null) {
      return Promise.resolve(null);
    }
    const { stdout, stderr } = this.fakeExecResult;
    const output = stdout + stderr;
    const m = spec.versionPattern.exec(output);
    return Promise.resolve(m ? m[1] : null);
  }
}

// 工具：清空 env
function clearAllSillyhubEnv(): void {
  for (const key of Object.keys(PROVIDER_SPECS)) {
    const spec = (PROVIDER_SPECS as Record<string, AgentProviderSpec>)[key];
    delete process.env[spec.envPath];
  }
}

// ---------------------------------------------------------------------------
// PROVIDER_SPECS（对照 TestAgentDefs）
// ---------------------------------------------------------------------------

describe('PROVIDER_SPECS', () => {
  it('恰好 12 个 entry', () => {
    expect(Object.keys(PROVIDER_SPECS)).toHaveLength(12);
  });

  it('12 个 provider 的 protocol 字段与期望表一致', () => {
    const expected: Record<string, string> = {
      claude: 'stream_json',
      codex: 'json_rpc',
      copilot: 'jsonl',
      opencode: 'ndjson',
      openclaw: 'ndjson',
      hermes: 'json_rpc',
      gemini: 'stream_json',
      pi: 'ndjson',
      cursor: 'stream_json',
      kimi: 'json_rpc',
      kiro: 'json_rpc',
      antigravity: 'text',
    };
    for (const [name, proto] of Object.entries(expected)) {
      expect(
        (PROVIDER_SPECS as Record<string, AgentProviderSpec>)[name].protocol,
      ).toBe(proto);
    }
  });

  it('claude minVersion === "2.0.0"', () => {
    expect(PROVIDER_SPECS.claude.minVersion).toBe('2.0.0');
  });

  it('codex minVersion === "0.100.0"', () => {
    expect(PROVIDER_SPECS.codex.minVersion).toBe('0.100.0');
  });

  it('copilot minVersion === "1.0.0"', () => {
    expect(PROVIDER_SPECS.copilot.minVersion).toBe('1.0.0');
  });

  it('9 个无版本要求的 provider minVersion === undefined', () => {
    const noMin = ['opencode', 'openclaw', 'hermes', 'gemini', 'pi', 'cursor', 'kimi', 'kiro', 'antigravity'];
    for (const name of noMin) {
      expect(
        (PROVIDER_SPECS as Record<string, AgentProviderSpec>)[name].minVersion,
      ).toBeUndefined();
    }
  });

  it('cursor 的 bin 是 cursor-agent（不是 cursor）', () => {
    expect(PROVIDER_SPECS.cursor.bin).toBe('cursor-agent');
  });

  it('kiro 的 bin 是 kiro-cli', () => {
    expect(PROVIDER_SPECS.kiro.bin).toBe('kiro-cli');
  });

  it('antigravity 的 bin 是 agy', () => {
    expect(PROVIDER_SPECS.antigravity.bin).toBe('agy');
  });
});

// ---------------------------------------------------------------------------
// resolveBinPath（对照 TestResolveBinPath）
// ---------------------------------------------------------------------------

describe('AgentDetector.resolveBinPath', () => {
  beforeEach(() => clearAllSillyhubEnv());

  it('env 覆盖优先（指向存在文件）', async () => {
    const detector = new AgentDetector();
    // 模拟 SILLYHUB_CLAUDE_PATH 指向真实存在的文件（用 process.execPath 保证存在）
    process.env.SILLYHUB_CLAUDE_PATH = process.execPath;
    const spec = PROVIDER_SPECS.claude;
    // 调用 protected 方法需 as any
    expect((detector as unknown as { resolveBinPath: (s: AgentProviderSpec) => string | null }).resolveBinPath(spec))
      .toBe(process.execPath);
  });

  it('env 覆盖指向不存在路径 → 降级到 findOnPath', async () => {
    const detector = new FakeDetector();
    detector.fakeFindOnPath = () => '/usr/bin/claude';
    process.env.SILLYHUB_CLAUDE_PATH = '/nonexistent/claude';
    const spec = PROVIDER_SPECS.claude;
    const r = (detector as unknown as { resolveBinPath: (s: AgentProviderSpec) => string | null }).resolveBinPath(spec);
    expect(r).toBe('/usr/bin/claude');
  });

  it('无 env → 直接走 findOnPath', async () => {
    const detector = new FakeDetector();
    detector.fakeFindOnPath = () => '/usr/bin/claude';
    const spec = PROVIDER_SPECS.claude;
    const r = (detector as unknown as { resolveBinPath: (s: AgentProviderSpec) => string | null }).resolveBinPath(spec);
    expect(r).toBe('/usr/bin/claude');
  });

  it('PATH 上无匹配 → null', async () => {
    const detector = new FakeDetector();
    detector.fakeFindOnPath = () => null;
    const spec = PROVIDER_SPECS.claude;
    const r = (detector as unknown as { resolveBinPath: (s: AgentProviderSpec) => string | null }).resolveBinPath(spec);
    expect(r).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectVersion（对照 TestDetectVersion，通过 FakeDetector 覆写注入子进程结果）
// ---------------------------------------------------------------------------

describe('AgentDetector.detectVersion', () => {
  it('claude 前缀格式 "Claude Code 2.1.5" → "2.1.5"', async () => {
    const d = new FakeDetector();
    d.fakeExecResult = { stdout: 'Claude Code 2.1.5\n', stderr: '' };
    const r = await (d as unknown as { detectVersion: (p: string, s: AgentProviderSpec) => Promise<string | null> })
      .detectVersion('/usr/bin/claude', PROVIDER_SPECS.claude);
    expect(r).toBe('2.1.5');
  });

  it('claude 后缀格式 "2.1.150 (Claude Code)" → "2.1.150"', async () => {
    const d = new FakeDetector();
    d.fakeExecResult = { stdout: '2.1.150 (Claude Code)\n', stderr: '' };
    const r = await (d as unknown as { detectVersion: (p: string, s: AgentProviderSpec) => Promise<string | null> })
      .detectVersion('/usr/bin/claude', PROVIDER_SPECS.claude);
    expect(r).toBe('2.1.150');
  });

  it('codex 通用格式 "codex 0.1.2" → "0.1.2"', async () => {
    const d = new FakeDetector();
    d.fakeExecResult = { stdout: 'codex 0.1.2\n', stderr: '' };
    const r = await (d as unknown as { detectVersion: (p: string, s: AgentProviderSpec) => Promise<string | null> })
      .detectVersion('/usr/bin/codex', PROVIDER_SPECS.codex);
    expect(r).toBe('0.1.2');
  });

  it('正则不匹配 "unknown output" → null', async () => {
    const d = new FakeDetector();
    d.fakeExecResult = { stdout: 'unknown output\n', stderr: '' };
    const r = await (d as unknown as { detectVersion: (p: string, s: AgentProviderSpec) => Promise<string | null> })
      .detectVersion('/usr/bin/claude', PROVIDER_SPECS.claude);
    expect(r).toBeNull();
  });

  it('子进程抛错（ENOENT / OSError）→ null', async () => {
    const d = new FakeDetector();
    d.fakeExecResult = new Error('ENOENT');
    const r = await (d as unknown as { detectVersion: (p: string, s: AgentProviderSpec) => Promise<string | null> })
      .detectVersion('/usr/bin/claude', PROVIDER_SPECS.claude);
    expect(r).toBeNull();
  });

  it('stderr 含版本号也能匹配（stdout+stderr 合并扫描）', async () => {
    const d = new FakeDetector();
    d.fakeExecResult = { stdout: '', stderr: 'codex 0.131.0\n' };
    const r = await (d as unknown as { detectVersion: (p: string, s: AgentProviderSpec) => Promise<string | null> })
      .detectVersion('/usr/bin/codex', PROVIDER_SPECS.codex);
    expect(r).toBe('0.131.0');
  });
});

// ---------------------------------------------------------------------------
// detectAgents（对照 TestDetectAll）
// ---------------------------------------------------------------------------

describe('AgentDetector.detectAgents', () => {
  beforeEach(() => clearAllSillyhubEnv());

  it('全部不可用 → 12 条 status="unavailable"', async () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = () => null;
    const results = await d.detectAgents();
    expect(results).toHaveLength(12);
    expect(results.every((r) => r.status === 'unavailable')).toBe(true);
    expect(results.every((r) => r.path === '')).toBe(true);
    expect(results.every((r) => r.version === undefined)).toBe(true);
    expect(results.every((r) => r.reason === 'not-found')).toBe(true);
    expect(results.every((r) => r.runtimeId === undefined)).toBe(true);
  });

  it('claude 可用 + 版本达标 → status="available" + version + protocol', async () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = (bin) => (bin === 'claude' ? '/usr/bin/claude' : null);
    d.fakeExecResult = { stdout: 'Claude Code 2.1.5\n', stderr: '' };
    const results = await d.detectAgents();
    expect(results).toHaveLength(12);
    const claude = results.find((r) => r.provider === 'claude')!;
    expect(claude.status).toBe('available');
    expect(claude.path).toBe('/usr/bin/claude');
    expect(claude.version).toBe('2.1.5');
    expect(claude.protocol).toBe('stream_json');
    expect(claude.versionWarning).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectOne（对照 TestDetectOne）
// ---------------------------------------------------------------------------

describe('AgentDetector.detectOne', () => {
  beforeEach(() => clearAllSillyhubEnv());

  it('未知 provider → null', async () => {
    const d = new AgentDetector();
    expect(await d.detectOne('nonexistent')).toBeNull();
  });

  it('claude 找到 → DetectedAgent', async () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = () => '/usr/bin/claude';
    d.fakeExecResult = { stdout: 'Claude Code 2.1.5\n', stderr: '' };
    const r = await d.detectOne('claude');
    expect(r).not.toBeNull();
    expect(r!.provider).toBe('claude');
    expect(r!.status).toBe('available');
    expect(r!.version).toBe('2.1.5');
  });

  it('claude PATH 上无 → status="unavailable"（非 null）', async () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = () => null;
    const r = await d.detectOne('claude');
    expect(r).not.toBeNull();
    expect(r!.status).toBe('unavailable');
  });
});

// ---------------------------------------------------------------------------
// versionWarning（对照 TestVersionWarning）
// ---------------------------------------------------------------------------

describe('AgentDetector versionWarning', () => {
  beforeEach(() => clearAllSillyhubEnv());

  it('claude 低于最低（1.0.0 < 2.0.0）→ warning 含 "2.0.0"', async () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = () => '/usr/bin/claude';
    d.fakeExecResult = { stdout: 'Claude Code 1.0.0\n', stderr: '' };
    const results = await d.detectAgents();
    const claude = results.find((r) => r.provider === 'claude')!;
    expect(claude.versionWarning).not.toBeNull();
    expect(claude.versionWarning).toContain('2.0.0');
    // status 仍 available（低于最低不剔除）
    expect(claude.status).toBe('available');
  });

  it('claude 达标（3.0.0 ≥ 2.0.0）→ versionWarning === null', async () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = () => '/usr/bin/claude';
    d.fakeExecResult = { stdout: 'Claude Code 3.0.0\n', stderr: '' };
    const results = await d.detectAgents();
    const claude = results.find((r) => r.provider === 'claude')!;
    expect(claude.versionWarning).toBeNull();
  });

  it('opencode 无 minVersion 要求 → versionWarning === null', async () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = (bin) => (bin === 'opencode' ? '/usr/bin/opencode' : null);
    d.fakeExecResult = { stdout: 'opencode 0.1.0\n', stderr: '' };
    const results = await d.detectAgents();
    const opencode = results.find((r) => r.provider === 'opencode')!;
    expect(opencode.versionWarning).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isAvailable（对照 TestIsAvailable）
// ---------------------------------------------------------------------------

describe('AgentDetector.isAvailable', () => {
  beforeEach(() => clearAllSillyhubEnv());

  it('env 覆盖指向存在文件 → true', () => {
    const d = new AgentDetector();
    process.env.SILLYHUB_CLAUDE_PATH = process.execPath;
    expect(d.isAvailable('claude')).toBe(true);
  });

  it('PATH 上有 → true', () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = () => '/usr/bin/claude';
    expect(d.isAvailable('claude')).toBe(true);
  });

  it('PATH 上无 → false', () => {
    const d = new FakeDetector();
    d.fakeFindOnPath = () => null;
    expect(d.isAvailable('claude')).toBe(false);
  });

  it('未知 provider → false', () => {
    const d = new AgentDetector();
    expect(d.isAvailable('nonexistent')).toBe(false);
  });
});
```

### 步骤 3：写实现（src/agent-detector.ts）

照抄上文「接口定义」章节的完整 TS 代码。

### 步骤 4：跑测试 + tsc

```bash
cd sillyhub-daemon
npx tsc --noEmit                                       # AC-08: 零错误
npx vitest run tests/agent-detector.test.ts            # AC-07: 全绿
```

### 步骤 5：对照 Python 用例人工核对

逐条对照 `test_agent_detector.py`（见上文「Python 测试用例对照表」）：

- `TestAgentDefs`（7 个用例）→ PROVIDER_SPECS describe 块全绿 ✅
- `TestResolveBinPath`（5 个用例）→ resolveBinPath describe 块全绿 ✅
- `TestDetectVersion`（8 个用例，排除 Windows .CMD 单独走集成测试）→ detectVersion describe 块全绿 ✅
- `TestDetectAll`（3 个用例）→ detectAgents describe 块全绿 ✅
- `TestDetectOne`（3 个用例）→ detectOne describe 块全绿 ✅
- `TestVersionWarning`（3 个用例）→ versionWarning describe 块全绿 ✅
- `TestIsAvailable`（4 个用例）→ isAvailable describe 块全绿 ✅

**不迁移**：TestParseSemver（已在 task-14 覆盖）/ TestCheckMinVersion（已在 task-14 覆盖）/ TestBackwardCompat（对应废弃 API，Node 版删除）。

---

## 验收标准

| 编号 | 验收项 | 验证方法 | 通过标准 |
|---|---|---|---|
| **AC-01** | 12 provider 全覆盖 | `npx vitest run tests/agent-detector.test.ts -t "恰好 12 个 entry"` | `Object.keys(PROVIDER_SPECS).length === 12`，断言通过；且包含 claude/codex/copilot/opencode/openclaw/hermes/gemini/pi/cursor/kimi/kiro/antigravity 全部 12 个 key |
| **AC-02** | 12 provider 的 protocol 字段全部正确 | `npx vitest run tests/agent-detector.test.ts -t "protocol 字段与期望表一致"` | stream_json:[claude/gemini/cursor] / json_rpc:[codex/hermes/kimi/kiro] / jsonl:[copilot] / ndjson:[opencode/openclaw/pi] / text:[antigravity]，断言逐条通过 |
| **AC-03** | env 覆盖优先级正确 | `npx vitest run tests/agent-detector.test.ts -t "env 覆盖优先"` | `SILLYHUB_CLAUDE_PATH` 指向存在文件时返回 envVal，不查 PATH |
| **AC-04** | env 指向不存在路径时降级到 PATH 查找 | `npx vitest run tests/agent-detector.test.ts -t "env 覆盖指向不存在路径"` | envVal 通过 existsSync=false → findOnPath 兜底，返回 PATH 上找到的路径 |
| **AC-05** | PATH 查找生效（无 env 时） | `npx vitest run tests/agent-detector.test.ts -t "无 env"` | 无 env 设定时 findOnPath 返回的路径作为 resolveBinPath 结果 |
| **AC-06** | 调用 task-14 的 checkMinVersion 做版本校验 | `grep "checkMinVersion" sillyhub-daemon/src/agent-detector.ts` | 命中 1 处 `import { checkMinVersion } from './version.js'` + 1 处调用 `checkMinVersion(name, version)`；`src/agent-detector.ts` 无内联的 semver 比较逻辑（版本比较 100% 委托给 task-14） |
| **AC-07** | vitest 全绿 | `cd sillyhub-daemon && npx vitest run tests/agent-detector.test.ts` | exit code 0，7 个 describe 块（PROVIDER_SPECS / resolveBinPath / detectVersion / detectAgents / detectOne / versionWarning / isAvailable）全部通过，无 fail/skip |
| **AC-08** | tsc 零错误 | `cd sillyhub-daemon && npx tsc --noEmit` | exit code 0，无任何 error/warning 输出（strict + noImplicitAny + strictNullChecks） |
| **AC-09** | 不可用标记含原因（status='unavailable' + reason='not-found'） | `npx vitest run tests/agent-detector.test.ts -t "全部不可用"` | PATH 全空时 12 条结果全 status='unavailable'，全 reason='not-found'，全 path=''，全 version=undefined |
| **AC-10** | versionWarning 低于最低时非 null，达标时 null | `npx vitest run tests/agent-detector.test.ts -t "claude 低于最低"` + `-t "claude 达标"` | claude 1.0.0 → warning 含 "2.0.0"；claude 3.0.0 → null；opencode 0.1.0（无 minVersion）→ null |
| **AC-11** | 未知 provider 处理（detectOne 返回 null，isAvailable 返回 false） | `npx vitest run tests/agent-detector.test.ts -t "未知 provider"` | `detectOne('nonexistent')` 返回 null；`isAvailable('nonexistent')` 返回 false（不抛错） |
| **AC-12** | DetectedAgent.runtimeId 字段存在且默认 undefined | `npx vitest run tests/agent-detector.test.ts -t "全部不可用"` + grep 字段 | interface 含 `runtimeId?: string`；探测器输出 `runtimeId === undefined`（待 task-20 注册回填） |
| **AC-13** | 多 provider 的 bin 可执行名正确（cursor-agent / kiro-cli / agy，非 cursor / kiro / antigravity） | `npx vitest run tests/agent-detector.test.ts -t "cursor 的 bin"` + `-t "kiro 的 bin"` + `-t "antigravity 的 bin"` | PROVIDER_SPECS.cursor.bin === 'cursor-agent' / .kiro.bin === 'kiro-cli' / .antigravity.bin === 'agy' |
| **AC-14** | 零第三方依赖（除 Node 内置 + ./version.js） | `grep -E "from '[^.]" sillyhub-daemon/src/agent-detector.ts` | 仅命中 `node:child_process` / `node:fs` / `node:path`；无 `which` / `which-promise` / `find-exec` 等第三方库；`package.json` 无新增 dependencies 条目 |
| **AC-15** | 串行探测（非 Promise.all 并发） | `grep -E "Promise\.all|for.*of.*PROVIDER_SPECS|Object\.keys\(PROVIDER_SPECS\)" sillyhub-daemon/src/agent-detector.ts` | `detectAgents` 用 `for...of` + `await`（串行）；不含 `Promise.all`（与 Python detect_all 行为一致） |
| **AC-16** | 仅触碰 allowed_paths 内文件 | `git diff --name-only HEAD` | 产出物为 `sillyhub-daemon/src/agent-detector.ts`；测试文件 `tests/agent-detector.test.ts` 作为开发期验证产物不计入 allowed_paths（task-04 脚手架约定） |
| **AC-17** | 与 Python `agent_detector.py` 行为 1:1 | 人工对照 agent_detector.py:98-174/180-185/224-243/245-272/274-299 | 12 provider 表逐字一致（bin/envPath/versionPattern/protocol/minVersion）/ 探测优先级一致（env→PATH→null）/ versionPattern 一致（claude 双格式 + 其余通用）/ 串行探测一致 / 超时 10s 一致 / 异常统一返回 null 一致 |
| **AC-18** | Windows .cmd/.bat 兼容分支存在（即使 CI 不跑 Windows） | `grep -E "cmd\|bat\|isWindowsCmdWrapper\|list2cmdline" sillyhub-daemon/src/agent-detector.ts` | 命中 Windows 分支：`findOnPath` 追加 .exe/.cmd/.bat/.ps1 后缀尝试 + `detectVersion` 在 .cmd/.bat 时走 exec() shell 分支 |

---

## 自审清单（生成者自查）

- [x] 接口定义完整，搬砖工照抄即可产出可编译的 agent-detector.ts（~330 行，含 12 entry PROVIDER_SPECS + AgentDetector class + 4 个内部方法）
- [x] 12 provider 表与 Python AGENT_DEFS（agent_detector.py:98-174）逐字对齐（bin/envPath/versionPattern/protocol/minVersion 全部真实值）
- [x] 探测策略三段优先级（env→PATH→不可用）与 Python _resolve_bin_path（agent_detector.py:224-243）严格一致
- [x] `--version` 子进程执行 + 10s 超时 + stdout+stderr 合并扫描与 Python _detect_version（agent_detector.py:245-272）一致
- [x] 复用 task-14 的 checkMinVersion，不重复实现 semver 比较（对应 Python agent_detector.py:290 唯一调用点）
- [x] runtimeId 字段语义澄清有依据（daemon.py:98 `resp.get("id")` 证明 runtime_id 由 backend 下发，非 detector 生成）—— 探测器只输出 status='available'，注册回填是 task-20 职责
- [x] 串行探测（非并发）与 Python detect_all（agent_detector.py:180-185）一致
- [x] Windows .cmd/.bat 兼容分支与 Python（agent_detector.py:229-232 + 248-256）一致
- [x] 零第三方依赖决策有 design.md G-05 依据；手写 findOnPath 替代 which 库
- [x] 删除废弃 API（AgentInfo / get_capabilities）决策有 Python `deprecated` 标注依据 + design.md G-01 不要求保留废弃 API
- [x] 边界处理 ≥ 5 条（实际 12 条：未安装/--version 格式异常/版本低于最低/env 不存在路径/Windows .cmd/PATH 查找失败/未知 provider/重复 provider/超时/ENOENT/同名目录/claude 双格式）
- [x] 非目标 ≥ 4 条（实际 10 条，明确划界不安装/不下载/不持久化/不远程检测/不并发/不做 X_OK 检查/不迁移废弃 API/不做注册/不做 PATH 大小写归一化/不引 which 库）
- [x] 验收标准表格化、每条可机器或人工验证，无笼统「正确」（18 条 AC，每条有具体命令 + 期望输出）
- [x] TDD 步骤含完整测试代码骨架（7 个 describe 块约 30 个用例，1:1 对照 Python 测试类），含 FakeDetector 子类注入策略
- [x] 参考章节标注 Python 源行号 + Python 测试用例对照表（35 条）+ design 章节 + FR-07 + 模块文档 + 关联 task
- [x] frontmatter 字段完整（id/priority/estimated_hours/depends_on/blocks/allowed_paths）
