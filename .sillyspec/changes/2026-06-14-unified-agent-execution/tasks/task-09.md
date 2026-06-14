---
author: qinyi
created_at: 2026-06-14T17:52:18
change: 2026-06-14-unified-agent-execution
stage: plan
id: task-09
title: B1 token + tool_config.env 注入 claude 子进程 env（含 redact 守卫）
priority: P1
depends_on: [task-05]
blocks: [task-12]
allowed_paths:
  - sillyhub-daemon/src/spawn-env.ts
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/__tests__/spawn-env.test.ts
---

# task-09: B1 token + tool_config.env 注入 claude 子进程 env（含 redact 守卫）

## 修改文件

- `sillyhub-daemon/src/spawn-env.ts`（新建）—— claude 子进程 env 构造器：合并 `process.env` + credentials.json token + `tool_config.env`，附 redact 守卫。
- `sillyhub-daemon/src/task-runner.ts`（改 ~L313）—— 步骤 6 spawn 前调 `buildSpawnEnv(ctx)` 替代当前 `const spawnEnv = { ...process.env, ...extraEnv };`；env dump 日志统一走 redact。
- `sillyhub-daemon/src/__tests__/spawn-env.test.ts`（新建）—— 单测覆盖 token 注入 + redact + 不泄漏。

> **现状核实**：`credential.ts:207 buildEnv(config)` 已存在并渲染 `{{USER_*}}` 占位符（task-runner.ts:276 已调用 `this.credential.buildEnv(ctx.toolConfig ?? {})`），但**未注入 `ANTHROPIC_API_KEY` / OAuth token**（credentials.json 当前仅含 `GITHUB_TOKEN`，核实 `$HOME/.sillyhub/daemon/credentials.json` keys）。本任务补 token 注入 + redact 守卫，不重写 buildEnv。

## 实现要求

1. **新增 `spawn-env.ts`**：导出 `buildSpawnEnv(ctx, opts)` 函数，产出 `NodeJS.ProcessEnv`，合并三层（优先级从高到低）：
   - `tool_config.env` 段（来自 `LeaseCtx.toolConfig`，由 task-05 fetch execution-context 注入）—— 最高优先级，覆盖下层。
   - claude 凭据：从 credentials.json 读 `ANTHROPIC_API_KEY` / `CLAUDE_OAUTH_TOKEN`（约定键名，见接口定义），两者二选一或并存；**同时也从 `process.env` 兜底**（开发态 dev 直接 export 到 shell 的场景）。
   - `process.env` 副本（基础层，不删任何键）。

2. **token 键名约定**（写入 spawn-env.ts JSDoc + 本任务接口定义）：
   - credentials.json 顶层键 `ANTHROPIC_API_KEY`（API key 模式）或 `CLAUDE_OAUTH_TOKEN`（OAuth 模式）。
   - 若 credentials.json 含 `{{USER_ANTHROPIC_API_KEY}}` 占位符值 → 走 `credential.renderConfig` 解析（但 token 不应走占位符，应直接存明文在 credentials.json，因为 credentials.json 本就是本地 0600 私密文件）。
   - **本任务直接读 credentials.json 顶层明文键**，不走 tool_config 占位符（占位符用于 tool_config.env 的第三方服务如 GitHub）。

3. **task-runner.ts 集成**（改 task-runner.ts:313）：
   - 当前：`const spawnEnv = { ...process.env, ...extraEnv };`（task-runner.ts:313，`extraEnv` 来自 `credential.buildEnv`，仅 tool_config.env）。
   - 改为：`const spawnEnv = buildSpawnEnv(ctx, { credential: this.credential });`，内部完成 process.env + token + tool_config.env 三层合并。
   - 保留 `this.credential.buildEnv(ctx.toolConfig ?? {})`（task-runner.ts:276）作为 tool_config.env 渲染的内部步骤（spawn-env.ts 调用它），不重复实现。

4. **redact 守卫（核心安全要求）**：新增 `redactEnv(env)` 函数，遮蔽所有疑似密钥的 value（正则匹配 key 名：`/KEY|TOKEN|SECRET|PASSWORD|PAT|CREDENTIAL/i`），输出 `***REDACTED***` 替代原值。所有 env 相关日志（task-runner.ts:298 warn、316 spawn 失败诊断、调试 dump）**必须经 redactEnv 后才能输出**。

