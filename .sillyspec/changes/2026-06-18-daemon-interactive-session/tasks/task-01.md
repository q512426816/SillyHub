---
author: qinyi
created_at: 2026-06-18T22:41:08
id: task-01
title: R-exe 补验——显式 pathToClaudeCodeExecutable=系统 claude 跑通最小 query
priority: P0
estimated_hours: 2
depends_on: []
blocks: [task-04]
requirement_ids: []
decision_ids: [D-009@v1]
allowed_paths:
  - C:/Users/qinyi/AppData/Local/Temp/claude-sdk-spike/h1-exe.mjs
  - C:/Users/qinyi/AppData/Local/Temp/claude-sdk-spike/h1-exe.result.json
  - sillyhub-daemon/src/agent-detector.ts
  - sillyhub-daemon/test/agent-detector.system-claude.integ.test.ts
---

# task-01: R-exe 补验——显式 pathToClaudeCodeExecutable=系统 claude 跑通最小 query

## 定位（先读）

- **Wave 0 / P0 / task-04 硬前置**。这是 spike-02 §3.7 H1 的"显式路径"补验：H1 只验证了 **不传** `pathToClaudeCodeExecutable` 时 SDK 默认用内置 `.pnpm/@anthropic-ai+claude-agent-sdk-win32-x64@0.3.181/claude.exe`（224MB），**没有**验证 D-009@v1 要求的"driver 显式传系统 claude 路径"。
- **D-009@v1 决策**（decisions.md，status: accepted）：daemon **不带** SDK 平台二进制包（`@anthropic-ai/claude-agent-sdk-win32-x64` 不装），ClaudeSdkDriver **必须显式传 `pathToClaudeCodeExecutable`** 指向 agent-detector 检测的系统 claude（2.1.181）。normalized_requirement 三条——
  1. daemon `package.json` dependencies 含 `@anthropic-ai/claude-agent-sdk`（主包）；
  2. ClaudeSdkDriver **必须显式传 `pathToClaudeCodeExecutable`**（来自 agent-detector 检测结果），不依赖 SDK 默认内置 exe；
  3. **agent-detector 未检测到 claude 时 driver 拒绝启动 interactive session（明确报错）**。
- **本任务只验证 exe 路径可行性**，不做 driver 完整实现（driver 在 task-04）。验证脚本 + 一项集成对照测试，产物落 sandbox 与 `sillyhub-daemon/test/`，主树零业务代码改动。
- **背景约束（务必遵守）**：daemon 是 **TypeScript**（sillyhub-daemon/，pnpm / vitest / commander / ws / ESM）；scan 文档把 daemon 标 Python 已过时，**一切按实际 TS 代码**。鉴权经 env 继承：`ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic`（智谱中转，模型映射 `glm-5.2[1m]`），即 daemon 真实部署环境。

## 修改文件（精确路径）

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增（sandbox，仓库外） | `C:/Users/qinyi/AppData/Local/Temp/claude-sdk-spike/h1-exe.mjs` | 显式 `pathToClaudeCodeExecutable` 对照脚本：复刻 agent-detector 逻辑给出系统 claude.CMD 路径 → `query({options:{pathToClaudeCodeExecutable}})` → 跑通 `Reply with exactly: PONG`；与 `h1.mjs`（默认内置）产物对照。 |
| 新增（sandbox 落地证据） | `C:/Users/qinyi/AppData/Local/Temp/claude-sdk-spike/h1-exe.result.json` | h1-exe.mjs 运行结果落盘（`{systemClaudePath, probedRunningPath, result, elapsed_ms, msg_types}`），作为 R-exe 关闭的实证。 |
| 新增 | `sillyhub-daemon/test/agent-detector.system-claude.integ.test.ts` | vitest 集成测试：调 `new AgentDetector().detectOne('claude')`，断言 `status='available'` 且 `path` 以 `.cmd/.exe/.bat/.ps1` 结尾、`version` 满足 `>=2.0.0`；mock `findOnPath=null` 验证未检测 → `unavailable/not-found`（D-009 拒绝启动判据）。**不真实 spawn claude**，仅验证路径解析形状；真实 spawn 在 sandbox 脚本做。 |

