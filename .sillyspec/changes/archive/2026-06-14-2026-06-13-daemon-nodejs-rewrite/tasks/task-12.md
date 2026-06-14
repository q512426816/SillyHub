---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-12
title: config（src/config.ts，DaemonConfig + config.json 持久化）
priority: P0
estimated_hours: 2
depends_on: [task-01]
blocks: [task-20, task-21, task-22]
allowed_paths:
  - sillyhub-daemon/src/config.ts
---

# task-12: config（src/config.ts，DaemonConfig + config.json 持久化）

本任务实现 daemon Node.js 重写的**配置持久化层**（Wave 2 基础设施）。负责加载/保存 `~/.sillyhub/daemon/config.json`，管理 server_url / token / runtime_id / workspace_dir / poll_interval 等配置字段，**与 Python 版 `config.py` 行为 1:1 等价**（design G-01）。

Python 版用 `dataclass` + 同步 `open/read/json.load`；Node 版改用 `interface` + `fs/promises`（异步），但对外语义（默认值合并、自动生成 runtime_id、自动建父目录、字段名校验）逐项对齐。

被 task-20（cli 构造 DaemonConfig）、task-21（daemon 读配置）、task-22（task-runner 读 workspace_dir 等）阻塞依赖，因此字段名与默认值必须**零偏差**。

## 修改文件

精确路径（仓库根为 `/Users/qinyi/SillyHub`）：

| 文件 | 动作 | 说明 |
|---|---|---|
| `sillyhub-daemon/src/config.ts` | 新建 | DaemonConfig interface + DEFAULT_CONFIG 常量 + loadConfig/saveConfig + 路径常量 |

> 测试文件 `sillyhub-daemon/tests/config.test.ts` 不在本任务的 `allowed_paths` 内，但 TDD 步骤要求先写测试再写实现。execute 阶段若严格受限，测试可由 task-01 已建好的 tests/ 目录承载，或由 verify 阶段补写。本蓝图在「TDD 步骤」与「接口定义」章节给出测试用例骨架，供 execute 子代理落地。

## 实现要求

### R1. DaemonConfig 字段（与 Python `DEFAULTS` 字典 1:1）

逐字段对照 `sillyhub_daemon/config.py` 第 22-32 行的 `DEFAULTS`：

| 字段 | 类型 | 默认值 | Python 来源 |
|---|---|---|---|
| `server_url` | `string` | `"http://localhost:8000"` | `config.py:23` |
| `token` | `string \| null` | `null` | `config.py:24`（注释：Bearer token for server auth） |
| `runtime_id` | `string` | （首次加载时自动生成 `crypto.randomUUID()`） | `config.py:25`（None → uuid4） |
| `profile` | `string` | `"default"` | `config.py:26` |
| `workspace_dir` | `string` | `path.join(os.homedir(), "sillyhub_workspaces")` | `config.py:27`（`str(Path.home() / "sillyhub_workspaces")`） |
| `poll_interval` | `number` | `30` | `config.py:28` |
| `heartbeat_interval` | `number` | `15` | `config.py:29` |
| `max_concurrent_tasks` | `number` | `5` | `config.py:30` |
| `log_level` | `string` | `"info"` | `config.py:31` |

> **类型严格性**：`token` 与 `runtime_id` 在 Python 中是 `str | None`，TS 必须显式 `string | null`（不用 `string | undefined`），因 `null` 是 JSON 原生 null，往返序列化语义一致。strict 模式下访问 `config.token` 后需 `if (config.token)` 收窄类型，与 Python `if config.token` 等价。

### R2. 配置文件路径（与 Python 一致）

- 默认目录：`path.join(os.homedir(), ".sillyhub", "daemon")`
- 默认文件：`<上面目录>/config.json`
- 等价于 Python `Path.home() / ".sillyhub" / "daemon" / "config.json"`（config.py:15-16）
- 导出常量 `DEFAULT_CONFIG_DIR` 与 `DEFAULT_CONFIG_PATH`，供 cli/daemon 复用（Python 的 `DEFAULT_CONFIG_PATH` 被 `cli.py` 引用）。

> **注意**：Python 用 `Path.home()`，Node 用 `os.homedir()`。两者在 Windows/POSIX 下行为一致（POSIX 读 `$HOME`，Windows 读 `%USERPROFILE%`）。**不**用 `process.env.HOME`（Windows 下可能 undefined）。

