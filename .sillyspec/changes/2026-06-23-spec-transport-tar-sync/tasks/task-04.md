---
id: task-04
title: 新增 spec-sync.ts 共享 utility（pullSpecBundle/packSpecDir/resolveSpecDir/postSpecSync，含首次 pull 404 容错）（覆盖：FR-05, FR-06, D-003@v1, D-007@v1）
priority: P0
estimated_hours: 3
depends_on: []
blocks: [task-05, task-06, task-09]
requirement_ids: [FR-05, FR-06]
decision_ids: [D-003@v1, D-007@v1]
allowed_paths:
  - sillyhub-daemon/src/spec-sync.ts
author: qinyi
created_at: 2026-06-23 11:20:01
---

# task-04：新增 spec-sync.ts 共享 utility

## 1. 目标与范围

新增 `sillyhub-daemon/src/spec-sync.ts`，把 `task-runner.ts` 中现有的 3 个 spec 同步私有方法
抽成**模块级纯函数 utility**，供 batch（`TaskRunner.runLease`，task-05 改调）与 interactive
（`daemon.ts` `_startInteractiveSession`/`onSessionEnd`，task-06 接入）共用。同时新增**首次
pull 404 容错分支**（R-02 / E-01）：tar 模式首次 scan 时 backend 尚无 spec bundle，
`getSpecBundle` 返回 404，utility 容错为「空 spec」——`mkdir -p` 本地目录后返回路径非 null，
保证后续 `postSpecSync` 回传链路能触发。

**核心设计原则（D-007@v1）**：utility 是**纯模块级函数 + client 参数注入**，不依赖
`TaskRunner` 实例（不读 `this.client`/`this.workspace` 等实例状态），使 interactive 路径
（没有 TaskRunner 实例）可直接调用。这是与现有 `_pullSpecBundle(ctx)`（读 `this.client`）
的根本区别。

**本任务只新增文件，不改 task-runner.ts**（task-05 负责 batch 路径改调 utility，纯重构）。
**不改 daemon.ts**（task-06 负责 interactive 接入）。

## 2. 覆盖来源

| 来源 | 章节 | 关联点 |
|---|---|---|
| design.md §5.0 | 核心机制（X-001 修正：spec 同步在 interactive 路径 + 抽 spec-sync utility） | utility 存在的根因 |
| design.md §5.2 | tar 模式 5 步流程（② pull / ④ sync） | `pullSpecBundle`/`postSpecSync` 调用语义 |
| design.md §6 | 文件清单「新增 sillyhub-daemon/src/spec-sync.ts」 | 本任务文件 |
| design.md §7.2 E-01 | 首次 scan pull 404 容错（mkdir 空本地目录） | 404 容错分支 |
| design.md §7.3 | spec-sync utility 4 函数定义 | 函数签名来源 |
| design.md §10 R-02 | 首次 scan backend 无 spec bundle → 404 | 404 容错风险条目 |
| decisions.md D-003@v1 | tar 模式双向同步（回传 + 按需拉取） | pull + sync 两个方向 |
| decisions.md D-007@v1 | 抽 spec-sync utility（batch+interactive 共用） | utility 存在依据、纯函数原则 |
| plan.md task-04 行 | 4 函数 + 404 容错 | 任务边界 |

## 3. 实现要求

1. **新增文件** `sillyhub-daemon/src/spec-sync.ts`，导出 4 个模块级函数：
   `resolveSpecDir`、`pullSpecBundle`、`packSpecDir`、`postSpecSync`。
2. **逻辑从 task-runner.ts 迁移**，行为等价（除新增的 404 容错分支外），来源行号：
   - `_resolveSpecDir`（task-runner.ts:1444-1449）→ `resolveSpecDir`
   - `_pullSpecBundle`（task-runner.ts:1417-1438）→ `pullSpecBundle`（+ 新增 404 容错）
   - `_extractTar`（task-runner.ts:1464-1505，含 Tar Slip 防护）→ 作为模块内 helper 一并迁移
   - `_packSpecDir`（task-runner.ts:1512-1533）→ `packSpecDir`
   - 模块级 helper `_readTarString`/`_walkDir`/`_buildTarHeader`（task-runner.ts:1934/1951/1993）
     → 迁移到 spec-sync.ts 内部（private，不 export）