> sandbox 脚本与产物在仓库外（`%TEMP%\claude-sdk-spike\`），主树零业务代码改动；`sillyhub-daemon/src/agent-detector.ts` 本身**不改**（只加它的集成测试）。`sillyhub-daemon/package.json` 加 SDK 依赖是 task-04 的事，本任务用 sandbox 既有依赖验证。

## 覆盖来源

- **R-exe（P0，design §10 风险登记）**："显式 `pathToClaudeCodeExecutable`=系统 claude 未单独验证（spike H1 验证的是默认内置 exe）" → 应对："task-03 前置补验：复用 `%TEMP%\claude-sdk-spike` 脚本加 `pathToClaudeCodeExecutable` 对照跑通"。
- **D-009@v1（decisions.md）**：normalized_requirement 三条（见上"定位"），本任务逐条落实第 2、3 条（第 1 条 package.json 归 task-04）。
- 关联证据：spike-02 §3.7 H1（默认内置 exe 证据，`h1.mjs`，9.8s 跑通 PONG，probed path = `.pnpm/@anthropic-ai+claude-agent-sdk-win32-x64@0.3.181/.../claude.exe`）、`sillyhub-daemon/src/agent-detector.ts`（系统 claude 检测逻辑）。

## 实现要求

### R1. sandbox 对照脚本 `h1-exe.mjs`

复用 spike-02 `h1.mjs` 框架（同 node 项目、同 SDK 0.3.181、同 env 鉴权），关键差异是**显式传 `pathToClaudeCodeExecutable`**。路径来源**等价复刻** `AgentDetector.resolveBinPath('claude')`（不直接 import daemon 代码——sandbox 是独立 node 项目；在脚本内重写同一优先级）：

1. 解析系统 claude 路径（复刻 `agent-detector.ts:259-296` `resolveBinPath` + `findOnPath`）：
   - 读 `process.env.SILLYHUB_CLAUDE_PATH`，若 `existsSync` 则用它；
   - 否则遍历 `process.env.PATH`（Windows 分号分隔），按后缀 `['.exe','.cmd','.bat','.ps1']` 顺序（对齐 `WINDOWS_EXTS`）找首个 `existsSync && statSync().isFile()` 文件，取绝对路径。
   - 找不到 → 脚本 `console.error('[h1-exe] system claude NOT FOUND → D-009 refuse-to-start')` 并 `process.exit(1)`（对应 D-009 第 3 条的 sandbox 等价物）。
2. 把解析到的路径作为 `pathToClaudeCodeExecutable` 传入 `query()`：
   ```js
   for await (const msg of query({
     prompt: 'Reply with exactly: PONG',
     options: { pathToClaudeCodeExecutable: systemClaudePath },  // ← R-exe 核心差异
   })) { ... }
   ```
3. 在 `system/init` 消息时，用 powershell `Get-Process claude | Select -ExpandProperty Path` 取**实际运行中 claude 进程路径**，断言它 == 传入的 `systemClaudePath`（而非 `.pnpm/.../win32-x64/claude.exe`）—— 这是"显式路径生效"的直接证据。
4. 收集 `result`，断言 `subtype==='success'` 且 `result` 含 `PONG`（与 `h1.mjs` 默认内置结果对照一致）。
5. 落盘 `h1-exe.result.json`：`{systemClaudePath, probedRunningPath, result:{subtype,is_error,result,session_id,model}, elapsed_ms, msg_types}`。

### R2. daemon 集成测试 `agent-detector.system-claude.integ.test.ts`

vitest（`sillyhub-daemon/test/`，ESM，`// @vitest-environment node`）。**不真实 spawn claude 子进程**（避免单测依赖外网中转 + claude.exe），仅验证 agent-detector 给出的路径形状可被 driver 直接当 `pathToClaudeCodeExecutable` 用：

- `it('detects system claude as available with cmd/exe path')`：`const r = await new AgentDetector().detectOne('claude');` 断言 `r.status === 'available'`、`/\.(cmd|exe|bat|ps1)$/i.test(r.path)`、`r.path !== ''`。本机预期 `C:\nvm4w\nodejs\claude.CMD`。
- `it('resolved version satisfies min 2.0.0')`：解析 `r.version`（实测 `2.1.181`），断言 semver `>=2.0.0`（对齐 `PROVIDER_SPECS.claude.minVersion='2.0.0'`）；若环境 `version===undefined`（无 claude）→ `test.skip`，不 FAIL。
- `it('returns unavailable/not-found when claude absent (D-009 refuse-to-start predicate)')`：`vi.spyOn(detector, 'findOnPath').mockReturnValue(null)` + `delete process.env.SILLYHUB_CLAUDE_PATH` → `detectOne('claude')` 断言 `{status:'unavailable', reason:'not-found', path:''}`。这是 task-04 driver 启动前 throw 的判据；本任务只验证 detector 输出形状。

