---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-13
title: credential（src/credential.ts，0600 权限 + `{{USER_*}}` 渲染）
priority: P0
estimated_hours: 3
depends_on: [task-01]
blocks: [task-19, task-22]
allowed_paths:
  - sillyhub-daemon/src/credential.ts
---

# task-13：credential（src/credential.ts，0600 权限 + `{{USER_*}}` 渲染）

> 本任务是用户密钥不离开本机原则的落地点。server 下发的工具配置模板含 `{{USER_*}}` 占位符，daemon 在本地解析（credentials.json > process.env 优先级）后注入子进程 env；凭证文件落盘后强制 0600 权限（POSIX），Windows 因无 0600 语义降级为仅警告不中断（R-05 / FR-05）。

- Wave：W2（基础设施）
- 依赖：task-01（项目骨架 + `package.json` / `tsconfig.json` / vitest 配置就绪）
- 阻塞：task-19（TaskRunner 调 `buildEnv` 注入子进程 env）、task-22（CLI 通过 `CredentialManager` CRUD 凭证）
- Python 源对照：`sillyhub_daemon/credential.py`（127 行，全文 1:1 迁移）

---

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/credential.ts` | `CredentialManager` class：占位符渲染 + load/save + 0600 + Windows 降级 |

本任务**仅触碰 1 个文件**。单测文件不列入 allowed_paths（开发期验证，放 `tests/credential.test.ts`，验收后保留亦可，不计入变更范围验收）。

---

## 实现要求

1. **占位符渲染**：实现 `renderConfig(config)`，遍历 config 的每个 key-value，对**整个字符串值**匹配 `{{USER_*}}`（`startsWith('{{USER_') && endsWith('}}')`，与 Python 一致——**非子串替换**，整个 value 必须是占位符才解析）。匹配则取出中间 key（`value.slice(2, -2)`，**保留 `USER_` 前缀**，如 `USER_GITHUB_TOKEN`），按优先级查值；不匹配则原样保留。
2. **渲染优先级**：`credentials.json[key]` > `process.env[key]`。注意 Python 用 `or` 短路（空串/undefined 视为 falsy），TS 实现须等价——`cred[key] || process.env[key]`（空串跳到 env，与 Python 行为一致）。两源都无值则**保留原占位符字符串**（不抛错，让调用方 task-19 识别未解析项）。
3. **`loadCredentials`（构造时自动调用）**：读 `~/.sillyhub/daemon/credentials.json`（POSIX 用 `os.homedir()`，与 Python `Path.home()` 等价）。文件不存在则 `_credentials = {}` 并记 info 日志（不抛错，首次使用时文件尚未创建是正常状态）。JSON 解析失败抛错（凭证文件损坏属于配置错误，应让用户感知）。
4. **`saveCredentials`**：先 `mkdir(path.dirname, { recursive: true })`（等价 Python `mkdir(parents=True, exist_ok=True)`），再 `writeFile(path, JSON.stringify(creds, null, 2), 'utf-8')`（indent=2 与 Python `json.dump(indent=2)` 对齐，保证 diff 干净），最后 `fs.chmod(path, 0o600)`。
5. **0600 权限（POSIX）**：`fs.chmod(path, 0o600)`。POSIX（`process.platform !== 'win32'`）下 chmod 成功即 0600（owner rw，group/other 无）。单测须断言权限位为 `0o600`（用 `fs.stat` 取 `mode & 0o777`）。
6. **Windows 降级（R-05 / FR-05）**：`process.platform === 'win32'` 或 chmod 抛错时，**catch 后 `console.warn` 降级警告，不抛错**（与 Python `except OSError: logger.warning` 一致）。Windows NTFS 无 0600 语义，chmod 是 no-op 或抛 EPERM，降级为警告保证流程不中断。
7. **CRUD 方法**：`get(key)` / `set(key, value)`（set 后立即 `save()` 持久化，与 Python 一致）/ `remove(key)`（不存在不抛错，`pop(key, None)` 等价 `delete creds[key]`）/ `listKeys()`。语义逐字对齐 Python。
8. **`buildEnv(config)`**：调 `renderConfig` 后，过滤掉**值仍含 `{{`** 的项（未解析占位符不注入子进程 env，避免泄露原始占位符），key **转大写**（`key.toUpperCase()`），返回 `Record<string, string>`。直接喂给 `subprocess.spawn({ env: { ...process.env, ...built } })`（task-19 调用点）。
9. **构造函数 `credentialsPath?` 参数**：默认 `path.join(os.homedir(), '.sillyhub', 'daemon', 'credentials.json')`。可选参数是为单测注入临时路径（不污染真实 `~/.sillyhub`）。
10. **日志**：复刻 Python `logger.debug/info/warning` 三级。Node 版用 `console.debug/info/warn`（task-01 尚未引入结构化 logger，先 console，后续 task 可替换）。日志 key 与 Python 对齐：`credentials_loaded count=N` / `credentials_file_not_found path=...` / `credential_resolved key=... source=credentials|env` / `credentials_chmod_failed path=...`。

---

## 接口定义

以下是 `sillyhub-daemon/src/credential.ts` 的完整内容（搬砖工照抄即可，类型签名与 Python `credential.py` 逐字对齐）：

```ts
/**
 * credential —— 本地凭证存储与占位符渲染。
 *
 * 设计参考：design §4.2.3（用户密钥不离开本机）。
 * server 只下发含 `{{USER_*}}` 占位符的配置模板，daemon 在本地解析后
 * 注入 agent 子进程 env。凭证文件 `~/.sillyhub/daemon/credentials.json`，
 * 权限 0600（POSIX）。
 *
 * Python 源对照：sillyhub_daemon/credential.py（1:1 迁移）。
 * design.md §10 R-05（0600 跨平台）、requirements FR-05。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/** 默认凭证文件路径：~/.sillyhub/daemon/credentials.json（与 Python DEFAULT_CREDENTIALS_PATH 一致）。 */
export const DEFAULT_CREDENTIALS_PATH = path.join(
  os.homedir(),
  '.sillyhub',
  'daemon',
  'credentials.json',
);

/**
 * 匹配 `{{USER_*}}` 占位符（整个 value 必须是占位符，非子串）。
 * 等价 Python：value.startswith('{{USER_') and value.endswith('}}')。
 *
 * 注意：用显式 startsWith/endsWith 判断，**不用正则**——
 * Python 源就是字符串前后缀判断，正则化会引入转义边界 bug。
 */
function isUserPlaceholder(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('{{USER_') &&
    value.endsWith('}}')
  );
}

/**
 * 本地凭证管理器。
 *
 * 职责：
 *   1. 加载/保存 `~/.sillyhub/daemon/credentials.json`（0600 权限）；
 *   2. CRUD（get/set/remove/listKeys），set/remove 立即持久化；
 *   3. 渲染配置中的 `{{USER_*}}` 占位符（renderConfig）；
 *   4. 转成子进程 env 字典（buildEnv，key 大写，过滤未解析项）。
 *
 * 优先级（与 Python 一致）：credentials.json > process.env > 保留原占位符。
 */
export class CredentialManager {
  private readonly _path: string;
  private _credentials: Record<string, string> = {};

  /**
   * @param credentialsPath 可选，默认 DEFAULT_CREDENTIALS_PATH。单测注入临时路径。
   */
  constructor(credentialsPath?: string) {
    this._path = credentialsPath ?? DEFAULT_CREDENTIALS_PATH;
    this._load();
  }

  // -- persistence -----------------------------------------------------------

  /** 加载凭证文件。文件不存在则空字典（info 日志，不抛错）。JSON 损坏抛错。 */
  private _load(): void {
    if (fs.existsSync(this._path)) {
      const raw = fs.readFileSync(this._path, 'utf-8');
      this._credentials = JSON.parse(raw) as Record<string, string>;
      console.debug(`credentials_loaded count=${Object.keys(this._credentials).length}`);
    } else {
      console.info(`credentials_file_not_found path=${this._path}`);
    }
  }

  /**
   * 保存凭证到文件，设 0600 权限（POSIX）。
   * Windows 或 chmod 失败时降级为警告（R-05 / FR-05），不抛错。
   */
  save(): void {
    fs.mkdirSync(path.dirname(this._path), { recursive: true });
    fs.writeFileSync(this._path, JSON.stringify(this._credentials, null, 2), 'utf-8');
    try {
      fs.chmodSync(this._path, 0o600);
    } catch (e) {
      // POSIX 下 chmod 失败属异常（权限/只读 fs），仍降级为警告保证流程不中断。
      // Windows NTFS 无 0600 语义，chmod 抛 EPERM 是预期行为（R-05）。
      console.warn(`credentials_chmod_failed path=${this._path} err=${(e as Error).message}`);
    }
  }

  // -- CRUD ------------------------------------------------------------------

  get(key: string): string | undefined {
    return this._credentials[key];
  }

  /** 设置凭证并立即持久化（save）。 */
  set(key: string, value: string): void {
    this._credentials[key] = value;
    this.save();
  }

  /** 移除凭证并立即持久化。key 不存在不抛错（与 Python pop(key, None) 一致）。 */
  remove(key: string): void {
    delete this._credentials[key];
    this.save();
  }

  listKeys(): string[] {
    return Object.keys(this._credentials);
  }

  // -- placeholder rendering -------------------------------------------------

  /**
   * 渲染 config 中的 `{{USER_*}}` 占位符。
   *
   * 解析顺序（与 Python render_config 一致）：
   *   1. 本地 credentials.json
   *   2. 同名环境变量
   * 两源都无值则**保留原始占位符字符串**（让调用方 buildEnv 过滤掉）。
   *
   * 注意：整个 value 必须是占位符（`{{USER_XXX}}`），**不做子串替换**。
   * key 取出保留 `USER_` 前缀（如 `USER_GITHUB_TOKEN`），不是 `GITHUB_TOKEN`。
   *
   * 优先级用 `||` 短路：与 Python `credentials.get(k) or os.environ.get(k)`
   * 行为一致——空串视为 falsy，跳到下一源。
   */
  renderConfig<T extends Record<string, unknown>>(config: T): Record<string, unknown> {
    const rendered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (isUserPlaceholder(value)) {
        const envVar = value.slice(2, -2); // strip {{ }}
        const resolved = this._credentials[envVar] || process.env[envVar];
        if (resolved !== undefined) {
          rendered[key] = resolved;
          const source = envVar in this._credentials ? 'credentials' : 'env';
          console.debug(`credential_resolved key=${key} source=${source}`);
        } else {
          // 未解析保留原占位符（buildEnv 会过滤）
          rendered[key] = value;
        }
      } else {
        rendered[key] = value;
      }
    }
    return rendered;
  }

  /**
   * 把渲染后的 config 转成子进程 env 字典。
   *
   * 规则（与 Python build_env 一致）：
   *   1. 先 renderConfig；
   *   2. 过滤掉值仍含 `{{` 的项（未解析占位符不注入 env，避免泄露模板）；
   *   3. key 转大写（subprocess env 约定大写）。
   *
   * 调用点：task-19 TaskRunner 在 spawn agent 前调本方法，
   * 与 process.env 合并后传给子进程。
   */
  buildEnv(config: Record<string, unknown>): Record<string, string> {
    const rendered = this.renderConfig(config);
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(rendered)) {
      if (typeof value === 'string' && !value.startsWith('{{')) {
        env[key.toUpperCase()] = value;
      }
    }
    return env;
  }
}
```

---

## 边界处理

| 编号 | 边界场景 | 处理策略 |
|---|---|---|
| **B-01** | 占位符对应的凭证在 credentials.json 和 process.env 都不存在 | **保留原占位符字符串**（如 `{{USER_GITHUB_TOKEN}}` 原样返回）。与 Python 一致——不抛错，让 buildEnv 过滤掉未解析项，避免子进程收到原始模板字符串。日志级别 debug（已解析才打 resolved，未解析静默）。 |
| **B-02** | credentials.json 文件不存在（首次使用） | `_load` 检测到不存在则 `_credentials = {}`，记 info 日志 `credentials_file_not_found`，**不抛错**。首次 `set` 时 `save` 会 `mkdir(parents)` 并创建文件。这是正常首次使用路径，不能报错阻塞。 |
| **B-03** | credentials.json 存在但 JSON 损坏（语法错） | `_load` 中 `JSON.parse` 抛 `SyntaxError`，**向上抛**（不 catch）。理由：凭证文件损坏属配置错误，应让用户感知并修复，静默吞掉会导致凭证丢失。task-22 CLI 启动时捕获并提示用户。 |
| **B-04** | Windows 下 `fs.chmodSync(0o600)` 抛 EPERM | **catch 后 `console.warn` 降级，不抛错**（与 Python `except OSError: logger.warning` 一致）。Windows NTFS 无 0600 语义，chmod 是 no-op 或 EPERM，降级保证流程不中断（R-05 / FR-05）。单测用 `Object.defineProperty(process, 'platform', ...)` mock win32 验证。 |
| **B-05** | 占位符嵌套（如 `{{USER_{{USER_X}}}}`）或值含多个占位符（`prefix_{{USER_A}}_{{USER_B}}`） | **不解析**。`isUserPlaceholder` 要求整个 value 是 `{{USER_...}}`（前后缀同时匹配），嵌套/多占位符/子串占位符均不匹配，原样保留。与 Python `startswith + endswith` 行为一致——Python 也不做子串替换。若未来需要子串渲染，另开任务改契约（N-13-3 排除）。 |
| **B-06** | 凭证值含特殊字符（JSON 转义、`}}`、换行、引号） | `JSON.stringify` 自动转义，load 时 `JSON.parse` 还原，往返无损。值含 `}}` 不影响 `isUserPlaceholder`（判断的是 config 模板的 value，不是凭证值）。值含换行/引号正常存取，注入 env 时由子进程自行处理。 |
| **B-07** | credentials.json 是数组而非对象（用户手改坏格式） | `JSON.parse` 成功但类型不是 `Record<string, string>`。本任务**不做 schema 校验**（N-13-2 排除），运行时 `_credentials[arrKey]` 会取到 undefined，等价 B-01 未解析。若需强校验，task-22 CLI 层加 zod schema（不在本任务）。 |
| **B-08** | `set` 同 key 覆盖旧值 | 直接 `this._credentials[key] = value` 覆盖，再 `save()`。与 Python `dict[k]=v` 一致，无版本/历史保留。本项目未上线，数据可清空（CLAUDE.md 规则 7），不需要凭证历史。 |

---

## 非目标

本任务**不做**以下事项（明确排除，防止 scope creep）：

- **N-13-1**：不加密凭证文件（不做 vault / AES / OS keychain 集成）。0600 权限是唯一保护，明文 JSON 存储，与 Python 版一致。加密是未来增强，不在本次重写范围（design N-02 不新增功能）。
- **N-13-2**：不对 credentials.json 做 schema 强校验（zod / json-schema）。信任文件格式为 `Record<string, string>`，损坏由 JSON.parse 抛错兜底（B-03），类型不符静默降级（B-07）。
- **N-13-3**：不支持子串渲染（`prefix_{{USER_A}}_suffix`）。整个 value 必须是占位符才解析，与 Python 一致。子串渲染需改 server 端模板生成逻辑，是契约变更。
- **N-13-4**：不修改凭证文件格式（仍是 `Record<string, string>` JSON，indent=2）。与 Python 版完全兼容，不引入迁移（design N-05 不改文件格式）。
- **N-13-5**：不管理 token 生命周期（过期检测 / 自动刷新）。token 是用户自己维护的字符串，daemon 只存取。token 轮换在 task-22 CLI 提供入口，逻辑是用户驱动。
- **N-13-6**：不实现 token 在 task-12（agent_detector）。task-12 用 `process.env` 探测 provider，**不读 credentials.json**（探测是环境扫描，不依赖用户配置的凭证）。本任务只暴露 `CredentialManager`，task-12 不 import。
- **N-13-7**：不引入结构化 logger（pino / winston）。先用 `console.debug/info/warn`，后续 task 统一替换（避免本任务拉依赖）。

---

## 参考

- **Python 源**：`sillyhub-daemon/sillyhub_daemon/credential.py`（127 行，全文 1:1 迁移）
  - `DEFAULT_CREDENTIALS_PATH`（L22）：`Path.home() / '.sillyhub/daemon/credentials.json'` → TS `path.join(os.homedir(), ...)`。
  - `__init__` / `_load`（L35-49）：构造自动加载，文件不存在空字典 + info 日志。
  - `save`（L51-59）：`mkdir(parents=True)` + `json.dump(indent=2)` + `os.chmod(S_IRUSR|S_IWUSR)` + `except OSError: warning`。
  - `get/set/remove/list_keys`（L63-79）：CRUD，set/remove 立即 save。
  - `render_config`（L83-112）：`startswith('{{USER_') + endswith('}}')` 整值匹配，`value[2:-2]` 取 key，`creds.get(k) or os.environ.get(k)` 优先级，未解析保留原值。
  - `build_env`（L114-126）：renderConfig 后过滤含 `{{` 的项，key 转大写。
- **design.md**：
  - §4.2.3 用户密钥不离开本机（本任务的设计原则依据）
  - §10 R-05（credential 0600 跨平台风险，P2，应对：`fs.chmod(0o600)` + Windows 降级警告 + 单测验证 POSIX 权限位）—— **本任务承载 R-05 风险验证**
  - L240 凭证文件路径与格式约定（`~/.sillyhub/daemon/credentials.json`，`Record<string, string>`，0600）
  - L251 不变项（credential.json 格式 + `{{USER_*}}` 占位符语义不变）
- **requirements.md**：
  - FR-05（L50-53）：Given 占位符 → When 渲染 → Then credentials.json 优先 env + 文件 0600
  - G-02 兼容性（credential.json 格式不变）
  - 跨平台（POSIX 0600，Windows 降级警告）
- **模块文档**：`.sillyspec/docs/sillyhub-daemon/modules/credential.md`
  - 「契约摘要」：`CredentialManager(credentials_path?)` + CRUD + save + render_config + build_env（本任务的接口清单来源）
  - 「注意事项」：Windows 0600 可能不生效（对应 B-04）；占位符格式固定 `{{USER_*}}`（对应 B-05）；build_env key 转大写（对应实现要求 8）；被 cli 和 task-runner 使用（对应 blocks）。
- **plan.md**：W2 task-13 行「`{{USER_*}}` 渲染 + credentials.json > env 优先级 + 0600 权限（POSIX）/ Windows 降级警告」。

---

## TDD 步骤

遵循 CLAUDE.md「文档→读代码→写测试→写实现→跑测试→验收」。测试文件 `tests/credential.test.ts`（开发期验证，验收后保留）。

### 1. 占位符渲染各场景

```ts
// tests/credential.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:fs';
import { CredentialManager } from '../src/credential.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-test-'));
const credPath = path.join(tmpDir, 'credentials.json');