3. **404 容错分支（R-02 / E-01，本任务唯一新增行为）**：`pullSpecBundle` 捕获 `getSpecBundle`
   抛出的 `HubHttpError` 且 `status === 404` 时，不向上抛错，改为 `mkdir -p resolveSpecDir(wsId)`
   后返回该本地路径（非 null）。其他 status（5xx 等）仍向上抛（由调用方 catch）。
4. **纯函数 + client 注入**：`pullSpecBundle`/`postSpecSync` 的第一个参数是 `HubClient`
   （或最小接口 `{ getSpecBundle(wsId): Promise<Buffer>; postSpecSync?(...): Promise<...> }`），
   **不读 `this.client`**。task-05/06 调用时传各自持有的 client 实例。
5. **不改 task-runner.ts**：本任务 allowed_paths 只有 spec-sync.ts。task-runner.ts 的调用点
   改调（步骤 1.5 行 322-327、步骤 8.5 行 480-491）属 task-05。
6. **task-runner.ts 现有私有方法暂保留**：task-04 提交后 task-runner.ts 仍能编译（旧方法
   不删，task-05 删并改调）。本任务不破坏 task-runner.ts 现有 batch 行为。

## 4. 接口定义

### 4.1 模块依赖（import）

```typescript
import { homedir } from 'node:os';
import { join, relative, isAbsolute, dirname } from 'node:path';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { HubClient, HubHttpError } from './hub-client';
```

> `HubHttpError` 用于 404 容错分支的类型守卫（`err.status === 404`）。`hub-client.ts` 已导出
> `HubHttpError`（`task-runner.ts` 现有 import 一致，确认导出存在；若未导出本任务可顺带补
> `export`，但优先不动 hub-client.ts，通过 `import type` 或 duck-type 守卫）。

### 4.2 `resolveSpecDir(wsId: string): string`

```typescript
/**
 * 计算 workspace spec 本地解包/打包目录：~/.sillyhub/daemon/specs/{wsId}。
 *
 * 迁自 task-runner.ts:1444-1449。wsId 含路径分隔符（/ \）时拒绝（防御性，正常是 UUID，
 * design §5 E-07），抛 Error。与 backend resolve_prompt_spec_root tar 分支输出的
 * `~/.sillyhub/daemon/specs/{ws_id}` 字符串展开后必须一致（R-01：daemon 侧用 homedir()
 * 展开，prompt 侧 tilde 由 daemon 注入 sillyspec 命令前展开）。
 *
 * 纯函数，无 IO，无 client 依赖。
 */
export function resolveSpecDir(wsId: string): string {
  if (!wsId || /[\\/]/.test(wsId)) {
    throw new Error(`invalid workspace_id for spec dir: ${JSON.stringify(wsId)}`);
  }
  return join(homedir(), '.sillyhub', 'daemon', 'specs', wsId);
}
```

**控制流**：
1. 校验 `wsId` 非空且不含 `/` 或 `\`（防路径穿越）→ 否则 throw。
2. 返回 `join(homedir(), '.sillyhub', 'daemon', 'specs', wsId)`。

### 4.3 `pullSpecBundle(client, wsId, opts?): Promise<string | null>`

```typescript
export interface PullSpecBundleOptions {
  /** execution-context 已带 spec_root 时跳过（防御，对齐 task-runner.ts:1423）。 */
  existingSpecRoot?: string | null;
}