5. **不泄漏铁律（落实 R-09）**：
   - token **不入 daemon 日志**：spawn-env.ts 内部 `console.debug` 永远打 redact 后的 env；task-runner.ts spawn 失败诊断不直接 dump env。
   - token **不入 Redis publish payload**：`submitMessages` 的 messages 只含 claude 输出文本（task-runner.ts:673 `_eventToMessage`），不含 env；本任务不改 submitMessages 链路。
   - token **不回传前端**：`complete_lease` 的 result payload（daemon.ts:654-664）不含 env；本任务不改 complete_lease。
   - spawn env **仅本地内存构造**，不序列化到磁盘 / 不写入 lease.metadata / 不经 HTTP 传输。

6. **claude 子进程实际鉴权生效**：claude CLI 读 env `ANTHROPIC_API_KEY`（API key 模式）或 `CLAUDE_OAUTH_TOKEN`（OAuth 模式，配合 `~/.claude/.credentials.json` 也行，但本变更统一走 env 注入）。spawn-env.ts 不读 `~/.claude/.credentials.json`（那是 claude CLI 自己管，本任务不介入）。

## 接口定义

```typescript
// sillyhub-daemon/src/spawn-env.ts
import type { LeaseCtx, ToolConfig } from './types.js';
import type { CredentialManager } from './credential.js';

/**
 * spawn env 构造选项。
 */
export interface BuildSpawnEnvOpts {
  /** 凭据管理器（注入 credentials.json 读取 + tool_config 占位符渲染）。 */
  credential: CredentialManager;
}

/**
 * claude 凭据在 credentials.json 中的约定键名（明文存储，credentials.json 已 0600）。
 * API key 模式与 OAuth 模式二选一；两者并存时 API key 优先（claude CLI 行为）。
 */
export const ANTHROPIC_API_KEY_FIELD = 'ANTHROPIC_API_KEY';
export const CLAUDE_OAUTH_TOKEN_FIELD = 'CLAUDE_OAUTH_TOKEN';

/**
 * 构造 claude 子进程 env（spawn 的 SpawnOptions.env）。
 *
 * 三层合并（优先级从高到低）：
 *   1. tool_config.env（ctx.toolConfig，经 credential.buildEnv 渲染占位符 + key 大写）
 *   2. claude token（credentials.json ANTHROPIC_API_KEY / CLAUDE_OAUTH_TOKEN，
 *      process.env 兜底）
 *   3. process.env 副本
 *
 * 返回的 env 仅本地内存使用，**禁止序列化到日志 / Redis / HTTP**。
 */
export function buildSpawnEnv(
  ctx: Pick<LeaseCtx, 'toolConfig'>,
  opts: BuildSpawnEnvOpts,
): NodeJS.ProcessEnv;

/**
 * 遮蔽 env 中的疑似密钥 value（用于日志输出）。
 *
 * 规则：key 名匹配 `/KEY|TOKEN|SECRET|PASSWORD|PAT|CREDENTIAL/i` → value 替换为
 * `***REDACTED***`；其他 key 保留原值。
 *
 * 不修改入参 env（返回新对象）。
 */
export function redactEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined>;
```

```typescript
// task-runner.ts 集成点（task-runner.ts:313 改动）
// 改前：
//   const spawnEnv = { ...process.env, ...extraEnv };
// 改后：
import { buildSpawnEnv, redactEnv } from './spawn-env.js';
// ...
const spawnEnv = buildSpawnEnv(ctx, { credential: this.credential });
// 调试日志（如需）必须走 redactEnv：
//   this._logger?.debug('spawn_env', { env: redactEnv(spawnEnv) });
```

## 边界处理

1. **null/空值（token 不存在）**：credentials.json 无 `ANTHROPIC_API_KEY` 且 `process.env` 也无 → buildSpawnEnv 不写入该键（claude 子进程启动后会自身鉴权失败，由 task-runner 正常 failed 路径处理，spawn-env.ts 不抛错）。**绝不**写入空字符串（避免误判已配置）。

2. **token 不入日志**：spawn-env.ts 内部任何 `console.debug/info/warn` 涉及 env 一律经 `redactEnv`；task-runner.ts:298 start_lease warn、spawn 失败诊断（task-runner.ts:588-599 error 文本）不得 dump env 原文。**违反此条 = 安全事故**，单测覆盖「logger 调用断言 redact」。

3. **token 不入 Redis publish payload**：`submitMessages` 的 messages（task-runner.ts:673）只含 claude 输出事件，绝不含 env；本任务不修改 `_eventToMessage`；单测断言「spawn env 引用不进入任何 submitMessages 调用」。

4. **token 不回传前端**：`complete_lease` result（daemon.ts:654-664）字段为 success/output/error/patch/diff/duration/session_id，不含 env；本任务不修改 complete_lease payload；单测断言「buildSpawnEnv 返回的 env 不被 daemon.ts complete 链路引用」。