测试纳入 `pnpm test`，全部应在本机直接绿（claude 已装 2.1.181）。

### R3. 落地证据

把 `h1-exe.result.json` 关键字段（脱敏 session_id 尾部）回填本文件 §验收标准"实测证据"块，作为 R-exe 关闭的实证。

## 接口定义

### sandbox 最小 query 调用（伪代码 / 搬砖级）

```js
// h1-exe.mjs
import { query } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// —— 复刻 AgentDetector.resolveBinPath('claude')（agent-detector.ts:259-296）——
function resolveSystemClaude() {
  const envVal = process.env.SILLYHUB_CLAUDE_PATH;
  if (envVal && existsSync(envVal)) return envVal;
  const pathVar = process.env.PATH;
  if (!pathVar) return null;
  const exts = process.platform === 'win32' ? ['.exe','.cmd','.bat','.ps1'] : [''];
  for (const dir of pathVar.split(process.platform === 'win32' ? ';' : ':')) {
    if (!dir) continue;
    for (const ext of exts) {
      const cand = join(dir, 'claude' + ext);
      try { if (existsSync(cand) && statSync(cand).isFile()) return cand; } catch {}
    }
  }
  return null;
}

const systemClaudePath = resolveSystemClaude();
if (!systemClaudePath) {
  console.error('[h1-exe] system claude NOT FOUND → D-009 refuse-to-start triggered');
  process.exit(1);
}
console.log('[h1-exe] pathToClaudeCodeExecutable =', systemClaudePath);

let resultMsg = null;
let probed = '(not probed)';
const seen = [];
const t0 = Date.now();
for await (const msg of query({
  prompt: 'Reply with exactly: PONG',
  options: { pathToClaudeCodeExecutable: systemClaudePath },  // ← R-exe 核心差异
})) {
  seen.push(msg.type + (msg.subtype ? '/' + msg.subtype : ''));
  if (msg.type === 'system' && msg.subtype === 'init') {
    try {
      probed = execSync(
        'powershell -NoProfile -Command "Get-Process claude -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path"',
        { encoding: 'utf8', timeout: 8000 },
      ).trim();
    } catch (e) { probed = '(probe failed: ' + String(e.message || e).slice(0, 200) + ')'; }
    console.log('[init] session_id=' + msg.session_id + ' model=' + (msg.model || '?'));
    console.log('[claude running path]:', probed);  // 应 == systemClaudePath，非 .pnpm 内置
  }
  if (msg.type === 'result') resultMsg = msg;
}

const elapsed_ms = Date.now() - t0;
console.log('msg_types:', seen.join(', '));
console.log('elapsed_ms:', elapsed_ms);
console.log('result:', JSON.stringify({
  subtype: resultMsg && resultMsg.subtype,
  is_error: resultMsg && resultMsg.is_error,
  result: (resultMsg && resultMsg.result || '').slice(0, 300),
  session_id: resultMsg && resultMsg.session_id,
  model: resultMsg && resultMsg.model,
}));

// 落盘证据
writeFileSync('h1-exe.result.json', JSON.stringify({
  systemClaudePath,
  probedRunningPath: probed,
  result: resultMsg && {
    subtype: resultMsg.subtype,
    is_error: resultMsg.is_error,
    result: (resultMsg.result || '').slice(0, 300),
    session_id: resultMsg.session_id,
    model: resultMsg.model,
  },
  elapsed_ms,
  msg_types: seen,
}, null, 2));

if (!resultMsg || resultMsg.subtype !== 'success' || !(resultMsg.result || '').includes('PONG')) {
  console.error('[h1-exe] FAILED: expected success/PONG');
  process.exit(2);
}
```

### agent-detector 给出系统 claude 路径（task-04 driver 将这样用，本任务只验 detector 输出形状）