### R3. loadConfig（异步加载 + 默认值合并 + 自动生成 runtime_id）

`loadConfig(path?: string): Promise<DaemonConfig>`，行为对齐 Python `_load()`（config.py:41-51）：

1. 浅拷贝 `DEFAULT_CONFIG` 作为起始 `_data`（避免污染常量）。
2. 若文件存在：`fs.readFile` → `JSON.parse` → 用解析结果**浅合并**到 `_data`（`Object.assign` 或展开运算符）。等价 Python `self._data.update(saved)`。
3. 若文件不存在：跳过 step 2，`_data` 即纯默认值。
4. **自动生成 runtime_id**：若 `_data.runtime_id` 为空/null/falsy（`!_data.runtime_id`），赋值 `crypto.randomUUID()` 并立即 `saveConfig()` 落盘。等价 Python config.py:49-51。
5. 返回 `_data` as `DaemonConfig`。

> **异步而非同步**：Python 是同步 `open/read`，阻塞事件循环（daemon 启动时一次性，可接受）。Node 版**故意用异步** `fs/promises`（design G-03 原生异步契合，R-04 流式背压思路延伸到 I/O）。启动时 `await loadConfig()`，不引入同步 API 污染。**不**提供同步版本（YAGNI，Python 同步只是历史包袱）。

### R4. saveConfig（写 JSON + 自动建父目录）

`saveConfig(config: DaemonConfig, path?: string): Promise<void>`，行为对齐 Python `save()`（config.py:53-57）：

1. `path = path ?? DEFAULT_CONFIG_PATH`
2. `fs.mkdir(dirname(path), { recursive: true })`（等价 Python `self._path.parent.mkdir(parents=True, exist_ok=True)`）
3. `fs.writeFile(path, JSON.stringify(config, null, 2), "utf-8")`（等价 Python `json.dump(self._data, f, indent=2)`，indent=2 与 Python 一致，保证 git diff 友好）

### R5. 字段校验策略（最小化，与 Python 行为一致）

Python 版**不做** schema 校验，只在 load 时浅合并默认值（缺字段自动补默认）。Node 版保持一致：

- **不**引入 `zod` / `joi` / `ajv`（违反 design G-05 零/少依赖）。
- 合并后 `runtime_id` 若仍为空才生成 uuid（R3 step 4）。
- `server_url` 若为空字符串：**不**报错（Python 也不报），交由 hub-client 在实际请求时失败。保持 Python「宽容加载，严格使用」策略。

## 接口定义

以下为 `src/config.ts` 的**完整骨架**，execute 子代理可直接照搬，仅需补全实现体（标 `// TODO` 处）。