beforeEach(() => {
  // 每个用例独立凭证文件
  if (fs.existsSync(credPath)) fs.unlinkSync(credPath);
});

describe('renderConfig', () => {
  it('占位符 → credentials.json 命中（优先级 1）', () => {
    fs.writeFileSync(credPath, JSON.stringify({ USER_GITHUB_TOKEN: 'cred_value_123' }));
    const cm = new CredentialManager(credPath);
    const out = cm.renderConfig({ GITHUB_TOKEN: '{{USER_GITHUB_TOKEN}}' });
    expect(out.GITHUB_TOKEN).toBe('cred_value_123');
  });

  it('占位符 → credentials.json 无 + env 命中（优先级 2）', () => {
    process.env.USER_OPENAI_KEY = 'env_value_456';
    fs.writeFileSync(credPath, JSON.stringify({})); // 空凭证
    const cm = new CredentialManager(credPath);
    const out = cm.renderConfig({ OPENAI_KEY: '{{USER_OPENAI_KEY}}' });
    expect(out.OPENAI_KEY).toBe('env_value_456');
    delete process.env.USER_OPENAI_KEY;
  });

  it('占位符 → 两源都无 → 保留原占位符', () => {
    fs.writeFileSync(credPath, JSON.stringify({}));
    const cm = new CredentialManager(credPath);
    const out = cm.renderConfig({ X: '{{USER_MISSING}}' });
    expect(out.X).toBe('{{USER_MISSING}}');
  });

  it('非占位符值原样保留', () => {
    const cm = new CredentialManager(credPath);
    const out = cm.renderConfig({ a: 'plain', b: 123, c: '{{OTHER}}', d: 'pre_{{USER_X}}' });
    expect(out).toEqual({ a: 'plain', b: 123, c: '{{OTHER}}', d: 'pre_{{USER_X}}' });
  });

  it('credentials.json 空串 → 降级到 env（Python or 语义）', () => {
    fs.writeFileSync(credPath, JSON.stringify({ USER_K: '' }));
    process.env.USER_K = 'env_val';
    const cm = new CredentialManager(credPath);
    const out = cm.renderConfig({ K: '{{USER_K}}' });
    expect(out.K).toBe('env_val'); // 空串 falsy，跳到 env
    delete process.env.USER_K;
  });
});
```

### 2. buildEnv（key 大写 + 过滤未解析）

```ts
describe('buildEnv', () => {
  it('过滤未解析占位符 + key 转大写', () => {
    fs.writeFileSync(credPath, JSON.stringify({ USER_A: 'va' }));
    const cm = new CredentialManager(credPath);
    const env = cm.buildEnv({ api_key: '{{USER_A}}', missing: '{{USER_NOPE}}', plain: 'p' });
    expect(env).toEqual({ API_KEY: 'va', PLAIN: 'p' }); // missing 被过滤
    expect(env.MISSING).toBeUndefined();
  });
});
```

### 3. save 后权限验证（POSIX）

```ts
describe('save 权限（POSIX）', () => {
  it('写入后文件权限为 0600', () => {
    const isPosix = process.platform !== 'win32';
    if (!isPosix) return; // Windows 跳过
    const cm = new CredentialManager(credPath);
    cm.set('USER_K', 'v');
    const stat = fs.statSync(credPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});
```

### 4. Windows 降级用 mock platform

```ts
describe('Windows chmod 降级', () => {
  it('process.platform=win32 时 chmod 失败仅 warn 不抛', () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 强制 chmod 抛错
    vi.spyOn(fs, 'chmodSync').mockImplementation(() => { throw new Error('EPERM'); });
    const cm = new CredentialManager(credPath);
    expect(() => cm.set('USER_K', 'v')).not.toThrow(); // 不抛
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('credentials_chmod_failed'));
    warnSpy.mockRestore();
    vi.restoreAllMocks();
    if (origPlatform) Object.defineProperty(process, 'platform', origPlatform);
  });
});
```

### 5. load 边界（文件不存在 / JSON 损坏）

```ts
describe('load 边界', () => {
  it('文件不存在 → 空字典不抛', () => {
    const noFile = path.join(tmpDir, 'nope.json');
    expect(() => new CredentialManager(noFile)).not.toThrow();
    expect(new CredentialManager(noFile).listKeys()).toEqual([]);
  });
  it('JSON 损坏 → 抛 SyntaxError', () => {
    fs.writeFileSync(credPath, '{ invalid json }}}');
    expect(() => new CredentialManager(credPath)).toThrow(SyntaxError);
  });
});
```

### 6. 跑验证

```bash
cd sillyhub-daemon
npx tsc --noEmit                  # AC-06: 零错误
npx vitest run tests/credential.test.ts   # AC-05: 全绿
```

---

## 验收标准

| 编号 | 验收项 | 验证方法 | 通过标准 |
|---|---|---|---|
| **AC-01** | 占位符渲染优先级：credentials.json > process.env | `npx vitest run tests/credential.test.ts` 中 renderConfig 三个用例 | credentials.json 有值用 cred；cred 无值用 env；两源都无保留原占位符；空串走 env（Python `or` 语义） |
| **AC-02** | `saveCredentials` 写入后文件权限 0600（POSIX） | POSIX 下 `fs.statSync(path).mode & 0o777 === 0o600`（TDD §3） | 断言通过；仅在 `process.platform !== 'win32'` 验证 |
| **AC-03** | Windows chmod 失败降级为警告不中断 | mock `process.platform='win32'` + `fs.chmodSync` 抛 EPERM（TDD §4） | `set` 不抛错；`console.warn` 命中 `credentials_chmod_failed` |
| **AC-04** | 缺凭证处理与 Python 一致 | renderConfig 未解析保留原占位符 + buildEnv 过滤（TDD §1+§2） | 未解析项保留 `{{USER_*}}`；buildEnv 不含该 key |
| **AC-05** | vitest 全绿 | `npx vitest run tests/credential.test.ts` | 全部用例 pass（renderConfig×5 + buildEnv×1 + save 权限×1 + Windows 降级×1 + load 边界×2） |
| **AC-06** | tsc 零错误 | `cd sillyhub-daemon && npx tsc --noEmit` | 退出码 0，无 error/warning |
| **AC-07** | 接口签名与 Python 对齐 | `grep` src/credential.ts | 含 `renderConfig` / `buildEnv` / `save` / `get` / `set` / `remove` / `listKeys` 七个方法 + `isUserPlaceholder` 用 startsWith/endsWith（非正则） |
| **AC-08** | 默认路径与 Python 一致 | `grep DEFAULT_CREDENTIALS_PATH src/credential.ts` | `path.join(os.homedir(), '.sillyhub', 'daemon', 'credentials.json')` |
| **AC-09** | 仅触碰 allowed_paths | `git diff --name-only` | 只有 `sillyhub-daemon/src/credential.ts`（测试文件 tests/credential.test.ts 若保留计入开发期，验收不强制删） |
| **AC-10** | R-05 风险验证落地 | review 边界 B-04 + TDD §3+§4 + AC-02+AC-03 | 0600 POSIX 正常 + Windows 降级警告两条路径均有单测覆盖，R-05 关闭条件满足 |