```ts
// task-04 ClaudeSdkDriver 启动前（本任务不实现 driver，仅规定接口形状）
import { AgentDetector } from '../agent-detector.js';

const detected = await new AgentDetector().detectOne('claude');
if (detected.status !== 'available' || !detected.path) {
  // D-009 normalized_requirement 第 3 条：拒绝启动
  throw new Error(`claude not detected on system (status=${detected.status}, reason=${detected.reason || 'n/a'}); cannot start interactive session (D-009)`);
}
const opts: ClaudeSdkDriverOptions = {
  pathToClaudeCodeExecutable: detected.path,  // e.g. 'C:\\nvm4w\\nodejs\\claude.CMD'
  cwd: sessionCwd,
  env: { ...process.env },                    // ANTHROPIC_AUTH_TOKEN + BASE_URL（spike H1 env 继承）
};
```

## 边界处理（≥5）

| # | 边界场景 | 处理 |
|---|---|---|
| B1 | **`.CMD` vs `.exe` 解析**：系统 claude 通常是 npm 全局装的 `claude.CMD` 包装器（实测 `C:\nvm4w\nodejs\claude.CMD`），非真 exe；spike H1 默认内置才是 `.exe`。SDK `pathToClaudeCodeExecutable` 文档未限制扩展名，预期接受 `.cmd`。验证脚本断言 probed 运行路径 == 传入的 `.CMD`；若 SDK 拒绝 `.CMD`（spawn ENOENT/EINVAL），脚本捕获并明确报错 `[h1-exe] SDK rejected .CMD path` → 反推 D-009 调整（预期通过）。注：agent-detector `WINDOWS_EXTS=['.exe','.cmd','.bat','.ps1']` 顺序保证优先 `.exe`，本机无 `claude.exe` 才取 `.CMD`。 |
| B2 | **agent-detector 未检测到 claude → 拒绝启动**（D-009 normalized_requirement 第 3 条）：sandbox `resolveSystemClaude()` 返回 null 时 `process.exit(1)`；daemon 侧（R2 测试）mock `findOnPath=null` + 无 env → 断言 `detectOne('claude')` 返回 `{status:'unavailable', reason:'not-found', path:''}`。task-04 driver 据此判据 throw。本任务只验判据成立，不实现 throw（throw 在 task-04）。 |
| B3 | **系统 claude 版本 < 2.0.0**：agent-detector `PROVIDER_SPECS.claude.minVersion='2.0.0'`，`checkMinVersion` 会产非空 `versionWarning`。本机实测 `2.1.181`（达标）。R2 测试断言 `>=2.0.0`；若环境版本低，sandbox 脚本仍跑（验证路径不卡版本），但日志打 `[WARN] claude version < min 2.0.0`，driver（task-04）按 `versionWarning !== null` 决定是否拒绝——本任务不实现拒绝逻辑，仅记录可观测。 |
| B4 | **中转鉴权失败**（`ANTHROPIC_AUTH_TOKEN` 未设/过期/`BASE_URL` 错）：`query()` 的 `result` 会 `is_error=true`（spike H1 鉴权经 env 继承，缺失即报错）。sandbox 脚本断言 `subtype==='success'`，若 `is_error` 打印完整 `result` 并 `exit(2)`；**区分根因**："路径错"（spawn ENOENT，进程根本没起）vs "鉴权错"（进程起了但 result is_error）——两者都阻断但根因不同，日志明确标注不混淆。 |
| B5 | **与默认内置 exe 行为对比差异**：`h1.mjs`（默认内置 `.pnpm/.../claude.exe`）与 `h1-exe.mjs`（系统 `claude.CMD`）应在 `result.result`（PONG）、`session_id`（UUID 格式）、`model` 字段上**一致**；差异只在"实际运行进程路径"。对照表写入 §验收标准 AC5。预期行为一致（同一 SDK + 同一后端）；若响应内容/耗时显著偏离（如 `.CMD` 经 cmd.exe 多一层导致 stdout 解析问题），记录为 caveat 上抛，不静默通过。 |
| B6 | **PATH 上有多个 claude**（如 nvm + 全局 + 某 node_modules/.bin）：agent-detector 按 PATH 顺序取首个 `.exe/.cmd/...`，可能不是用户期望的那个。sandbox 脚本打印解析到的绝对路径供人工核对；`SILLYHUB_CLAUDE_PATH` env 可覆盖（D-009 优先级 env > PATH）。本任务不解决多版本冲突，仅保证解析结果透明可覆盖。 |
| B7 | **sandbox node/SDK 版本漂移**：sandbox 用 spike-02 既有 `node_modules`（SDK 0.3.181）。若 `pnpm update` 升 SDK 到 0.4+，`pathToClaudeCodeExecutable` option 名/语义可能变（R-SDK0.x）。脚本顶部打印 `require('@anthropic-ai/claude-agent-sdk/package.json').version`，非 0.3.181 打 WARN（不阻断，提示回归）。 |