/**
 * 从 backend 拉 spec bundle 解到本地 ~/.sillyhub/daemon/specs/{wsId}（覆盖语义）。
 *
 * 迁自 task-runner.ts:1417-1438（_pullSpecBundle），改为纯函数 + client 参数注入。
 * 返回值：
 *   - 成功解包 → 返回本地 specDir 绝对路径（非 null）
 *   - 404 容错（首次 scan，backend 无 bundle）→ mkdir 空本地目录，返回 specDir 路径（非 null）
 *   - 跳过（无 wsId / existingSpecRoot 已有 / client 未实现 getSpecBundle）→ 返回 null
 *
 * 失败语义（除 404 外，向上抛由调用方 catch）：
 *   - getSpecBundle 抛 HubHttpError(status !== 404) → 透传（5xx 等）
 *   - 网络/超时 → 透传
 *   - _extractTar IO 错 / Tar Slip → 透传
 *
 * @param client HubClient 实例（batch=TaskRunner.client，interactive=daemon 持有的 client）
 * @param wsId workspace id（claim payload 透传的 workspaceId）
 * @param opts.existingSpecRoot 防御性跳过（execution-context 已带 spec_root 时）
 */
export async function pullSpecBundle(
  client: HubClient,
  wsId: string | undefined,
  opts: PullSpecBundleOptions = {},
): Promise<string | null> {
  if (!wsId) return null;                                  // server-local / 非 daemon-client
  if (opts.existingSpecRoot) return null;                  // 防御：execution-context 已带
  if (typeof client.getSpecBundle !== 'function') return null; // mock client 未实现

  const specDir = resolveSpecDir(wsId); // wsId 分隔符校验在此（抛错由调用方 catch）

  let tarBuf: Buffer;
  try {
    tarBuf = await client.getSpecBundle(wsId);
  } catch (e) {
    // R-02 / E-01：首次 scan backend 无 spec bundle → 404 容错。
    // mkdir 空本地目录返回 specDir（非 null），保证后续 postSpecSync 链路触发。
    if (isHubHttp404(e)) {
      await mkdir(specDir, { recursive: true });
      console.info('spec_sync: pull_404_empty_created', wsId, specDir);
      return specDir;
    }
    throw e; // 其他 status / 网络错透传
  }

  // 覆盖语义：先 rm -rf（容忍不存在），再解包。
  // Windows EBUSY 降级：忽略 rm 错误，仍 mkdir + 解包（容忍残留，agent 侧覆盖读取）。
  try {
    await rm(specDir, { recursive: true, force: true });
  } catch (e) {
    console.warn('spec_sync: spec_dir_rm_failed', specDir, e);
  }
  await extractTar(tarBuf, specDir);
  return specDir;
}

// 模块内 helper：HubHttpError 404 类型守卫（duck-type，避免硬依赖导出）
function isHubHttp404(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'status' in e &&
    (e as { status: unknown }).status === 404
  );
}
```

**控制流（伪代码）**：
```
if !wsId: return null
if existingSpecRoot: return null
if client.getSpecBundle 不是函数: return null
specDir = resolveSpecDir(wsId)        # wsId 校验失败抛 Error
try:
  tarBuf = await client.getSpecBundle(wsId)
catch e:
  if isHubHttp404(e):                 # ← 本任务新增 R-02/E-01 容错
    mkdir -p specDir
    log info pull_404_empty_created
    return specDir                    # 非 null，后续 postSpecSync 可触发
  throw e                             # 5xx/网络透传
try: rm -rf specDir (force)
catch: warn（EBUSY Windows 降级容忍）
extractTar(tarBuf, specDir)           # mkdir + 解包 + Tar Slip 防护
return specDir
```

### 4.4 `packSpecDir(specDir: string): Promise<Buffer>`

```typescript
/**
 * 把本地 spec 目录整树打包成 tar Buffer（零依赖手工 ustar）。
 *
 * 迁自 task-runner.ts:1512-1533（_packSpecDir）。排除 .runtime 段（与 backend GET bundle
 * 端点约定一致，design §7.2）。仅 regular file + directory；symlink 跳过 + warn。
 * 结尾追加 2×512 zero block。
 *
 * 纯目录打包，无 client 依赖（client 调用在 postSpecSync）。
 */