5. **token 不序列化到磁盘 / lease.metadata / HTTP**：buildSpawnEnv 返回值仅传给 `spawn(cmdPath, args, { env: spawnEnv })`（task-runner.ts:313-317），不写入任何文件、不经 HTTP 上传、不入 Redis。spawn 完成后 env 引用随 ChildProcess 释放，不被持久化。

6. **env dump 调试场景**：开发者临时 `console.log(spawnEnv)` 排查 → 必须 `console.log(redactEnv(spawnEnv))`；spawn-env.ts 顶部 JSDoc 用粗体警告「禁止直接 console.log(buildSpawnEnv 的返回值）」。

7. **tool_config.env 覆盖 process.env**：若 tool_config.env 含 `PATH` 等系统键 → 覆盖 process.env.PATH，可能破坏 claude 子进程找 binary。buildSpawnEnv **不特殊保护 PATH**（dispatch 侧 task-02 端点应避免下发 PATH），但日志记录 warning「tool_config.env 含系统键 X，可能影响子进程」。

8. **参数不可变**：buildSpawnEnv 不修改入参 `ctx.toolConfig`（credential.buildEnv 已保证不 mutate，spawn-env.ts 同样不 mutate）；redactEnv 不修改入参 env（返回新对象）。

9. **歧义/冲突（API key 与 OAuth 并存）**：credentials.json 同时含 `ANTHROPIC_API_KEY` 和 `CLAUDE_OAUTH_TOKEN` → 两者都注入 env，claude CLI 自身决定优先级（实测 API key 优先）；spawn-env.ts 不做选择，文档化此行为。

## 非目标

- 不重写 `credential.ts buildEnv`（已存在且正确，spawn-env.ts 复用它）。
- 不读 `~/.claude/.credentials.json`（claude CLI 自管，本任务不介入）。
- 不实现 token 轮换 / 过期检测（YAGNI，credentials.json 手动管理）。
- 不做 token 端到端鉴权 e2e 测试（需真 claude + 真 token，单测范围用 env 注入断言即可）。
- 不实现 design B5 stderr 独立日志（P2，独立 change）。

## TDD 步骤

1. 写测试 → `spawn-env.test.ts`：buildSpawnEnv 注入 ANTHROPIC_API_KEY、redactEnv 遮蔽、不泄漏断言（mock logger 抓调用）。
2. 确认失败 → `pnpm vitest run src/__tests__/spawn-env.test.ts` 全红。
3. 写实现 → 新建 spawn-env.ts，改 task-runner.ts:313 调 buildSpawnEnv。
4. 确认通过 → 全绿。
5. 回归 → `cd sillyhub-daemon && pnpm test` 全量。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `test -f sillyhub-daemon/src/spawn-env.ts && grep -n "export function buildSpawnEnv" sillyhub-daemon/src/spawn-env.ts` | 文件存在 + 导出 buildSpawnEnv |
| AC-02 | `grep -n "buildSpawnEnv\|redactEnv" sillyhub-daemon/src/task-runner.ts` | task-runner.ts:313 已改用 buildSpawnEnv（grep 命中） |
| AC-03 | `cd sillyhub-daemon && pnpm vitest run src/__tests__/spawn-env.test.ts` | 全部用例通过（含 token 注入、redact 遮蔽、不泄漏断言 ≥5 条） |
| AC-04 | 测试断言：credentials.json 含 `ANTHROPIC_API_KEY=sk-test` → buildSpawnEnv 返回值含该键 | 断言通过 |
| AC-05 | 测试断言：`redactEnv({ ANTHROPIC_API_KEY: 'sk-test', PATH: '/usr/bin' })` 返回 `ANTHROPIC_API_KEY='***REDACTED***'`，PATH 保留原值 | 断言通过（key 名匹配规则正确） |
| AC-06 | 测试断言：buildSpawnEnv 返回值不被任何 `console.log/info/debug` 原文打印（mock logger，抓调用断言每条 env 相关日志经 redactEnv） | 断言通过 |
| AC-07 | `grep -rn "submitMessages\|complete_lease\|completeLease" sillyhub-daemon/src/spawn-env.ts sillyhub-daemon/src/task-runner.ts \| grep -i "env\|token\|key"` | 无命中（env 不入 submitMessages / complete_lease 链路） |
| AC-08 | 测试断言：process.env 含 `ANTHROPIC_API_KEY` 但 credentials.json 不含 → buildSpawnEnv 从 process.env 兜底注入 | 断言通过（dev 态兼容） |
