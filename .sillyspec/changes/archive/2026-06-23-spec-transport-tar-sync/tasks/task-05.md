---
id: task-05
title: task-runner.ts runLease 改调 spec-sync utility（batch 行为不变，纯重构）（覆盖：D-007@v1）
priority: P1
estimated_hours: 2
depends_on: [task-04]
blocks: []
requirement_ids: []
decision_ids: [D-007@v1]
allowed_paths:
  - sillyhub-daemon/src/task-runner.ts
author: qinyi
created_at: 2026-06-23 11:20:01
---

# task-05：task-runner.ts runLease 改调 spec-sync utility（batch 行为不变，纯重构）

## 1. 目标与范围

把 `sillyhub-daemon/src/task-runner.ts` 中 batch 路径 `runLease` 对 spec 同步私有方法的调用，
全部改为调用 task-04 抽出的 `sillyhub-daemon/src/spec-sync.ts` utility 模块级函数。**核心铁律：
batch runLease 的可观察行为必须与改调前 100% 等价（纯重构，零行为变更）。** 现有 task-runner
测试套件全绿即等价性的充分证据（无需新增 batch 行为测试）。

**具体动作**：
1. 删除 task-runner.ts 的 4 个 spec 同步私有方法：`_pullSpecBundle`（行 1417-1438）、
   `_resolveSpecDir`（行 1444-1449）、`_packSpecDir`（行 1512-1533）、`_extractTar`（行 1464-1505）。
2. 删除 task-runner.ts 模块级 helper（仅服务于上述 4 方法、迁移到 spec-sync.ts 后成死代码）：
   `_readTarString`、`_walkDir`、`_buildTarHeader`（行 1934/1951/1993）。
3. `import { pullSpecBundle, postSpecSync } from './spec-sync'`（resolveSpecDir/packSpecDir/extractTar
   已被 utility 内部封装，runLease 调用点不再直接需要）。
4. runLease 步骤 1.5（行 322-327）：`this._pullSpecBundle(ctx)` → `pullSpecBundle(this.client, wsId, { existingSpecRoot })`。
5. runLease 步骤 8.5（行 480-491）：`this._packSpecDir(specRoot)` + `this.client.postSpecSync(wsId, tarBuf)`
   → `postSpecSync(this.client, wsId, specRoot)`（utility 内部完成 pack + post 两步）。
6. 清理 task-runner.ts 因删除私有方法而变成未使用的 `import`（如 `homedir`/`relative`/`isAbsolute`/
   `dirname`/`rm`/`mkdir`/`writeFile`/`readFile` 中仅服务于已删方法的那些——保留仍被其他代码使用的）。

**本任务严格限定**：只动 `task-runner.ts` 一个文件；不改 batch 任何可观察行为；不碰 interactive
路径（`daemon.ts`，属 task-06）；不碰 spec-sync.ts 本身（属 task-04）。

## 2. 覆盖来源

| 来源 | 章节 | 关联点 |
|---|---|---|
| design.md §5.0 | 核心机制（X-001 修正）：task-runner pull/sync 只在 batch 路径，抽 utility 后 batch 与 interactive 共用 | 本任务改调的根因 |
| design.md §6 | 文件清单「修改 sillyhub-daemon/src/task-runner.ts：runLease 改调 spec-sync utility（batch 行为不变，纯重构）」 | 本任务文件与定性 |
| design.md §7.3 | 「task-runner.ts runLease：纯重构改调 utility，batch 行为不变（步骤 1.5/8.5 逻辑等价）」 | 等价性约束 |
| design.md §10 R-03 | postSpecSync 回传失败仅 warn 不阻塞（对齐 batch task-runner.ts:488-490 容错语义） | 步骤 8.5 失败语义须保持 |
| decisions.md D-007@v1 | scan/stage 走 interactive + 抽 spec-sync utility（batch+interactive 共用）；task-runner runLease 改调 utility（batch 行为不变） | 本任务唯一直接覆盖决策 |
| plan.md task-05 行 | 「task-runner.ts runLease 改调 spec-sync utility（batch 行为不变，纯重构）」（W1, P1, dep task-04, 仅 D-007@v1） | 任务边界 |
| task-04.md §4.3/4.5 | `pullSpecBundle`/`postSpecSync` 函数签名（client 注入、返回值契约） | 改调时对齐的接口 |
| task-04.md §6 | 「task-05 负责 task-runner.ts 改调 + 清理死代码 helper」 | 本任务清理范围来源 |