```typescript
// sillyhub-daemon/src/config.ts
// 替代 sillyhub_daemon/config.py
// 管理 ~/.sillyhub/daemon/config.json 的加载/保存

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// -- 路径常量（对齐 Python config.py:15-16）-------------------------

export const DEFAULT_CONFIG_DIR: string = join(homedir(), '.sillyhub', 'daemon');
export const DEFAULT_CONFIG_PATH: string = join(DEFAULT_CONFIG_DIR, 'config.json');

// -- DaemonConfig interface（字段与 Python DEFAULTS 1:1）------------

/**
 * daemon 配置结构。字段名/默认值逐字对齐
 * sillyhub_daemon/config.py 的 DEFAULTS 字典（config.py:22-32）。
 *
 * 修改本 interface 必须同步检查 Python config.py 是否也改
 * （本重写期间 Python 版仍存活，两边字段须保持一致直到 W5 删除 Python）。
 */
export interface DaemonConfig {
  /** backend 服务地址，默认 http://localhost:8000 */
  server_url: string;
  /** Bearer token，未配置时为 null（首次需 CLI 设置） */
  token: string | null;
  /** runtime 唯一标识，缺失时自动生成 uuid v4 */
  runtime_id: string;
  /** 配置 profile 名，默认 "default" */
  profile: string;
  /** workspace 根目录，默认 ~/sillyhub_workspaces */
  workspace_dir: string;
  /** HTTP 轮询间隔（秒），默认 30 */
  poll_interval: number;
  /** WS 心跳间隔（秒），默认 15 */
  heartbeat_interval: number;
  /** 最大并发任务数，默认 5 */
  max_concurrent_tasks: number;
  /** 日志级别，默认 "info" */
  log_level: string;
}

// -- 默认值常量（runtime_id 占位，load 时真正生成）-------------------

/**
 * 默认配置。runtime_id 用空串占位，loadConfig 检测到空时生成 uuid。
 * 对应 Python DEFAULTS 中 runtime_id=None 的语义。
 *
 * 注意：必须用工厂函数或每次浅拷贝返回，避免调用方污染本常量。
 */
export const DEFAULT_CONFIG: DaemonConfig = {
  server_url: 'http://localhost:8000',
  token: null,
  runtime_id: '',
  profile: 'default',
  workspace_dir: join(homedir(), 'sillyhub_workspaces'),
  poll_interval: 30,
  heartbeat_interval: 15,
  max_concurrent_tasks: 5,
  log_level: 'info',
};

// -- loadConfig（异步加载 + 合并默认 + 自动生成 runtime_id）----------

/**
 * 从 config.json 加载配置。
 *
 * 行为对齐 Python DaemonConfig._load()（config.py:41-51）：
 * 1. 起始 = 浅拷贝 DEFAULT_CONFIG
 * 2. 文件存在 → JSON.parse 后浅合并到 _data
 * 3. runtime_id 为空 → 生成 randomUUID 并立即 saveConfig
 *
 * @param path 配置文件路径，默认 DEFAULT_CONFIG_PATH
 * @returns 合并后的完整配置（所有字段必有值）
 */
export async function loadConfig(
  path: string = DEFAULT_CONFIG_PATH,
): Promise<DaemonConfig> {
  // TODO: 实现 step 1-3
  //   const data: DaemonConfig = { ...DEFAULT_CONFIG };
  //   if (existsSync(path)) {
  //     const raw = await readFile(path, 'utf-8');
  //     const saved = JSON.parse(raw) as Partial<DaemonConfig>;
  //     Object.assign(data, saved);
  //   }
  //   if (!data.runtime_id) {
  //     data.runtime_id = randomUUID();
  //     await saveConfig(data, path);
  //   }
  //   return data;
  throw new Error('not implemented');
}

// -- saveConfig（写 JSON + 自动建父目录）-----------------------------

/**
 * 保存配置到 config.json。
 *
 * 行为对齐 Python DaemonConfig.save()（config.py:53-57）：
 * 1. mkdir 父目录（recursive）
 * 2. writeFile JSON.stringify(config, null, 2)
 *
 * @param config 要保存的配置对象
 * @param path 目标路径，默认 DEFAULT_CONFIG_PATH
 */
export async function saveConfig(
  config: DaemonConfig,
  path: string = DEFAULT_CONFIG_PATH,
): Promise<void> {
  // TODO: 实现 step 1-2
  //   await mkdir(dirname(path), { recursive: true });
  //   await writeFile(path, JSON.stringify(config, null, 2), 'utf-8');
  throw new Error('not implemented');
}
```

> **设计取舍：函数式 vs 类式**：Python 是 `DaemonConfig` 类（属性访问 + 内部状态）。Node 版选**函数式**（`loadConfig` 返回纯对象，`saveConfig` 接收对象）。理由：(1) 函数式更易测试（无隐式 this 状态）；(2) daemon 主类持有 config 对象后只读使用，无需 mutable 属性；(3) design G-05 少依赖、少抽象。若后续 cli 需要 mutable setter（如 `config.token = x; await save(config)`），本接口天然支持（直接改对象再 save），不强制走 setter 方法。

## 边界处理

1. **文件不存在 → 返回默认配置**：`existsSync(path)` 为 false 时，跳过 read，直接返回浅拷贝的 `DEFAULT_CONFIG`（runtime_id 在 step 4 仍会被生成并落盘）。等价 Python config.py:43 的 `if self._path.exists()` 分支。**注意**：用 `existsSync` 而非 `fs/promises` 的 `access` + try/catch，因 existsSync 语义更直观且无性能问题（启动一次性调用）。若 execute 子代理偏好纯异步，可用 `stat(path).then(() => true).catch(() => false)`，两者等价。