export async function packSpecDir(specDir: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const entries = await walkDir(specDir);
  for (const e of entries) {
    if (e.relPath.split(/[\\/]/).includes('.runtime')) continue;
    const header = await buildTarHeader(
      e.relPath + (e.isDir ? '/' : ''),
      e.isDir ? 0 : e.size,
      e.isDir,
    );
    chunks.push(header);
    if (!e.isDir) {
      const data = await readFile(e.absPath);
      chunks.push(data);
      const padLen = (512 - (data.length % 512)) % 512;
      if (padLen > 0) chunks.push(Buffer.alloc(padLen, 0));
    }
  }
  chunks.push(Buffer.alloc(1024, 0)); // 2×512 zero block 结尾
  return Buffer.concat(chunks);
}
```

### 4.5 `postSpecSync(client, wsId, specRoot): Promise<{ ok, reparsed } | null>`

```typescript
/**
 * 打包本地 spec 整树并 POST 回传 backend（一次性整树，D-004）。
 *
 * 封装 packSpecDir + client.postSpecSync 两步（task-runner.ts:482-486 等价逻辑抽提）。
 * 返回 backend 响应 { ok, reparsed }；client 未实现 postSpecSync 时返回 null（mock 容错）。
 *
 * 失败语义：网络/HTTP 非 2xx / IO → 向上抛（调用方 catch 后仅 warn 不阻塞，对齐
 * task-runner.ts:488-490 与 design R-03：sync 失败不改写 agent 结果/不阻塞 session 终态）。
 *
 * @param client HubClient（batch/interactive 各自持有的实例）
 * @param wsId workspace id
 * @param specRoot 本地 spec 目录（pullSpecBundle/packSpecDir 返回的路径）
 */