## 3. 实现要求

### 3.1 import 调整（task-runner.ts 顶部）

新增：
```typescript
import { pullSpecBundle, postSpecSync } from './spec-sync';
```

清理（仅删除断定为「删除私有方法后不再被 task-runner.ts 任何剩余代码引用」的 import；逐一 grep
确认，保守保留有疑义的）：
- `homedir`（仅 `_resolveSpecDir` 用 → 删）
- `relative` / `isAbsolute` / `dirname`（仅 `_extractTar` 用 → 删）
- `rm`（仅 `_pullSpecBundle` 用 → 删）
- `writeFile`（仅 `_extractTar` 用；若 task-runner 其他地方仍用则保留 → grep 确认）
- `readFile`（仅 `_packSpecDir` 用；同上确认）
- 保留 `mkdir`/`join`（runLease 步骤 2 写 CLAUDE.md 仍用 mkdir+join）。

> **保守原则**：每删一个 import 前用 `grep -n "<symbol>" task-runner.ts` 确认除已删方法外零剩余引用。
> tsc `--noEmit` 会兜底报「unused import」或「cannot find name」，以 tsc 通过为准。

### 3.2 步骤 1.5 改调（行 322-327，原 try/catch 包裹保留）

**改调前**（task-runner.ts:322-327）：
```typescript
let specRoot: string | null = null;
try {
  specRoot = await this._pullSpecBundle(ctx);
} catch (e) {
  console.warn('task_runner: spec_bundle_pull_failed', leaseId, e);
}
```

**改调后**：
```typescript
// 步骤 1.5：spec-sync utility pull（task-05 改调，逻辑等价 _pullSpecBundle）。
// wsId/existingSpecRoot 从 ctx 鸭子类型读取（task-07 未合并前的兼容，types.ts 本任务不改）。
let specRoot: string | null = null;
try {
  const wsId = (ctx as { workspaceId?: string }).workspaceId;
  const existingSpecRoot = (ctx as { specRoot?: string }).specRoot;
  specRoot = await pullSpecBundle(this.client, wsId, { existingSpecRoot });
} catch (e) {
  console.warn('task_runner: spec_bundle_pull_failed', leaseId, e);
}
```

**等价性要点**：
- `_pullSpecBundle(ctx)` 内部正是读 `ctx.workspaceId`/`ctx.specRoot` + `this.client`，改调后显式
  传相同三参，语义完全一致。
- `pullSpecBundle` 的 404 容错（task-04 新增 R-02/E-01）**是 task-04 引入的新行为**，但**仅在 tar
  模式首次 scan 时触发**；batch 路径当前因 claim payload 仍透传 spec_root（D-004，本变更不动
  backend lease/context.py 的 batch 透传），`existingSpecRoot` 非空 → `pullSpecBundle` 第一道
  守卫 `if (opts.existingSpecRoot) return null` 直接返回 null，**根本不会走到 getSpecBundle**，
  故 404 容错分支对 batch 路径零影响。此为 batch 行为零变更的关键论证（见 §5 边界 #1）。

### 3.3 步骤 8.5 改调（行 480-491，原 if(specRoot) + try/catch 保留）

**改调前**（task-runner.ts:480-491）：
```typescript
if (specRoot) {
  try {
    const tarBuf = await this._packSpecDir(specRoot);
    if (typeof this.client.postSpecSync === 'function') {
      const wsId = (ctx as { workspaceId?: string }).workspaceId!;
      const resp = await this.client.postSpecSync(wsId, tarBuf);
      console.info('task_runner: spec_sync_ok', leaseId, resp);
    }
  } catch (e) {
    console.warn('task_runner: spec_sync_failed', leaseId, e);
  }
}
```