2. **JSON 损坏（parse 抛异常）**：Python 版 `json.load` 抛 `JSONDecodeError` 会直接崩溃 daemon 启动。Node 版**保持一致**：让 `JSON.parse` 的 `SyntaxError` 冒泡到调用方（cli 的 try/catch 负责打印友好错误）。**不**在 loadConfig 内吞异常返回默认值——那会让用户的配置静默丢失（违反 G-01 等价原则）。错误信息应包含文件路径，便于用户定位（execute 可在 cli 层 catch 并加路径提示，本任务只保证异常原样抛出）。

3. **缺字段合并默认（部分配置文件）**：用户 config.json 只写了 `{"token": "abc"}`，其余字段缺失。`Object.assign(data, saved)` 会保留 `data` 中已有的默认值（如 server_url=默认），仅覆盖 saved 中存在的键（token）。等价 Python `self._data.update(saved)`。**注意**：`Object.assign` 是浅合并，嵌套对象会被整体替换——但 DaemonConfig 全是扁平字段（string/number/null），无嵌套，浅合并即正确。

4. **路径不可写（权限/磁盘满）**：`writeFile` 或 `mkdir` 抛 `EACCES` / `ENOSPC`。处理：**原样抛出**，让 cli 层捕获并提示「请检查 ~/.sillyhub/daemon 目录权限」。不在 config.ts 内 retry 或降级（YAGNI，daemon 无法写配置应直接停止而非带病运行）。

5. **runtime_id 为空字符串 vs null**：Python `if not self._data.get("runtime_id")` 对 None 和空字符串都触发生成。Node 版用 `if (!data.runtime_id)` 同样覆盖 `""` / `null` / `undefined` 三种 falsy。**但** interface 声明 runtime_id 为 `string`（非 nullable），若用户 config.json 写了 `"runtime_id": null`，`Object.assign` 后 `data.runtime_id` 变为 `null`，TS 类型与运行时不符。处理：合并后**强制** `data.runtime_id = data.runtime_id || ''` 再走 falsy 检查，或直接 `data.runtime_id = data.runtime_id || randomUUID()`。execute 阶段推荐后者（一步到位）。

6. **token 为空（未配置）**：`token: null` 是合法默认值（未配置认证）。loadConfig **不**因 token 为空而报错——hub-client 在首次请求 backend 收到 401 时才提示用户配置 token。等价 Python `token` property 返回 `str | None`。**注意**：TS strict 下，调用方用 `config.token` 前必须 `if (config.token)` 收窄，否则传给 `fetch` 的 `Authorization: Bearer ${config.token}` 会是 `Bearer null`。

7. **并发写（同一文件多次 saveConfig 并行）**：极端情况 cli 同时调两次 save（如快速改配置）。Node `writeFile` 无原子性保证，可能产生截断 JSON。处理：**本任务不实现文件锁**（YAGNI，daemon 是单进程，cli 单线程，并发概率极低）。若后续需要，可改 `writeFile` → `tmpfile + rename` 原子模式，但不在 task-12 范围（留待真实出现问题时再加）。

## 非目标

本任务**明确不做**以下事项（避免越界，留给后续 task）：

- **不做 credential 管理**：`credentials.json`（0600 + `{{USER_*}}` 占位符）属 task-13（credential.ts），本任务只管 config.json。
- **不改 config.json 文件格式**：JSON schema 与 Python 版逐字一致，不新增字段、不改字段名、不加版本号字段（design N-02 不新增功能）。
- **不做配置加密**：config.json 明文存储（token 明文），与 Python 版一致。加密属 task-13 credential 的 0600 权限策略范畴，config 不加密。
- **不引入 schema 校验库**：不装 zod/joi/ajv（design G-05 零/少依赖）。字段校验靠 TS interface + 运行时 falsy 检查，不靠第三方 schema。
- **不做配置热重载/watch**：daemon 启动时 load 一次，运行时 config 对象不可变。改配置需重启 daemon（与 Python 一致）。
- **不做环境变量覆盖**：Python 版硬编码路径、不从 env 读（modules/config.md 明确「不可通过环境变量覆盖」）。Node 版保持一致，**不**支持 `SILLYHUB_CONFIG_PATH` 之类的 env override（除 `loadConfig(path)` 显式传参外）。
- **不写同步 API**：不导出 `loadConfigSync` / `saveConfigSync`（design 原生异步契合，同步 API 在 Node 是反模式）。