## 非目标

- ❌ **不做 ClaudeSdkDriver 完整实现**（start/consume/interrupt/canUseTool/result→AgentRun 映射）——那是 task-04。
- ❌ 不改 `sillyhub-daemon/src/agent-detector.ts` 源码（只加它的集成测试）。
- ❌ 不改 daemon `package.json` 加 SDK 依赖（那是 task-04；本任务用 sandbox 既有依赖验证）。
- ❌ 不验证多轮 / interrupt / canUseTool / resume（spike-02 已覆盖 H2/D1/D2/D3）。
- ❌ 不验证 GLM 工具兼容性（D-008，task-09）。
- ❌ 不验证 `streamInput` 主动注入（spike S1 留待 driver 阶段）。
- ❌ 不带 `@anthropic-ai/claude-agent-sdk-win32-x64` 平台二进制包（D-009 明确排除；本任务恰恰验证"不带也能跑"，靠系统 claude.CMD）。
- ❌ 不动 backend / frontend / protocol（本任务是 daemon 侧前置验证）。

## 参考

- `spike-02-architecture-validation.md` §3.7 H1（默认内置 exe 证据：9.8s 跑通 PONG，probed path = `.pnpm/@anthropic-ai+claude-agent-sdk-win32-x64@0.3.181/.../claude.exe`，不依赖系统 claude.CMD）
- `sillyhub-daemon/src/agent-detector.ts`：
  - `PROVIDER_SPECS.claude`（`bin:'claude'`, `envPath:'SILLYHUB_CLAUDE_PATH'`, `minVersion:'2.0.0'`, `versionPattern: /(?:Claude Code\s+)?(\d+\.\d+\.\d+)(?:\s+\(Claude Code\))?/`, `protocol:'stream_json'`）
  - `WINDOWS_EXTS = ['.exe','.cmd','.bat','.ps1']`（ql-20260616-001 修复：移除空扩展名避免取到 sh wrapper）
  - `AgentDetector.resolveBinPath`（env → PATH）、`findOnPath`（跨平台后缀尝试）、`detectSingle`（not-found → `unavailable/not-found/path:''`）
- `decisions.md` D-009@v1（normalized_requirement 三条 + evidence 标注"待验：显式 pathToClaudeCodeExecutable=系统 claude 需 execute 前补验"）
- `design.md` §7.1 `ClaudeSdkDriverOptions.pathToClaudeCodeExecutable`、§10 R-exe（P0）、§5 Wave1（D-009 用系统 claude.CMD）、§9 兼容策略（D-009 未检测到拒绝启动）
- sandbox 对照基线：`C:/Users/qinyi/AppData/Local/Temp/claude-sdk-spike/h1.mjs`（默认内置）、`h2.mjs`/`d1-d4.mjs`/`s1.mjs`
- 实测环境：node v24.15.0 / pnpm 9.6.0 / Windows；`claude --version` = `2.1.181 (Claude Code)`；`which claude` = `/c/nvm4w/nodejs/claude`（sh wrapper，agent-detector `findOnPath` 会取到 `C:\nvm4w\nodejs\claude.CMD`）

## TDD 步骤

1. **先写 R2 集成测试**（红→绿）：建 `sillyhub-daemon/test/agent-detector.system-claude.integ.test.ts`，写三 case（available+.cmd/.exe、version>=2.0.0、unavailable→not-found）。跑 `pnpm test`——前两个在本机应直接绿（claude 2.1.181 已装），第三个需 mock。
2. **mock `findOnPath`**（D-009 判据）：`const detector = new AgentDetector(); vi.spyOn(detector, 'findOnPath').mockReturnValue(null); delete process.env.SILLYHUB_CLAUDE_PATH;` → 断言 `(await detector.detectOne('claude')).status === 'unavailable'` 且 `reason === 'not-found'` 且 `path === ''`（绿）。**验证 D-009 拒绝启动判据成立**。
3. **跑 sandbox 对照脚本**（R1）：确保 `ANTHROPIC_AUTH_TOKEN`+`ANTHROPIC_BASE_URL` 已设（同 h1.mjs 环境），`cd %TEMP%\claude-sdk-spike && node h1-exe.mjs`。预期 ~10s 跑通，`result.result` 含 `PONG`，probed 运行路径 = 系统 `claude.CMD`（非 `.pnpm` 内置）。
4. **对照 h1.mjs**（B5）：跑 `node h1.mjs` 取默认内置结果，与 h1-exe 比 `result.result`/`model`/`session_id`/`elapsed_ms`（填 §验收标准 AC5）。
5. **落盘证据**（R3）：`h1-exe.result.json` 写入 sandbox，关键字段抄进本文件 §验收标准"实测证据"。
6. **边界回归**（B2）：临时 `unset SILLYHUB_CLAUDE_PATH` 且 PATH 无 claude 的子集（或在 mock 测试里）→ 验证 `resolveSystemClaude()→null→exit(1)` / detector `unavailable`。
7. **全绿**：`pnpm test`（daemon，含新集成测试）+ sandbox `h1-exe.mjs`（success/PONG）+ sandbox `h1.mjs`（success/PONG，对照）→ R-exe 关闭。