**改调后**：
```typescript
// 步骤 8.5：spec-sync utility sync（task-05 改调，pack+post 合并到 postSpecSync）。
if (specRoot) {
  try {
    const wsId = (ctx as { workspaceId?: string }).workspaceId!;
    const resp = await postSpecSync(this.client, wsId, specRoot);
    if (resp !== null) {
      console.info('task_runner: spec_sync_ok', leaseId, resp);
    }
  } catch (e) {
    console.warn('task_runner: spec_sync_failed', leaseId, e);
  }
}
```

**等价性要点**：
- `postSpecSync` 内部 = `packSpecDir(specRoot)` + `client.postSpecSync(wsId, tarBuf)`，与原逻辑
  一致；返回值类型 `{ ok, reparsed } | null`（client 未实现 postSpecSync 返回 null）。
- 原 `if (typeof this.client.postSpecSync === 'function')` 守卫被 utility 内部吸收
  （`postSpecSync` 函数内 `if (typeof client.postSpecSync !== 'function') return null`）。
  原代码守卫失败时静默（不 log ok），改调后 utility 返回 null 时 `if (resp !== null)` 同样不 log ok，
  行为等价。
- 失败 catch + warn 日志 key `spec_sync_failed` 保持不变（R-03 容错语义）。
- 成功 log key `spec_sync_ok` 保持不变。

### 3.4 删除私有方法与死代码 helper

删除（含其上方的注释块/JSDoc 一并删）：
- `_pullSpecBundle`（行 1401 注释起始 `// ── task-09 / D-006@v1：spec bundle pull...` 至行 1438）
- `_resolveSpecDir`（行 1440-1449）
- `_extractTar`（行 1451-1505）
- `_packSpecDir`（行 1507-1533）
- 模块级 helper `_readTarString`/`_walkDir`/`_buildTarHeader`（行 1934/1951/1993 附近，grep 定位精确行）

> **删除后须 grep 确认零残留引用**：`grep -n "_pullSpecBundle\|_resolveSpecDir\|_packSpecDir\|
> _extractTar\|_readTarString\|_walkDir\|_buildTarHeader" task-runner.ts` 应无命中（除可能的注释，
> 注释也一并清理）。

### 3.5 鸭子类型兼容（types.ts 本任务不改）

`ctx.workspaceId`/`ctx.specRoot` 仍用 `(ctx as { workspaceId?: string }).workspaceId` 鸭子类型
访问，与改调前完全一致。**不修改 `LeaseCtx` 类型定义**（task-07 的范畴，本任务非目标）。

## 4. 接口定义

### 4.1 改调前后对比（runLease 步骤 1.5 / 8.5）

| 调用点 | 改调前 | 改调后 | 等价性 |
|---|---|---|---|
| 步骤 1.5 pull | `this._pullSpecBundle(ctx)`（私有方法，读 `this.client` + ctx 三字段） | `pullSpecBundle(this.client, wsId, { existingSpecRoot })`（显式传 client + wsId + existingSpecRoot） | 三参数来源与私有方法内部读取的字段完全一致；utility 内部逻辑 = 私有方法逻辑 + 404 容错（batch 因 existingSpecRoot 非空走不到 404 分支） |
| 步骤 8.5 pack | `this._packSpecDir(specRoot)`（私有方法） | 被 `postSpecSync` 内部封装（utility 调 `packSpecDir`） | packSpecDir 逻辑从 _packSpecDir 1:1 迁移（task-04 §4.4） |
| 步骤 8.5 post | `this.client.postSpecSync(wsId, tarBuf)`（直接调 client） | 被 `postSpecSync` 内部封装（utility 调 `client.postSpecSync`） | 同一 client 方法、同一参数 |
| 步骤 8.5 守卫 | `if (typeof this.client.postSpecSync === 'function')`（调用方守卫） | utility 内 `if (typeof client.postSpecSync !== 'function') return null` + 调用方 `if (resp !== null)` | 守卫位置移动，可观察行为等价（未实现时不 log ok） |