## 参考

- Python 源（**核心必读**）：`/Users/qinyi/SillyHub/sillyhub-daemon/sillyhub_daemon/config.py`
  - 第 15-16 行：`DEFAULT_CONFIG_DIR` / `DEFAULT_CONFIG_PATH` 路径常量
  - 第 22-32 行：`DEFAULTS` 字典（字段名、默认值、注释）
  - 第 41-51 行：`_load()` 加载逻辑（文件存在判断、json.load、update 合并、runtime_id 自动生成 + save）
  - 第 53-57 行：`save()` 写入逻辑（mkdir parents + json.dump indent=2）
  - 第 61-119 行：property accessors / get / set / to_dict（Node 版用纯对象替代，不逐个翻译 accessor）
- 本变更设计文档：`/Users/qinyi/SillyHub/.sillyspec/changes/2026-06-13-daemon-nodejs-rewrite/design.md`
  - §6 文件变更清单第 112 行：`sillyhub-daemon/src/config.ts` 替代 `config.py`
  - §8 数据模型第 239 行：config.json 格式说明（server_url / token / runtime_id）
  - §9 兼容策略第 251 行：config.json 格式为「不变项」
- 模块文档：`/Users/qinyi/SillyHub/.sillyspec/docs/sillyhub-daemon/modules/config.md`
  - 契约摘要：DaemonConfig 字段列表、get/set、save、to_dict
  - 注意事项：token/runtime_id 默认 None、set 每次写磁盘、路径硬编码
- Node API 参考：
  - `node:fs/promises` 的 `readFile` / `writeFile` / `mkdir`（替代 Python `open` + `json.load/dump`）
  - `node:fs` 的 `existsSync`（同步存在性检查，启动一次性调用可接受）
  - `node:crypto` 的 `randomUUID()`（替代 Python `uuid.uuid4()`）
  - `node:os` 的 `homedir()`（替代 Python `Path.home()`）
  - `node:path` 的 `join` / `dirname`（替代 Python `Path /` 运算符与 `.parent`）

## TDD 步骤

按「文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收」顺序：

1. **读 Python config.py 确认字段**：逐字段核对 `DEFAULTS`（config.py:22-32）与 R1 表格，确保字段名/默认值/类型 1:1。

2. **写测试骨架** `sillyhub-daemon/tests/config.test.ts`（用例照搬 Python `tests/test_config.py` 若存在，否则按下面 6 个用例新建）：

   ```typescript
   import { describe, it, expect, beforeEach, afterEach } from 'vitest';
   import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
   import { tmpdir } from 'node:os';
   import { join } from 'node:path';
   import { loadConfig, saveConfig, DEFAULT_CONFIG } from '../src/config.js';

   describe('config', () => {
     let tmpDir: string;
     let configPath: string;

     beforeEach(async () => {
       tmpDir = await mkdtemp(join(tmpdir(), 'sillyhub-config-'));
       configPath = join(tmpDir, 'config.json');
     });

     afterEach(async () => {
       await rm(tmpDir, { recursive: true, force: true });
     });

     it('AC-02: 文件不存在时返回默认配置（runtime_id 自动生成）', async () => {
       const cfg = await loadConfig(configPath);
       expect(cfg.server_url).toBe('http://localhost:8000');
       expect(cfg.token).toBeNull();
       expect(cfg.profile).toBe('default');
       expect(cfg.poll_interval).toBe(30);
       expect(cfg.heartbeat_interval).toBe(15);
       expect(cfg.max_concurrent_tasks).toBe(5);
       expect(cfg.log_level).toBe('info');
       expect(cfg.runtime_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
       // 自动生成后应落盘
       const raw = await readFile(configPath, 'utf-8');
       expect(JSON.parse(raw).runtime_id).toBe(cfg.runtime_id);
     });

     it('AC-01: save 后 load 往返一致', async () => {
       const cfg = await loadConfig(configPath);
       cfg.token = 'test-token-123';
       cfg.server_url = 'http://custom:9999';
       cfg.log_level = 'debug';
       await saveConfig(cfg, configPath);

       const reloaded = await loadConfig(configPath);
       expect(reloaded.token).toBe('test-token-123');
       expect(reloaded.server_url).toBe('http://custom:9999');
       expect(reloaded.log_level).toBe('debug');
       expect(reloaded.runtime_id).toBe(cfg.runtime_id); // uuid 不变
     });

     it('缺字段合并默认值（只写 token 的 config.json）', async () => {
       await writeFile(configPath, JSON.stringify({ token: 'partial' }), 'utf-8');
       const cfg = await loadConfig(configPath);
       expect(cfg.token).toBe('partial');
       expect(cfg.server_url).toBe('http://localhost:8000'); // 默认补齐
       expect(cfg.poll_interval).toBe(30); // 默认补齐
       expect(cfg.runtime_id).toMatch(/^[0-9a-f-]{36}$/); // 仍自动生成
     });

     it('runtime_id 已存在时不重新生成', async () => {
       const existing = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
       await writeFile(configPath, JSON.stringify({ runtime_id: existing }), 'utf-8');
       const cfg = await loadConfig(configPath);
       expect(cfg.runtime_id).toBe(existing);
     });

     it('AC-04: save 自动创建父目录', async () => {
       const nested = join(tmpDir, 'a', 'b', 'c', 'config.json');
       const cfg = { ...DEFAULT_CONFIG, runtime_id: 'x' } as any;
       await saveConfig(cfg, nested);
       const raw = await readFile(nested, 'utf-8');
       expect(JSON.parse(raw).runtime_id).toBe('x');
     });

     it('JSON 损坏时抛 SyntaxError（不静默返回默认）', async () => {
       await writeFile(configPath, '{ invalid json', 'utf-8');
       await expect(loadConfig(configPath)).rejects.toThrow(SyntaxError);
     });
   });
   ```