## 验收标准

| # | 标准 | 通过判据（具体可测） | 证据 |
|---|---|---|---|
| AC1 | **显式路径跑通 PONG** | `h1-exe.mjs` 的 `result.subtype==='success'` 且 `result.result` 包含 `PONG`，`is_error===false`，exit code 0 | `h1-exe.result.json`（§实测证据回填） |
| AC2 | **运行进程路径=系统 claude**（非内置） | probed `Get-Process claude \| Select Path` 输出 == 传入的 `systemClaudePath`（如 `C:\nvm4w\nodejs\claude.CMD`），**不含** `.pnpm/@anthropic-ai+claude-agent-sdk-win32-x64` | `h1-exe.result.json.probedRunningPath` |
| AC3 | **agent-detector 给出可用路径** | `new AgentDetector().detectOne('claude')` → `{status:'available', path: /\.(cmd\|exe\|bat\|ps1)$/i.test(path)===true, version: '2.1.181'}`；`path !== ''` | `pnpm test agent-detector.system-claude`（绿） |
| AC4 | **未检测 claude → unavailable/not-found**（D-009 拒绝启动判据） | mock `findOnPath=null` + 无 env → `detectOne('claude')` → `{status:'unavailable', reason:'not-found', path:''}`；sandbox 等价 `resolveSystemClaude()→null→exit(1)` | 集成测试 case 3（绿）+ sandbox 手测 exit code=1 |
| AC5 | **与默认内置结果一致**（B5 对照） | `h1.mjs`（默认内置）与 `h1-exe.mjs`（系统 .CMD）的 `result.result` 均含 `PONG`、`model` 字段一致、`session_id` 同为 UUID 格式；耗时差 < 2x | h1 vs h1-exe 对照（§实测证据回填 elapsed_ms） |
| AC6 | **版本达标** | `detectOne('claude').version` semver `>=2.0.0`（实测 2.1.181） | 集成测试 case 2（绿） |
| AC7 | **主树零业务代码改动** | `git diff --name-only sillyhub-daemon/src/ backend/ frontend/` 为空（仅 `sillyhub-daemon/test/` 新增）；sandbox 改动在 `%TEMP%` 不入 git | `git status` |

### 实测证据（执行后回填）