### 4.2 RunnerHubClient duck-type 不变

本任务**不改变 `TaskRunner` 依赖的 client 接口形状**。`this.client` 仍须满足现有 duck-type：
- `getSpecBundle(wsId: string): Promise<Buffer>`（pullSpecBundle 内部调）
- `postSpecSync?(wsId: string, tarBuf: Buffer): Promise<{ ok: boolean; reparsed: number }>`（postSpecSync 内部调，可选）

改调前 `this.client` 是 `HubClient` 实例（hub-client.ts 实现 getSpecBundle:694 / postSpecSync:737）；
改调后 `pullSpecBundle(this.client, ...)` / `postSpecSync(this.client, ...)` 把同一实例透传给
utility，utility 内部调用的仍是同一 client 方法。**mock client 兼容性不变**：测试中 mock client
未实现 getSpecBundle/postSpecSync 时，utility 守卫返回 null，与原私有方法守卫行为一致
（`task-runner.ts:1424` `typeof this.client.getSpecBundle !== 'function'` 守卫被 utility 内同等
守卫替换）。

### 4.3 不涉及的新接口

本任务不引入任何新公开接口、不改 `LeaseCtx` 类型、不改 `TaskRunner` 类签名、不改 `runLease`
返回类型 `TaskResult`。唯一外部可观察变化是 task-runner.ts 不再定义 4 个私有方法
（这些方法本就是 `private`，外部不可见）。

## 5. 边界处理（≥5）

| # | 边界场景 | 处理 | 来源 |
|---|---|---|---|
| 1 | **batch 行为与改调前 100% 等价（核心铁律）** | (a) claim payload batch 分支仍透传 spec_root（D-004，本变更不动 backend lease/context.py batch 透传）→ `existingSpecRoot` 非空 → `pullSpecBundle` 第一守卫 return null，走不到 getSpecBundle，404 容错分支零影响；(b) 步骤 1.5/8.5 try/catch + warn 日志 key 不变；(c) `if (specRoot)` 触发条件不变（specRoot 仍为 null，步骤 8.5 实际不触发 pack/post）。**结论：batch 路径 pull 永远返回 null、sync 永远不触发，与改调前完全一致** | design §7.3 / D-004 / D-007@v1 |
| 2 | **`specRoot` 变量语义不变** | 步骤 1.5 后 `specRoot` 仍是「pull 成功返回本地路径 / 否则 null」；步骤 8.5 `if (specRoot)` 触发条件与改调前完全一致。变量名、类型（`string \| null`）、赋值时机不变 | task-runner.ts:322/480 |
| 3 | **步骤 8.5 `if (specRoot)` 触发条件不变** | 改调后仍是 `if (specRoot) { ... }`，specRoot 来源是步骤 1.5 的 `pullSpecBundle` 返回值。batch 路径 specRoot 恒为 null → 步骤 8.5 块恒不执行（与改调前等价） | task-runner.ts:480 |
| 4 | **mock client 兼容（测试不破）** | 现有 task-runner 测试中 mock client 未实现 getSpecBundle/postSpecSync 时：原 `_pullSpecBundle` 行 1424 守卫 return null；改调后 `pullSpecBundle` 内 `typeof client.getSpecBundle !== 'function'` 守卫 return null。两守卫语义等价，mock 行为零变化。postSpecSync 同理（utility 守卫 + 调用方 `if (resp !== null)`） | task-runner.ts:1424 / task-04 §4.3/4.5 |
| 5 | **私有方法删除后无残留引用** | 删除 4 私有方法 + 3 helper 后，`grep -n "_pullSpecBundle\|_resolveSpecDir\|_packSpecDir\|_extractTar\|_readTarString\|_walkDir\|_buildTarHeader" task-runner.ts` 须零命中。tsc `--noEmit` 兜底（未删干净的引用会报 cannot find name） | 本任务 §3.4 |
| 6 | **未使用 import 清理保守化** | 每删一个 import 前用 `grep -n` 确认除已删方法外零剩余引用；有疑义的保留。tsc `noUnusedLocals`/ruff 等若报 unused 再删。避免误删导致其他代码 cannot find name | 本任务 §3.1 |
| 7 | **404 容错对 batch 路径零影响（防误判）** | task-04 给 `pullSpecBundle` 加了 404 容错（R-02/E-01），看似改变行为。但 batch 路径 `existingSpecRoot` 非空 → pullSpecBundle 第一守卫 return null，**根本不调 getSpecBundle**，404 分支不可达。故 404 容错只对 interactive 路径（task-06，existingSpecRoot 为空）生效，batch 零影响。此为「纯重构」定性的关键论证 | task-04 §4.3 + D-004 |
| 8 | **postSpecSync 返回 null 时的 log 行为** | 原代码 `typeof client.postSpecSync === 'function'` 守卫失败 → 不进 if 块、不 log ok。改调后 utility 返回 null → `if (resp !== null)` 不进块、不 log ok。可观察日志等价（无 `spec_sync_ok` 输出） | task-runner.ts:483-487 |