3. **写实现** `sillyhub-daemon/src/config.ts`：照「接口定义」章节骨架补全 TODO 体（取消注释 R3/R4 中的示例代码即可）。

4. **跑测试**：`cd sillyhub-daemon && pnpm test`，6 个用例全绿。

5. **类型检查**：`cd sillyhub-daemon && pnpm typecheck`，零错误。

6. **回归**：确认未破坏 task-01 的工程（`pnpm build` 仍 exit 0）。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `loadConfig` + 改字段 + `saveConfig` + 再 `loadConfig` 往返 | 两次 load 结果字段全等（token/server_url/log_level 等被改字段一致，runtime_id 不变），证明序列化无丢失 |
| AC-02 | 文件不存在时 `loadConfig(不存在的路径)` | 返回对象所有字段等于 DEFAULT_CONFIG 的默认值，且 `runtime_id` 为合法 uuid v4 格式（正则 `^[0-9a-f]{8}-[0-9a-f]{4}-...`）；同时该 uuid 被写入文件（readFile 验证） |
| AC-03 | 对照 Python `config.py:22-32` 的 `DEFAULTS` 逐字段核对 `DaemonConfig` interface 与 `DEFAULT_CONFIG` 常量 | 字段名 1:1（server_url/token/runtime_id/profile/workspace_dir/poll_interval/heartbeat_interval/max_concurrent_tasks/log_level 共 9 个），类型与默认值匹配（token=null, profile="default", poll_interval=30 等），无多余/缺失字段 |
| AC-04 | `saveConfig(cfg, 嵌套不存在的路径/a/b/c/config.json)` | 调用成功 exit 0，`readFile` 能读到写入内容，证明 `mkdir {recursive:true}` 自动建了父目录 a/b/c |
| AC-05 | `cd sillyhub-daemon && pnpm test`（vitest 跑 config.test.ts） | 所有用例通过（至少 6 个用例：默认值、不存在文件、往返、缺字段合并、runtime_id 不重生、JSON 损坏抛错），exit 0 |
| AC-06 | `cd sillyhub-daemon && pnpm typecheck`（tsc --noEmit） | 零错误零警告；特别确认 `token: string \| null` 类型在调用方（如未来 cli）能正确收窄（无 `string \| undefined` 混入） |
| AC-07 | 确认未修改 Python 源 | `git diff --name-only sillyhub-daemon/sillyhub_daemon/` 为空，Python config.py 保持原样（W5 才删 Python） |
| AC-08 | 确认零运行时依赖新增 | `git diff sillyhub-daemon/package.json` 为空或仅 devDependencies 变化；dependencies 仍只有 ws + commander（config.ts 只用 node: 内置模块，无新依赖） |