export async function postSpecSync(
  client: HubClient,
  wsId: string,
  specRoot: string,
): Promise<{ ok: boolean; reparsed: number } | null> {
  if (typeof client.postSpecSync !== 'function') return null; // mock client 未实现
  const tarBuf = await packSpecDir(specRoot);
  return client.postSpecSync(wsId, tarBuf);
}
```

### 4.6 模块内 helper（不 export，迁自 task-runner.ts）

- `extractTar(tarBuf, targetDir)`：迁自 `_extractTar`（task-runner.ts:1464-1505）。
  **Tar Slip 防护（design §5 E-05/E-06）完整迁移**：
  - entry.name 含 `..` → throw
  - entry.name 绝对路径（`/` 开头 / win 盘符 `[A-Za-z]:`）→ throw
  - `join` 后 `path.relative(targetDir, fullPath)` 必须不以 `..` 开头、非绝对 → 否则 throw
  - 仅 regular file（typeflag `'0'`/`'\0'`）+ directory（`'5'`）；symlink/其他 → warn + skip
- `walkDir(root)`、`buildTarHeader(...)`、`readTarString(buf)`：迁自 task-runner.ts 模块级
  helper（1951/1993/1934），逻辑等价。

> **迁移后 task-runner.ts 的原 helper 是否删除**：本任务不删（task-05 负责）。task-04 仅在
> spec-sync.ts 内**复制**一份。task-05 改调 utility 后，task-runner.ts 的 `_extractTar`/
> `_walkDir`/`_buildTarHeader`/`_readTarString` 成为死代码，由 task-05 一并清理（避免本任务
> 触碰 task-runner.ts）。若 spec-sync.ts 与 task-runner.ts 同时定义同名 helper 期间有命名
> 冲突——不会，因为它们分属不同模块文件，模块作用域隔离。

## 5. 边界处理（≥5）

| # | 边界场景 | 处理 | 来源 |
|---|---|---|---|
| 1 | **首次 scan pull 404（R-02/E-01，本任务核心新增）** | `getSpecBundle` 抛 `status===404` → `mkdir -p` 空本地目录，返回 specDir 路径（非 null），保证后续 `postSpecSync` 触发；其他 status 透传 | design §7.2 E-01 / §10 R-02 |
| 2 | **wsId 含路径分隔符（路径穿越）** | `resolveSpecDir` 校验 `/[\\/]/` → throw `invalid workspace_id`（正常 UUID 不触发） | task-runner.ts:1445 / §5 E-07 |
| 3 | **Tar Slip（解包路径穿越）** | `extractTar` join 前后双重校验：name 含 `..` / 绝对路径 / win 盘符 → throw；relative 不以 `..` 开头 | task-runner.ts:1484-1491 / §5 E-05/E-06 |
| 4 | **Windows `rm -rf` EBUSY** | `rm(specDir, {recursive, force})` 失败仅 warn 不抛，继续 mkdir + 解包（容忍残留，agent 侧覆盖读取） | task-runner.ts:1431-1435 |
| 5 | **EBUSY 残留目录污染** | 覆盖语义先 rm 再解包；EBUSY 降级后旧文件可能残留，但 agent 读到的是解包后覆盖的同名文件，未覆盖的孤儿文件不阻塞 scan（已知容忍） | task-runner.ts:1429-1430 |
| 6 | **client 为 mock 未实现 getSpecBundle/postSpecSync** | `typeof client.xxx !== 'function'` 守卫 → pull 返回 null / sync 返回 null（测试友好） | task-runner.ts:1424/483 |
| 7 | **existingSpecRoot 防御性跳过** | execution-context 已带 spec_root 时 pull 返回 null（shared 模式 bind mount 路径不走 pull） | task-runner.ts:1423 / D-004 |
| 8 | **symlink/hardlink tar 条目** | extractTar/packSpecDir 跳过 + warn（daemon spec 树不应含） | task-runner.ts:1502-1503/1510 |

## 6. 非目标

- **不改 task-runner.ts**：batch 路径的改调属 task-05（纯重构，步骤 1.5 行 322-327、步骤 8.5
  行 480-491）。本任务 allowed_paths 只含 spec-sync.ts。
- **不改 daemon.ts**：interactive 路径接入（`_startInteractiveSession` pull / `onSessionEnd`
  sync）属 task-06。
- **不改 hub-client.ts**：`getSpecBundle`/`postSpecSync` 已存在（hub-client.ts:694/737），
  本任务只调用。若 `HubHttpError` 未导出，优先用 duck-type 守卫（`'status' in e && e.status===404`）
  避免动 hub-client.ts；确认已导出则 `import type`。
- **不做 transport 判断**：utility 是 transport 无关的纯同步原语，由调用方（task-06 daemon.ts）
  读 `transport === 'tar'` 决定是否调 pull/sync。utility 自身不读 transport。
- **不做增量同步**：整树 tar 一次性回传（D-004），无 diff/增量逻辑。
- **不引入新依赖**：手工 ustar 实现迁移自 task-runner.ts，零第三方 tar 库。

## 7. 参考（task-runner 现有实现）

- `_pullSpecBundle`：`sillyhub-daemon/src/task-runner.ts:1417-1438`
- `_resolveSpecDir`：`task-runner.ts:1444-1449`
- `_extractTar`（含 Tar Slip 防护）：`task-runner.ts:1464-1505`
- `_packSpecDir`：`task-runner.ts:1512-1533`
- 模块级 helper `_readTarString`/`_walkDir`/`_buildTarHeader`：`task-runner.ts:1934/1951/1993`
- runLease 调用点：步骤 1.5 pull（`task-runner.ts:322-327`）、步骤 8.5 sync（`task-runner.ts:480-491`）
- HubClient.getSpecBundle：`sillyhub-daemon/src/hub-client.ts:694`
- HubClient.postSpecSync：`hub-client.ts:737`
- HubHttpError：`hub-client.ts`（getSpecBundle 行 709 抛出，`status` 字段）

## 8. TDD（测试先行，本任务测试代码属 task-09，但 spec-sync.ts 须可独立测试）

spec-sync.ts 设计为**纯函数 + client 注入**，便于 task-09 直接单测（无需构造 TaskRunner 实例）。
task-09 覆盖的测试用例（spec-sync.ts 实现须满足）：

1. `resolveSpecDir('ws-uuid')` → `~/.sillyhub/daemon/specs/ws-uuid`（homedir 展开）。
2. `resolveSpecDir('a/b')` / `resolveSpecDir('')` → throw `invalid workspace_id`。
3. `pullSpecBundle(mockClient, 'ws', {})` 正常 → 调 `getSpecBundle`，rm + extractTar，返回 specDir。
4. **`pullSpecBundle` 404 容错（核心）**：mockClient.getSpecBundle 抛 `{status:404}` → 不抛、
   `mkdir` 本地目录、返回 specDir 路径非 null、不调 extractTar。
5. `pullSpecBundle` 5xx：mockClient.getSpecBundle 抛 `{status:500}` → 透传抛错。
6. `pullSpecBundle` 无 wsId / existingSpecRoot 已有 / mock 无 getSpecBundle → 返回 null。
7. `packSpecDir`：构造含 `.runtime/` + 普通文件的目录 → tar Buffer 不含 `.runtime` 段、含 zero block 结尾。
8. `extractTar` Tar Slip：构造 name=`../escape` 的 tar → throw；name=`/abs` → throw。
9. `postSpecSync`：mockClient.postSpecSync 返回 `{ok:true, reparsed:3}` → 返回该对象；mock 无
   postSpecSync → 返回 null。

> 本任务实现时**先写 spec-sync.ts 骨架 + 上述测试的本地 smoke 验证**（可在 task-09 正式落地
> 前用 `pnpm vitest` 临时跑），确认 4 函数签名与 404 容错分支成立。task-09 负责把测试正式
> 纳入 `sillyhub-daemon/tests/`。

## 9. 验收标准

| AC | 验收项 | 验证方式 |
|---|---|---|
| AC-1 | 新增 `sillyhub-daemon/src/spec-sync.ts`，导出 `resolveSpecDir`/`pullSpecBundle`/`packSpecDir`/`postSpecSync` 4 个函数 | `grep "^export " spec-sync.ts` 命中 4 个 |
| AC-2 | 4 函数为模块级（不依赖 TaskRunner 实例，client 作参数注入） | 代码审查：无 `this.`、函数签名首参为 `client: HubClient` |
| AC-3 | `resolveSpecDir` 输出 `join(homedir(),'.sillyhub','daemon','specs',wsId)`，wsId 含分隔符抛错 | task-09 测试 #1/#2 |
| AC-4 | `pullSpecBundle` 404 容错：`getSpecBundle` 抛 status=404 → mkdir 空目录、返回路径非 null、不抛错（R-02/E-01） | task-09 测试 #4 |
| AC-5 | `pullSpecBundle` 5xx/网络错透传（仅 404 容错） | task-09 测试 #5 |
| AC-6 | Tar Slip 防护完整迁移（name `..`/绝对路径/盘符 → throw；relative 校验） | task-09 测试 #8 |
| AC-7 | `packSpecDir` 排除 `.runtime`、tar 以 2×512 zero block 结尾、仅 regular file+dir | task-09 测试 #7 |
| AC-8 | `postSpecSync` 封装 pack + client.postSpecSync，mock 无实现返回 null | task-09 测试 #9 |
| AC-9 | task-runner.ts 未改动（本任务不触碰，batch 行为不变） | `git diff --name-only` 只含 spec-sync.ts |
| AC-10 | `cd sillyhub-daemon && pnpm tsc --noEmit` 通过（spec-sync.ts 类型正确） | tsc 无错 |
| AC-11 | Windows `rm -rf` EBUSY 降级（rm 失败 warn 不抛，继续 mkdir+解包） | 代码审查：try/catch warn（对齐 task-runner.ts:1431-1435） |
| AC-12 | D-003@v1 双向同步语义：pull（backend→daemon 缓存）+ postSpecSync（daemon→backend 回传）两函数齐全 | 代码审查 + design §7.4 契约映射 |
| AC-13 | D-007@v1：utility 为纯函数，interactive 路径（无 TaskRunner 实例）可调 | AC-2 + task-06 接入验证 |