## 6. 非目标

- **不改 batch 任何可观察行为**：本任务是纯重构，runLease 的日志输出、返回值、副作用、与
  backend/client 的交互顺序、错误处理（catch + warn）必须与改调前完全一致。任何行为差异都视为
  本任务失败。
- **不碰 interactive 路径（daemon.ts）**：`_startInteractiveSession` pull / `onSessionEnd` sync
  的接入属 task-06。本任务只动 task-runner.ts。
- **不碰 spec-sync.ts**：utility 本体的实现属 task-04。本任务只消费其导出函数。
- **不改 `LeaseCtx` 类型（types.ts）**：`workspaceId`/`specRoot` 字段的正式化属 task-07 范畴。
  本任务继续用鸭子类型 `(ctx as { workspaceId?: string })` 兼容。
- **不改 backend lease/context.py 的 batch 透传**：batch 路径 claim payload 仍透传 spec_root
  （D-004），本变更不动 backend batch 分支。
- **不新增测试**：纯重构无新行为，现有 task-runner 测试全绿即等价性证明。新增 daemon spec-sync
  测试属 task-09。
- **不做 transport 判断**：task-runner 是 batch 路径，transport 开关只影响 interactive（task-06）。
  task-runner 不读 transport。

## 7. 参考

- task-04 蓝图（spec-sync.ts utility 定义）：`.sillyspec/changes/2026-06-23-spec-transport-tar-sync/tasks/task-04.md`
  - §4.3 `pullSpecBundle(client, wsId, opts?)` 签名
  - §4.5 `postSpecSync(client, wsId, specRoot)` 签名
  - §6 明确「task-05 负责 task-runner.ts 改调 + 清理死代码 helper」
- task-runner.ts 现有实现：
  - 步骤 1.5 pull 调用点：`sillyhub-daemon/src/task-runner.ts:317-327`
  - 步骤 8.5 sync 调用点：`sillyhub-daemon/src/task-runner.ts:476-491`
  - `_pullSpecBundle`：`task-runner.ts:1417-1438`
  - `_resolveSpecDir`：`task-runner.ts:1444-1449`
  - `_extractTar`（含 Tar Slip 防护）：`task-runner.ts:1464-1505`
  - `_packSpecDir`：`task-runner.ts:1512-1533`
  - 模块级 helper `_readTarString`/`_walkDir`/`_buildTarHeader`：`task-runner.ts:1934/1951/1993`
- HubClient 接口：`sillyhub-daemon/src/hub-client.ts`（getSpecBundle:694, postSpecSync:737）
- design.md §7.3（task-runner 纯重构约束）、§10 R-03（sync 失败容错语义）
- decisions.md D-007@v1（本任务唯一直接覆盖决策）

## 8. TDD（回归测试证明 batch 行为不变）

**本任务为纯重构，不新增测试代码**。等价性证明策略 = 现有 task-runner 测试套件全绿。

### 8.1 现有测试作为回归守护