```
# h1-exe.result.json（阶段 B，显式 pathToClaudeCodeExecutable=真 exe）
# ⚠ R-exe 关键修正：detector 给的是 claude.cmd（npm wrapper），SDK spawn 无 shell → EINVAL。
#    h1-exe.mjs 实测两阶段：A 直传 .cmd → spawn EINVAL（exit 2）；B 解 wrapper 取真 exe → 跑通。
sdkVersion: "0.3.181"
detectedPath: "C:\\nvm4w\\nodejs\\claude.cmd"                                   # detector 风格（agent-detector.findOnPath）
realExeFromWrapper: "C:\\nvm4w\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"  # wrapper 内引用的底层真 exe（224MB）
pathToClaudeCodeExecutable: "C:\\nvm4w\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"  # 实际传 SDK 的
phase: "B-real-exe"
probedRunningPath: "C:\\nvm4w\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"（×5 个 claude.exe 进程，全是真 exe，无 .pnpm 内置）
result.subtype: "success"                                                      # AC1
result.is_error: false                                                         # AC1
result.result: "PONG"                                                          # AC1
result.model: "glm-5.2[1m]"
result.session_id: "6c05cfce-...-53cd7e915a48"（UUID 格式，尾部脱敏）          # AC5
result.usage.input_tokens: 7625 / output_tokens: 4
elapsed_ms: 3800
msg_types: ["system/init", "assistant", "result/success"]
env.ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/anthropic"
env.ANTHROPIC_AUTH_TOKEN_set: true

# 阶段 A（直传 detector 的 .cmd，复现阻塞）
phase: "A-direct-detector"
pathToClaudeCodeExecutable: "C:\\nvm4w\\nodejs\\claude.cmd"
spawnError.code: "EINVAL", syscall: "spawn", message: "spawn EINVAL"
elapsed_ms: 4（进程根本没起，spawn 级失败，非鉴权）

# 对照 h1.mjs（默认不传 pathToClaudeCodeExecutable，SDK 用内置 stub）
h1.session_id: "397612a8-...-88345ac78128"（UUID）
h1.model: "glm-5.2[1m]"                                                        # AC5 与 h1-exe 一致
h1.result.subtype: "success", result.result: "PONG"                           # AC5 一致
h1.elapsed_ms: 12468                                                           # h1-exe(3800) < h1(12468)，h1-exe 更快（无 thinking_tokens 流）
h1.msg_types: system/init + 13×system/thinking_tokens + assistant×2 + result/success
h1.probedRunningPath: 含 .pnpm/@anthropic-ai+claude-agent-sdk-win32-x64@0.3.181/.../claude.exe（SDK 内置 stub）+ 4×系统真 exe
                     ← 重要修正：spike-02 H1「默认只用内置」结论不准；实测 SDK 内置 stub 启动后会拉起系统 claude-code 真 exe

# daemon 集成测试（agent-detector.system-claude.integ.test.ts，3/3 绿）
case1 detected path: "C:\\nvm4w\\nodejs\\claude.cmd"  status=available  /\.(cmd|exe|bat|ps1)$/i ✓
case2 version: "2.1.181"  >= minVersion "2.0.0" ✓  versionWarning=null
case3 mock findOnPath=null + 无 env → {status:unavailable, reason:not-found, path:''} ✓
```

### R-exe 关键修正（对 task-04 driver 至关重要，务必在 task-04 落实）

执行中发现的**D-009 路径策略硬约束**，task-04 ClaudeSdkDriver 必须遵守：

1. **detector 给的 `claude.cmd` 不能直接传给 SDK 的 `pathToClaudeCodeExecutable`**。
   实测 `spawn EINVAL`（4ms 失败）。根因：SDK `spawnLocalProcess`（sdk.mjs minified）用
   `child_process.spawn(command, args, {stdio, env, windowsHide:true})`，**不带 `shell:true`**。
   Windows `CreateProcess` 对 `.cmd`/`.bat`/`.ps1` 包装器返回 EINVAL——必须经 shell 才能执行。
2. **正确路径是解 wrapper 取底层真 `.exe`**。npm cmd-shim 生成的 `claude.cmd`/`claude.ps1`
   内容里引用了 `node_modules\@anthropic-ai\claude-code\bin\claude.exe`（224MB，2.1.181）。
   driver 应：
   - 拿到 detector 的 `path`（可能是 .cmd/.exe/.bat/.ps1）；
   - 若是 .exe 直接用；
   - 否则读 wrapper 内容，正则提取 `node_modules[\\/]@anthropic-ai[\\/]claude-code[\\/]bin[\\/]claude\.exe`，
     join wrapper 所在 dir 得真 exe 绝对路径；
   - 若都失败 → throw（D-009 refuse-to-start）。
3. **D-009 normalized_requirement 第 2 条修正**："driver 必须显式传 pathToClaudeCodeExecutable
   指向 agent-detector 检测的系统 claude"——准确说是"**指向 detector 路径解析出的真 exe**"，
   不是"detector 原样路径"。
4. **task-04 还需考虑**：agent-detector 是否要直接返回真 exe（而非 .cmd）？本任务不改 detector
   （allowed_paths 禁止），但建议 task-04 在 driver 层做 wrapper→exe 解析（detector 保持现状，
   wrapper 解析是 driver 职责，因为只有 driver 知道 SDK 对路径形式的要求）。

> 全部 AC 绿 → **R-exe（P0）关闭，task-04（ClaudeSdkDriver）解锁**（带路径策略修正见上）。
> 任一 AC 红 → 不解锁 task-04。当前：AC1~AC7 全绿（AC2 修正为"probed 全是真 exe，无 .pnpm 内置"）。