task-runner.ts 现有测试（`sillyhub-daemon/tests/` 下 task-runner 相关 `*.test.ts`）覆盖：
- runLease 正常完成路径（步骤 1-9 全走）
- runLease 各步骤失败容错（包括步骤 1.5 pull 失败 catch、步骤 8.5 sync 失败 catch）
- mock client 未实现 getSpecBundle/postSpecSync 时的守卫行为
- `specRoot` 变量为 null 时步骤 8.5 不触发

**改调后这些测试必须 100% 通过，零修改**。若任何现有测试在改调后失败，说明等价性破坏，
本任务未达标（须排查 utility 调用是否引入行为差异）。

### 8.2 等价性验证命令

```bash
cd sillyhub-daemon
pnpm vitest run tests/task-runner   # 现有 task-runner 测试全绿
pnpm tsc --noEmit                   # 类型检查（含 unused import / cannot find name 兜底）
```

两条命令均通过 = 纯重构等价性成立。

### 8.3 无需新增测试的论证

- 改调前后可观察行为（日志 key、返回值、副作用）完全一致（§4.1 对比表）。
- 404 容错是 task-04 的新行为，但其触发条件（existingSpecRoot 为空）在 batch 路径不可达
  （§5 边界 #7），故 batch 路径无新行为可测。
- interactive 路径的 spec-sync 测试属 task-09（覆盖 404 容错、pull 触发、sync 触发）。

## 9. 验收标准

| AC | 验收项 | 验证方式 |
|---|---|---|
| AC-1 | task-runner.ts 删除 `_pullSpecBundle`/`_resolveSpecDir`/`_packSpecDir`/`_extractTar` 4 私有方法 | `grep -n "_pullSpecBundle\|_resolveSpecDir\|_packSpecDir\|_extractTar" task-runner.ts` 零命中 |
| AC-2 | task-runner.ts 删除模块级 helper `_readTarString`/`_walkDir`/`_buildTarHeader`（死代码清理） | `grep -n "_readTarString\|_walkDir\|_buildTarHeader" task-runner.ts` 零命中 |
| AC-3 | 新增 `import { pullSpecBundle, postSpecSync } from './spec-sync'` | 代码审查 import 区 |
| AC-4 | 步骤 1.5（行 322-327 附近）改调 `pullSpecBundle(this.client, wsId, { existingSpecRoot })`，try/catch + warn 日志 key `spec_bundle_pull_failed` 保持 | 代码审查 + 下方 AC-7 回归测试 |
| AC-5 | 步骤 8.5（行 480-491 附近）改调 `postSpecSync(this.client, wsId, specRoot)`，`if (specRoot)` 触发条件 + catch + warn 日志 key `spec_sync_failed` 保持 | 代码审查 + 下方 AC-7 回归测试 |
| AC-6 | 未使用 import 清理（homedir/relative/isAbsolute/dirname/rm 等仅服务于已删方法的 import 删除；保留 mkdir/join 等仍用的） | `pnpm tsc --noEmit` 无 unused import 报错 |
| AC-7 | **batch 行为零变更（核心 AC）**：现有 task-runner 测试套件 100% 通过、零修改 | `cd sillyhub-daemon && pnpm vitest run tests/task-runner` 全绿 |
| AC-8 | `pnpm tsc --noEmit` 通过（task-runner.ts 类型正确、无残留引用、无 unused import） | tsc 无错 |
| AC-9 | `git diff --name-only` 只含 `sillyhub-daemon/src/task-runner.ts`（本任务 allowed_paths 单文件） | git diff 检查 |
| AC-10 | D-007@v1 覆盖：task-runner runLease 改调 utility（batch 行为不变），与 task-06 interactive 接入共同满足「batch+interactive 共用 spec-sync utility」 | 代码审查 + design §7.3 映射 |
| AC-11 | `specRoot` 变量语义不变（`string \| null`，步骤 1.5 赋值、步骤 8.5 `if (specRoot)` 消费） | 代码审查：变量声明/赋值/消费点与改调前一致 |
| AC-12 | RunnerHubClient duck-type 不变（this.client 仍为 HubClient 实例，mock client 守卫行为等价） | AC-7 回归测试覆盖 mock client 场景 |
