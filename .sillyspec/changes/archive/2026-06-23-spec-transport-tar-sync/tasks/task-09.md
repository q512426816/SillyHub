---
id: task-09
title: daemon spec-sync + interactive 接入 + backend claim tar 透传测试（覆盖：FR-04, FR-05, FR-06, D-007@v1）
priority: P0
estimated_hours: 3
depends_on: [task-03, task-04, task-06]
blocks: [task-12]
requirement_ids: [FR-04, FR-05, FR-06]
decision_ids: [D-007@v1]
allowed_paths:
  - sillyhub-daemon/tests/
  - backend/app/modules/daemon/tests/
author: qinyi
created_at: 2026-06-23 11:20:01
---

# task-09：daemon spec-sync + interactive 接入 + backend claim tar 透传测试

## 1. 目标与范围

本任务是 `2026-06-23-spec-transport-tar-sync` 的**测试守护任务**，针对 X-001 修正后的
**interactive spec-sync 核心链路**（D-007@v1）落地三组独立单元测试，**不实现任何产品代码**：

- **测试组 A（daemon spec-sync utility 纯函数单测）**：覆盖 task-04 新增的 `spec-sync.ts`
  4 个函数（`resolveSpecDir`/`pullSpecBundle`/`packSpecDir`/`postSpecSync`），含**首次 pull
  404 容错**（R-02/E-01）、**Tar Slip 防护**、`.runtime` 排除打包。框架：vitest。
- **测试组 B（daemon.ts interactive 接入集成测试）**：覆盖 task-06 的两处接入点
  （`_startInteractiveSession` tar 模式 pull + `onSessionEnd` tar 模式 sync），含**时序守护**
  （pull 在 driver 启动前 await 完成、sync 在 notifySessionEnd 之后）、**R-03 容错守护**
  （pull/sync 失败仅 warn 不阻塞 session 启动/终态上报）、**shared 模式零触发守护**（D-004）。
  框架：vitest + mock SessionManager/client。
- **测试组 C（backend `build_claim_payload` tar 透传单测）**：覆盖 task-03 的 interactive
  分支 transport 分流——tar 模式透传 `workspace_id`+`transport`、**不透传** `spec_root`；
  shared 模式现状不变。框架：pytest，沿用现有 `test_lease_service.py` 的
  `TestBuildClaimPayloadInteractiveSpecRoot` 测试类风格。

**铁律**：守护 **X-001 修正后的核心链路**——spec 同步在 **interactive 路径**（非 task-runner
batch 路径），通过 `_startInteractiveSession` pull + `onSessionEnd` sync 实现，backend 经
`build_claim_payload` 透传 `workspaceId`+`transport` 触发。任一环节回归（如有人误把 spec 同步
挪回 task-runner、或 build_claim_payload 漏透传 workspaceId）→ 对应用例 fail。

## 2. 修改文件（均为新增测试文件）

| 操作 | 文件路径 | 测试组 | 框架 | 守护对象 |
|---|---|---|---|---|
| 新增 | `sillyhub-daemon/tests/spec-transport-tar-sync/spec-sync.test.ts` | A | vitest | task-04 `spec-sync.ts` 4 函数 + 404 容错 + Tar Slip |
| 新增 | `sillyhub-daemon/tests/spec-transport-tar-sync/daemon-interactive-spec-sync.test.ts` | B | vitest | task-06 `_startInteractiveSession` pull + `onSessionEnd` sync |
| 新增 | `backend/app/modules/daemon/tests/test_lease_claim_transport.py` | C | pytest | task-03 `build_claim_payload` interactive tar 透传 |

> **路径修正说明**：现有 `build_claim_payload` 测试位于 `backend/app/modules/daemon/tests/
> test_lease_service.py`（非 `backend/tests/modules/daemon/`，plan.md 调用点搜索记录的路径
> 前缀不精确）。frontmatter `allowed_paths` 按真实目录 `backend/app/modules/daemon/tests/`
> 声明。测试组 C 新增独立文件 `test_lease_claim_transport.py`，与现有
> `TestBuildClaimPayloadInteractiveSpecRoot` 类（shared 模式 specRoot 透传）解耦，避免单文件
> 膨胀 + 职责清晰。

> **daemon 测试文件命名**：使用本变更 slug 前缀子目录 `spec-transport-tar-sync/`，**避免与现有
> `task-09-spec-pull-push.test.ts`（变更 `2026-06-22-agent-run-pipeline-fix` 遗留，测 batch
> TaskRunner.runLease 路径）命名/语义冲突**——本任务测的是 **interactive 路径 + spec-sync
> utility**，与遗留文件测的 batch 路径正交。

## 3. 覆盖来源

| 来源 | 章节 | 关联点 |
|---|---|---|
| design.md §5.0 | X-001 修正：spec 同步在 interactive 路径 + 抽 spec-sync utility | 本任务守护的核心链路 |
| design.md §5.2 | tar 模式 5 步流程（② pull / ④ sync / ⑤ apply_sync） | 测试组 A/B 覆盖 ②④ |
| design.md §7.2 E-01 | 首次 scan pull 404 容错（mkdir 空本地目录） | 测试组 A 用例 A4 |
| design.md §7.2 | build_claim_payload interactive 分支 tar 透传伪代码 | 测试组 C 断言契约 |
| design.md §7.4 | 生命周期契约表（pull/post spec sync/build_claim_payload 三事件） | 三组的必需字段断言来源 |
| design.md §10 R-02 | 首次 scan backend 无 spec bundle → 404 | 测试组 A 用例 A4 |
| design.md §10 R-03 | postSpecSync 失败仅 warn 不阻塞 session 终态上报 | 测试组 B 用例 B4/B6 |
| design.md §10 R-07 | pull/sync 与 SessionManager 生命周期时序 | 测试组 B 时序断言 B1/B5 |
| design.md §13 X-001 | scan/stage 走 interactive 不经 task-runner | 测试组 B 存在的根因（守护 interactive 路径） |
| decisions.md D-003@v1 | tar 模式双向同步（回传 + 按需拉取） | 测试组 A（pull+sync 两函数）+ B（两接入点） |
| decisions.md D-004@v1 | shared 模式保持现状（不 pull 不 sync） | 测试组 B 用例 B2/B7 + C 用例 C2（零触发守护） |
| decisions.md D-007@v1 | spec 同步在 interactive 路径 + 抽 spec-sync utility | 全任务基线（X-001 修正） |
| task-04.md §8 | spec-sync.ts 测试用例 #1-#9 | 测试组 A 用例逐条对齐 |
| task-06.md §8 | daemon.ts interactive 接入测试用例 #1-#10 | 测试组 B 用例逐条对齐 |
| task-03.md §8 | build_claim_payload TDD 手测骨架 | 测试组 C 用例落地 |
| plan.md task-09 行 | daemon + claim 透传测试，守护 interactive spec-sync 链路 | 任务范围 |

## 4. 实现要求（三组测试清单）

### 4.1 测试组 A：daemon spec-sync utility（spec-sync.test.ts）

> 目标文件：`sillyhub-daemon/src/spec-sync.ts`（task-04 新增，**本任务只测不改**）。
> 4 函数为**纯函数 + client 参数注入**（D-007@v1 核心），无需构造 TaskRunner 实例。

**用例清单**（对齐 task-04 §8 #1-#9）：

| 用例 | 场景 | 断言要点 |
|---|---|---|
| A1 | `resolveSpecDir('ws-uuid')` 正常 | 返回 `join(homedir(), '.sillyhub', 'daemon', 'specs', 'ws-uuid')`（mock homedir 固定） |
| A2 | `resolveSpecDir` wsId 含分隔符 / 空 | `'a/b'`、`'a\\b'`、`''` → throw `invalid workspace_id`（路径穿越防御） |
| A3 | `pullSpecBundle` 正常路径 | mockClient.getSpecBundle 返回 tar Buffer → 调用发生、`extractTar` 解到 specDir、返回 specDir 路径非 null |
| **A4** | **`pullSpecBundle` 404 容错（R-02/E-01 核心）** | mockClient.getSpecBundle reject `{status:404}` → **不抛错**、`mkdir -p` 本地目录、返回 specDir 路径**非 null**、extractTar **未被调** |
| A5 | `pullSpecBundle` 5xx 透传 | mockClient.getSpecBundle reject `{status:500}` → `pullSpecBundle` reject（仅 404 容错） |
| A6 | `pullSpecBundle` 跳过分支 | 无 wsId / `existingSpecRoot` 已有 / mockClient 无 getSpecBundle 方法 → 返回 `null`（三条 skip 路径分别覆盖） |
| A7 | `packSpecDir` 打包 | 构造含 `.runtime/` 子目录 + 普通文件的临时目录 → 返回 tar Buffer **不含 `.runtime` 段**、含普通文件、以 2×512 zero block 结尾 |
| A8 | `extractTar` Tar Slip 防护 | 手工构造 name=`../escape` 的 tar → throw；name=`/abs`（绝对路径）→ throw；name=`C:\\win`（盘符）→ throw |
| A9 | `postSpecSync` 正常 | mockClient.postSpecSync 返回 `{ok:true, reparsed:3}` → 返回该对象；内部调 packSpecDir 打包 |
| A10 | `postSpecSync` mock 未实现 | mockClient 无 postSpecSync 方法 → 返回 `null`（测试友好容错） |

**Tar round-trip 真实性**：A7/A8 用手工 ustar tar Buffer（与 spec-sync.ts 实现同款手工 ustar，
**不复用** spec-sync.ts 的 buildTarHeader——避免被测代码与测试代码同源导致 bug 互相掩盖；
参考 `task-09-spec-pull-push.test.ts` 现有 round-trip 模式，独立构造 tar fixture）。真实写
`os.tmpdir()` 临时目录（`mkdtempSync` + `afterEach rmSync` 清理）。

### 4.2 测试组 B：daemon.ts interactive 接入（daemon-interactive-spec-sync.test.ts）

> 目标文件：`sillyhub-daemon/src/daemon.ts`（task-06 改，**本任务只测不改**）。
> 驱动真实 `Daemon` 实例 + mock SessionManager/client，触发 `_startInteractiveSession` /
> `onSessionEnd` 走 tar/shared 分支。

**用例清单**（对齐 task-06 §8 #1-#10）：

| 用例 | 场景 | 断言要点 |
|---|---|---|
| **B1** | **tar 模式 pull 触发 + 时序** | execPayload `transport='tar'` + `workspaceId='ws-1'` → 调 `_startInteractiveSession` → `pullSpecBundle`（mock client.getSpecBundle）**被调**；**时序断言**：pull 的 await 先于 `_sessionManager.create` resolve（用 spy 记录调用顺序，或 mock pull 返回 Promise 后断言 create 调用发生在 pull resolve 之后） |
| B2 | shared 模式不 pull | execPayload `transport='shared'`（或缺省 undefined）→ `pullSpecBundle` **未被调**（D-004 零触发守护） |
| **B3** | **pull 404 不阻塞 session 启动** | mock getSpecBundle reject `{status:404}`（utility 内容错）→ session 仍 create 成功、pull 分支正常登记 specSyncCtx |
| **B4** | **pull 5xx 不阻塞 session 启动（R-03）** | mock getSpecBundle reject `{status:500}` → `pullSpecBundle` 透传 → daemon catch warn → `_sessionManager.create` **仍被调**；log 含 `interactive_spec_pull_failed` |
| **B5** | **tar 模式 sync 触发 + 时序** | tar 模式 session 跑通后调 `onSessionEnd` → `postSpecSync`（mock client.postSpecSync）**被调**；**时序断言**：`postSpecSync` 调用发生在 `notifySessionEnd` 之后（spy 顺序） |
| **B6** | **sync 失败不阻塞终态上报（R-03）** | mock postSpecSync reject → `notifySessionEnd` **仍被调**（且先于 sync）、`onSessionEnd` **不抛错**（catch warn）；log 含 `interactive_spec_sync_failed` |
| B7 | shared 模式不 sync | 非 tar 模式（specSyncCtx 未登记）`onSessionEnd` → `postSpecSync` **未被调**（D-004 零触发守护） |
| B8 | workspaceId 缺失跳过 pull + warn | `transport='tar'` 但无 workspaceId/workspace_id → pull 未调、log 含 `interactive_spec_pull_no_workspace` |
| B9 | `onSessionEnd` 幂等 | 同一 sessionId 二次调 `onSessionEnd` → `postSpecSync` **只被调一次**（specSyncCtx 已 delete，二次进入查不到 ctx return） |
| B10 | sessionManager null 安全 | 未注入 SessionManager（构造 Daemon 时不传 options.sessionManager）→ pull/sync 均安全跳过不抛错（AC-14 过渡期守护） |

**时序断言策略**（B1/B5 关键）：
- B1 pull 时序：mock `_sessionManager.create` 为 `vi.fn()`，mock `pullSpecBundle`（vi.mock
  `./spec-sync`）返回一个**手动控制的 Promise**（`new Promise(resolve => { pullResolve=resolve })`）。
  调 `_startInteractiveSession` 后，**此时 `create` 不应被调**（await 未 resolve）；调
  `pullResolve()` 后，`create` 应被调。若 daemon 实现把 pull 写成 fire-and-forget（漏 await），
  则 `create` 会在 pullResolve 前被调 → 测试 fail（守护 R-07）。
- B5 sync 时序：mock `notifySessionEnd` 与 `postSpecSync` 为 spy，记录调用顺序数组；调
  `onSessionEnd` 后断言顺序数组中 `notifySessionEnd` 索引 < `postSpecSync` 索引。若 daemon
  把 sync 写在 notifySessionEnd 之前 → 顺序反转 → fail。

**mock 注入方式**：
- `vi.mock('../src/spec-sync.js', ...)` 替换 `pullSpecBundle`/`postSpecSync`/`resolveSpecDir`
  为 `vi.fn()`（B 组只验证 daemon 调用契约，不验证 utility 内部行为——那是 A 组职责）。
- mock SessionManager：构造 `{ create: vi.fn(), get: vi.fn(() => ({leaseId})), end/fail: vi.fn() }`
  最小桩对象（类型断言 `as unknown as SessionManager`），避免拉起真实 driver spawn。
- mock client：`{ getSpecBundle: vi.fn(), postSpecSync: vi.fn(), notifySessionEnd: vi.fn(), ... }`
  覆盖 `ClientLike` 所需方法。

### 4.3 测试组 C：backend build_claim_payload tar 透传（test_lease_claim_transport.py）

> 目标文件：`backend/app/modules/daemon/lease/context.py`（task-03 改，**本任务只测不改**）。
> 沿用 `test_lease_service.py` 的 `_create_interactive_lease` helper + `db_session` fixture 风格。

**用例清单**（对齐 task-03 §8 TDD 骨架 + §9 AC）：

| 用例 | 场景 | 断言要点 |
|---|---|---|
| **C1** | **tar 模式透传 workspace_id + transport，不透传 spec_root** | `monkeypatch` `settings.spec_transport='tar'`，lease metadata 含 `workspace_id`+`spec_root` → payload 含 `transport='tar'`、`transportMode='tar'`、`workspaceId=str(ws_id)`、`workspace_id=str(ws_id)`；**不含** `specRoot`/`spec_root`/`runtimeRoot`/`runtime_root`（即使 metadata 有 spec_root 也不透传，task-03 边界 E6） |
| C2 | shared 模式现状不变（D-004 守护） | `settings.spec_transport='shared'`（默认），lease metadata 含 `spec_root`+`workspace_id` → payload 含 `specRoot`/`spec_root`（现有 AC-01 行为）、`transport='shared'`/`transportMode='shared'`；**不含** `workspaceId`/`workspace_id`（shared 不透传 wsId） |
| C3 | tar 模式 ws_id 缺失（quick-chat） | `settings.spec_transport='tar'`，lease metadata 无 workspace_id（quick-chat 场景）→ payload 含 `transport='tar'`，**不含** `workspaceId`/`workspace_id`，**仍不含** `specRoot`（tar 语义不因 ws_id 缺失回退 shared，task-03 边界 E4） |
| C4 | transport/transportMode 同值同源 | C1/C2 用例中断言 `payload['transport'] == payload['transportMode']`（task-03 边界 E5 双写一致性） |
| C5 | tar 模式 workspace_id malformed | `settings.spec_transport='tar'`，lease metadata `workspace_id='not-a-uuid'` → UUID 解析失败 ws_id=None → payload 不含 workspaceId（降级，task-03 边界 E3），仍不含 specRoot |

**monkeypatch settings 方式**：
- pytest `monkeypatch` fixture patch `app.core.config.get_settings` 返回带 `spec_transport`
  字段的 mock settings，或直接 patch `Settings` 实例的 `spec_transport` 属性（取决于 task-01
  实现的 config 入口；以 task-01 实际暴露的 `get_settings` 单例 patch 为准，对齐现有
  `test_context_builder.py` 等 backend 测试的 settings mock 惯例）。
- 复用现有 `_create_user`/`_create_runtime`/`_create_interactive_lease` helper（从
  `test_lease_service.py` import 或复制；优先 import 避免重复——若 import 跨文件 helper 不便，
  复制最小版本到 `test_lease_claim_transport.py` 顶部）。

## 5. 接口定义

### 5.1 测试组 A（vitest）函数签名

```typescript
// sillyhub-daemon/tests/spec-transport-tar-sync/spec-sync.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// hoisted mock：node:os.homedir 必须在 spec-sync import 前替换（参考 task-09-spec-pull-push.test.ts）
const hoisted = vi.hoisted(() => ({
  homedirMock: vi.fn((): string => '/nonexistent-tar-sync-home'),
  fakeHomeDir: '' as string,
}));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: hoisted.homedirMock };
});

import { resolveSpecDir, pullSpecBundle, packSpecDir, postSpecSync }
  from '../../src/spec-sync.js';

// mock client 最小接口（duck-type，覆盖 utility 内 typeof 守卫）
function makeMockClient(overrides: Partial<{
  getSpecBundle: ReturnType<typeof vi.fn>;
  postSpecSync: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    getSpecBundle: vi.fn(async (_wsId: string): Promise<Buffer> => Buffer.alloc(0)),
    postSpecSync: vi.fn(async (_wsId: string, _tar: Buffer) => ({ ok: true, reparsed: 0 })),
    ...overrides,
  };
}

// 手工 ustar tar 构造（独立 fixture，不复用被测 buildTarHeader）
function buildTarFixture(entries: Array<{name: string; content?: Buffer; type?: 'file'|'dir'}>): Buffer { /* ... */ }

describe('spec-sync utility（task-04，FR-05/FR-06/D-003@v1/D-007@v1）', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'spec-sync-test-')); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  // A1-A10 用例 ...
});
```

### 5.2 测试组 B（vitest）函数签名

```typescript
// sillyhub-daemon/tests/spec-transport-tar-sync/daemon-interactive-spec-sync.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Daemon } from '../../src/daemon.js';
import type { DaemonConfig } from '../../src/config.js';
import type { SessionManager } from '../../src/interactive/session-manager.js';
import type { SessionState } from '../../src/interactive/types.js';

// vi.mock spec-sync 替换为 spy（B 组只验 daemon 调用契约）
vi.mock('../../src/spec-sync.js', () => ({
  pullSpecBundle: vi.fn(async (_c: unknown, _ws: string) => '/fake/spec/dir'),
  postSpecSync: vi.fn(async () => ({ ok: true, reparsed: 0 })),
  resolveSpecDir: vi.fn((ws: string) => `/fake/spec/dir/${ws}`),
}));
import { pullSpecBundle, postSpecSync } from '../../src/spec-sync.js';

function makeMockClient(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  return {
    notifySessionEnd: vi.fn(async () => undefined),
    getSpecBundle: vi.fn(async () => Buffer.alloc(0)),
    postSpecSync: vi.fn(async () => ({ ok: true, reparsed: 0 })),
    // ... ClientLike 其余方法按 daemon-kind-dispatch.test.ts createMockClient 模式补全
    ...overrides,
  };
}

function makeMockSessionManager(leaseId: string): { mgr: SessionManager; state: SessionState } {
  const state = { leaseId } as unknown as SessionState;
  return { mgr: { create: vi.fn(), get: vi.fn(() => state), end: vi.fn(), fail: vi.fn() } as unknown as SessionManager, state };
}

// B1-B10 用例：构造 Daemon(config, mockClient, undefined, { sessionManager: mockMgr })
// 触发 _startInteractiveSession（mock ws task_available 消息 或 直接调 daemon 内部方法
// 若为 private 则通过 ws message 驱动——参考 daemon-kind-dispatch.test.ts 的 ws 消息驱动模式）
```

### 5.3 测试组 C（pytest）函数签名

```python
# backend/app/modules/daemon/tests/test_lease_claim_transport.py
"""task-09（2026-06-23-spec-transport-tar-sync）：build_claim_payload interactive
分支 transport 透传测试。守护 task-03 的 tar/shared 分流 + D-007@v1。

覆盖 design §7.2（透传伪代码）+ §7.4 契约表（build_claim_payload tar 模式事件）。
"""
import uuid
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.daemon.lease.context import build_claim_payload
# 复用 test_lease_service.py 的 helper（或复制最小版本）


@pytest.mark.asyncio
async def test_build_claim_payload_tar_mode(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """C1: tar 模式透传 workspace_id+transport，不透传 spec_root。"""
    _patch_transport(monkeypatch, "tar")
    ws_id = uuid.uuid4()
    # ... 构造 interactive lease（metadata 含 workspace_id + spec_root）
    payload = await build_claim_payload(db_session, lease)
    assert payload["transport"] == "tar"
    assert payload["transportMode"] == "tar"
    assert payload["workspaceId"] == str(ws_id)
    assert payload["workspace_id"] == str(ws_id)
    assert "specRoot" not in payload and "spec_root" not in payload
    assert "runtimeRoot" not in payload and "runtime_root" not in payload


def _patch_transport(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    """patch settings.spec_transport（以 task-01 实际 get_settings 入口为准）。"""
    # 方案：monkeypatch app.core.config.get_settings 返回 mock，或 patch Settings 实例属性
    # 实现时以 task-01 暴露的入口为准（本任务消费 task-01 产出）
    ...

# C2-C5 用例 ...
```

## 6. 边界处理（≥5）

| # | 边界场景 | 处理（测试侧） | 来源 |
|---|---|---|---|
| 1 | **mock client.getSpecBundle 抛 404 vs 5xx 区分** | A4 用例 reject `{status:404}` 断言**不抛**+返回路径非 null；A5 用例 reject `{status:500}` 断言**透传抛错**。两条用例独立，确保 utility 仅 404 容错（R-02 核心守护） | design §7.2 E-01 / §10 R-02 / task-04 §4.3 |
| 2 | **不真实网络/不真实 backend** | A/B 组全用 mock client（`vi.fn()`），**不发起真实 HTTP**；C 组用 `db_session` fixture（内存/测试 DB），**不调真实 daemon**。测试快、稳定、无外部依赖 | 现有 daemon/hub-client 测试惯例 |
| 3 | **shared 模式零触发守护（D-004 核心不变式）** | B2（pull 未调）+ B7（sync 未调）+ C2（payload 仍透传 specRoot 不透传 wsId）三条用例**共同守护** shared 模式不被 tar 改动污染。任一回归（如 daemon 误对 shared 也 pull、或 build_claim_payload 对 shared 透传 wsId）→ 对应用例 fail | design §5.1 / §9 / D-004@v1 |
| 4 | **pull 404 容错断言返回路径非 null（非 null 是链路触发条件）** | A4 显式断言 `expect(result).not.toBeNull()` + `expect(result).toBe(specDir)`——若 utility 误把 404 当错误返回 null，后续 postSpecSync 链路断（task-runner.ts:480 `if (specRoot)` 守卫）。**非 null 是 R-02 容错的核心契约** | task-04 §4.3 返回值契约 |
| 5 | **onSessionEnd sync 失败不抛错（R-03 不阻塞终态）** | B6 用例 mock postSpecSync reject，断言 `onSessionEnd` 调用**不 reject**（await 不抛）+ `notifySessionEnd` 已被调（先于 sync）。守护 daemon 不能因 sync 失败改写 session 终态/阻塞上报 | design §10 R-03 / task-runner.ts:488-490 容错语义 |
| 6 | **Tar Slip 防护（解包路径穿越）** | A8 用例手工构造恶意 tar（name `../escape` / `/abs` / `C:\\win`），断言 extractTar throw。守护 spec bundle 解包不被恶意条目逃出 targetDir（design §5 E-05/E-06） | task-04 §4.6 / task-runner.ts:1484-1491 |
| 7 | **transport 双写一致性（transport == transportMode）** | C1/C2/C4 用例断言两者同值同源。守护 daemon 侧字段名归一化（camelCase `transportMode` + snake_case `transport`）两端都覆盖，任一缺失导致 daemon 分支误判 | task-03 边界 E5 / design §7.2 |
| 8 | **wsId 含路径分隔符（resolveSpecDir 路径穿越）** | A2 用例 `'a/b'`/`'a\\b'`/`''` → throw。守护 wsId 校验（正常 UUID 不触发，但恶意 wsId 不能穿越到任意目录） | task-04 §4.2 / design §5 E-07 |
| 9 | **时序断言可靠性（B1 pull await / B5 sync after notify）** | B1 用手动控制 Promise（pullResolve）制造 await 前后窗口；B5 用 spy 调用顺序数组。**不依赖 setTimeout 竞态**（避免 flaky），用显式 Promise 控制点 + 顺序数组断言（确定性） | design §10 R-07 / task-06 §4.2/4.3 |
| 10 | **mock client 未实现 getSpecBundle/postSpecSync 的容错** | A6（pull skip 返回 null）+ A10（sync 返回 null）用例覆盖 `typeof client.xxx !== 'function'` 守卫，守护 utility 对 mock/partial client 友好（测试本身可用最小桩） | task-04 §4.3/4.5 / 边界 6 |

## 7. 非目标

- **不做端到端真机测试**：异机拓扑 `SPEC_TRANSPORT=tar` scan 全流程文件落 backend `/data/{ws}`
  的端到端验证属 **task-12**（Wave 3，手动/integration）。本任务只做**单元/组件级**测试
 （utility 纯函数 + daemon 接入 mock 驱动 + backend payload 单测），不拉起真实 backend/daemon/
  driver/网络。
- **不改任何产品代码**：本任务 allowed_paths 只含测试目录（`sillyhub-daemon/tests/` +
  `backend/app/modules/daemon/tests/`）。`spec-sync.ts`/`daemon.ts`/`context.py` 的改动分别属
  task-04/06/03。本任务发现产品代码 bug 时，反馈给对应 task 修，不在本任务改产品代码。
- **不测 batch task-runner 路径**：task-runner 的 spec pull/sync（`task-runner.ts:480/1417`）
  已由现有 `task-09-spec-pull-push.test.ts`（变更 2026-06-22-agent-run-pipeline-fix）覆盖。
  本任务专注 **interactive 路径**（X-001 修正后的核心链路），不重复 batch 路径测试。
- **不测 apply_sync backend 接收侧**：`apply_sync`（`spec_workspace/service.py:288`）的整树
  解包 + reparse 由现有 spec_workspace 测试覆盖（whole-tree overwrite），本任务不重复。
- **不测 transport config 字段读取**：`Settings.spec_transport` 的 env 读取/枚举校验/
  field_validator 属 task-01 测试范围。本任务 C 组直接 monkeypatch `spec_transport` 值，
  不验证 config 加载逻辑。
- **不测 stage 链路**：propose/plan/execute 走 interactive 复用 Wave1 spec-sync 的测试属
  task-11（Wave 2）。本任务只覆盖 scan 链路（Wave1）的 interactive 接入。
- **不引入新测试依赖**：三组分别用现有 vitest（daemon）/ pytest（backend），不加新框架。

## 8. 参考

### 8.1 现有 spec 同步测试模式（daemon）

- `sillyhub-daemon/tests/task-09-spec-pull-push.test.ts`（变更 2026-06-22 遗留，测 batch
  TaskRunner.runLease 的 pull/push）：
  - **参考点**：`vi.hoisted` + `vi.mock('node:os')` 固定 homedir 模式（本任务 A 组复用）；
    手工 ustar tar Buffer round-trip fixture 构造模式（A7/A8 复用思路，**但独立实现避免同源**）；
    mock HubClient.getSpecBundle/postSpecSync 模式。
  - **差异**：遗留文件测 **batch 路径**（TaskRunner 实例 + createFakeChild 驱动 runLease），
    本任务 A 组测 **utility 纯函数**（无 TaskRunner 实例）、B 组测 **interactive 路径**
    （Daemon 实例 + mock SessionManager）。三者正交，文件命名用变更 slug 前缀子目录隔离。
- `sillyhub-daemon/tests/daemon-kind-dispatch.test.ts`：
  - **参考点**：mock Daemon 构造签名（config/client/taskRunner?/options.sessionManager?）、
    `createMockClient()` 桩对象模式、ws 消息驱动 `_runLeaseStateMachine` 模式。本任务 B 组
    直接复用此 mock 模式构造 Daemon 实例触发 `_startInteractiveSession`。

### 8.2 现有 build_claim_payload 测试模式（backend）

- `backend/app/modules/daemon/tests/test_lease_service.py` 的
  `TestBuildClaimPayloadInteractiveSpecRoot` 类（行 871+）：
  - **参考点**：`_create_interactive_lease(session, runtime_id, *, metadata)` helper（构造
    kind='interactive' lease 行）；`db_session` fixture；camelCase+snake_case 双写断言风格
    （`payload["specRoot"]` + `payload["spec_root"]`）；Workspace + SpecWorkspace DB 行构造
    模式（AC-02 DB 回填用例）。
  - **本任务 C 组对齐**：复用 `_create_interactive_lease` helper（import 或复制）+ 双写断言
    风格，新增 transport 分流的 tar/shared 用例（现有类只测 shared 模式 specRoot 透传）。
- `backend/app/modules/agent/tests/test_dispatch_metadata.py`（build_claim_payload 调用点
  相关）：参考 metadata 字段构造惯例。

### 8.3 被测接口契约（来自 task-04/06/03 蓝图）

- **spec-sync.ts**（task-04 §4）：`resolveSpecDir(wsId): string`、
  `pullSpecBundle(client, wsId, opts?): Promise<string|null>`（404 容错返回非 null）、
  `packSpecDir(specDir): Promise<Buffer>`、`postSpecSync(client, wsId, specRoot):
  Promise<{ok,reparsed}|null>`。
- **daemon.ts interactive 接入**（task-06 §4）：`_startInteractiveSession` tar 模式
  `transport==='tar' && workspaceId` → `await pullSpecBundle`（在 `_sessionManager.create` 前）；
  `onSessionEnd` → `_postInteractiveSpecSync`（在 `notifySessionEnd` 后）调 postSpecSync；
  新增 `_interactiveSpecSyncCtx` map（pull 登记 / sync 消费 / finally delete）。
- **build_claim_payload**（task-03 §4）：interactive 分支 `transport=get_settings().spec_transport`，
  tar 模式透传 `transport`/`transportMode`/`workspaceId`/`workspace_id`、不透传 spec_root；
  shared 模式维持现状透传 spec_root。

## 9. TDD（测试驱动顺序）

> 本任务**只写测试不改产品代码**，TDD 顺序体现为「测试与 task-04/06/03 同步落地」：
> task-04/06/03 实现时先写接口骨架，本任务测试随之 RED→GREEN。

1. **RED（task-04 spec-sync.ts 骨架先于测试）**：
   - task-04 提交 spec-sync.ts 4 函数骨架（可能未完整实现 404 容错）→ 本任务 A 组测试 fail
     （A4 404 容错未实现时抛错而非返回路径）。
   - task-04 完整实现（含 404 容错 + Tar Slip）→ A 组 GREEN。
2. **RED（task-06 daemon.ts 接入先于测试）**：
   - task-06 提交 daemon.ts 接入骨架（可能 pull 写成 fire-and-forget 漏 await）→ 本任务 B1
     时序测试 fail（create 在 pullResolve 前被调）。
   - task-06 修正 await 时序 → B1 GREEN。
3. **RED（task-03 context.py 分支先于测试）**：
   - task-03 提交 transport 分支（可能漏透传 workspaceId）→ 本任务 C1 fail
     （`payload["workspaceId"]` KeyError）。
   - task-03 补全透传 → C1 GREEN。
4. **REFACTOR**：测试稳定后不重构产品代码（本任务非目标）；测试自身可优化 fixture 复用
   （如 A 组 tar fixture helper 提取、B 组 mock 工厂提取），但保持用例独立可读。

**落地节奏**：本任务依赖 task-03/04/06（frontmatter `depends_on`），三任务实现后本任务测试
可一次性 GREEN。若并行开发，本任务测试可先写（RED 状态），待依赖任务实现后转 GREEN。

## 10. 验收标准（AC）

| AC | 验收项 | 验证方式 | 覆盖 |
|---|---|---|---|
| AC-1 | 新增 `sillyhub-daemon/tests/spec-transport-tar-sync/spec-sync.test.ts`，含 A1-A10 共 10 用例 | `pnpm vitest run tests/spec-transport-tar-sync/spec-sync.test.ts` 全通过 | FR-05/FR-06, D-003@v1 |
| AC-2 | A4 用例守护 pull 404 容错：返回路径**非 null**、不抛错、extractTar 未调 | vitest A4 pass | R-02/E-01 |
| AC-3 | A5 用例守护 5xx 透传（仅 404 容错） | vitest A5 pass | task-04 §4.3 |
| AC-4 | A8 用例守护 Tar Slip（name `..`/绝对路径/盘符 → throw） | vitest A8 pass | design §5 E-05/E-06 |
| AC-5 | A7 用例守护 packSpecDir 排除 `.runtime`、zero block 结尾 | vitest A7 pass | task-04 §4.4 |
| AC-6 | 新增 `sillyhub-daemon/tests/spec-transport-tar-sync/daemon-interactive-spec-sync.test.ts`，含 B1-B10 共 10 用例 | `pnpm vitest run tests/spec-transport-tar-sync/daemon-interactive-spec-sync.test.ts` 全通过 | FR-05/FR-06, D-003@v1/D-004@v1/D-007@v1 |
| AC-7 | B1 用例守护 pull 时序：pull await 先于 `_sessionManager.create` resolve（R-07） | vitest B1 pass（手动 Promise 控制） | design §10 R-07 |
| AC-8 | B2+B7 用例守护 shared 模式零触发（pull/sync 均未调，D-004） | vitest B2+B7 pass | D-004@v1 |
| AC-9 | B4 用例守护 pull 5xx 不阻塞 session 启动（R-03） | vitest B4 pass（create 仍被调） | design §10 R-03 |
| AC-10 | B5 用例守护 sync 时序：postSpecSync 在 notifySessionEnd 之后（R-07） | vitest B5 pass（spy 顺序数组） | design §10 R-07 |
| AC-11 | B6 用例守护 sync 失败不阻塞终态上报（R-03） | vitest B6 pass（notifySessionEnd 已调、onSessionEnd 不抛） | design §10 R-03 |
| AC-12 | B9 用例守护 onSessionEnd 幂等（postSpecSync 只调一次） | vitest B9 pass | task-06 §5 边界 9 |
| AC-13 | 新增 `backend/app/modules/daemon/tests/test_lease_claim_transport.py`，含 C1-C5 共 5 用例 | `cd backend && uv run pytest app/modules/daemon/tests/test_lease_claim_transport.py` 全通过 | FR-04, D-007@v1 |
| AC-14 | C1 用例守护 tar 透传：payload 含 transport/transportMode/workspaceId/workspace_id，**不含** specRoot/spec_root | pytest C1 pass | design §7.2/§7.4, task-03 AC-02 |
| AC-15 | C2 用例守护 shared 现状：payload 含 specRoot/spec_root + transport='shared'，**不含** workspaceId | pytest C2 pass | D-004@v1, task-03 AC-01 |
| AC-16 | C3 用例守护 tar wsId 缺失：含 transport='tar'，不含 workspaceId/specRoot | pytest C3 pass | task-03 边界 E4 |
| AC-17 | C4 用例守护 transport/transportMode 同值同源 | pytest C4 pass（C1/C2 内联断言） | task-03 边界 E5 |
| AC-18 | 全部测试不真实网络/不真实 backend（mock + db_session） | 代码审查：无真实 HTTP/fetch、无真实 daemon spawn | 非目标 |
| AC-19 | `cd sillyhub-daemon && pnpm vitest run` + `pnpm tsc --noEmit` 通过（含新增 2 文件，不破坏现有测试） | 本地跑全量 | 全局 AC |
| AC-20 | `cd backend && uv run pytest` + `uv run mypy` + `uv run ruff check .` 通过（含新增 test_lease_claim_transport.py） | 本地跑全量 | 全局 AC |
| AC-21 | 现有 `task-09-spec-pull-push.test.ts`（batch 路径）仍通过（本任务不冲突） | vitest 全量含该文件 pass | 非冲突守护 |
| AC-22 | 现有 `TestBuildClaimPayloadInteractiveSpecRoot`（shared specRoot 透传）仍通过 | pytest test_lease_service.py pass | D-004 回归守护 |
| AC-23 | git diff 只含 3 个新增测试文件（无产品代码改动） | `git diff --name-only` 仅 3 文件 | 非目标 |
| AC-24 | D-007@v1 守护：B 组测试断言 spec 同步经 interactive 路径（`_startInteractiveSession`/`onSessionEnd`），不经 task-runner（pullSpecBundle/postSpecSync 从 `./spec-sync` import 而非 TaskRunner 实例方法） | 代码审查 B 组 mock 注入方式 | D-007@v1（X-001 修正核心） |

## 11. 依赖关系

- **depends_on: task-03**：C 组测试 `build_claim_payload` 的 transport 分流由 task-03 实现。
  task-03 未完成则 C 组 RED（payload 无 transport 字段）。
- **depends_on: task-04**：A 组测试 `spec-sync.ts` 4 函数由 task-04 新增。task-04 未完成则
  A 组 import 失败。
- **depends_on: task-06**：B 组测试 daemon.ts interactive 接入（pull/sync 两接入点 +
  `_interactiveSpecSyncCtx` map）由 task-06 实现。task-06 未完成则 B 组 RED。
- **blocks: task-12**：端到端验证（task-12）依赖本任务单元测试 GREEN 作为底层守护——本任务
  fail 则 task-12 端到端无意义（底层链路已断）。
- **不依赖 task-01/02/05/07/08**：task-01（config 字段）由 C 组 monkeypatch 跳过；task-02
  （scan prompt helper）的测试属 task-08；task-05（task-runner 改调）是 batch 路径重构，
  本任务不测 batch；task-07（sync 端点放行）属 backend 接收侧，本任务不测；task-08 是
  context_builder 测试，独立于本任务。

## 12. 风险

| 风险 | 等级 | 应对 |
|---|---|---|
| B 组时序断言 flaky（pull/sync 时序依赖 await） | P2 | 用手动控制 Promise（B1）+ spy 顺序数组（B5）确定性断言，**不用 setTimeout 竞态**；若 daemon 实现用 fire-and-forget 导致时序不确定，测试 fail 暴露 bug（反馈 task-06 修） |
| C 组 monkeypatch settings 方式与 task-01 实际入口不符 | P2 | `_patch_transport` helper 以 task-01 暴露的 `get_settings` 入口为准（实现时确认）；备选用 `monkeypatch.setattr(Settings, 'spec_transport', value)` 直接 patch 实例属性 |
| A 组 tar fixture 与 spec-sync.ts buildTarHeader 同源掩盖 bug | P3 | A 组 tar fixture **独立实现**（不复用被测代码），参考遗留 `task-09-spec-pull-push.test.ts` 的 round-trip 模式但独立构造 |
| 现有 `task-09-spec-pull-push.test.ts` 文件名与本任务 task-09 编号巧合导致混淆 | P3 | 本任务用变更 slug 子目录 `spec-transport-tar-sync/` 隔离，文件名 `spec-sync.test.ts`/`daemon-interactive-spec-sync.test.ts` 不含 task-09 前缀，避免与遗留文件混淆；遗留文件保持不动（测 batch 路径，仍有效） |
| task-04/06/03 实现与蓝图接口签名偏差导致测试 import/调用失败 | P2 | 本任务实现时以**实际代码签名**为准（蓝图接口定义为参考）；发现偏差反馈对应 task 修代码或本任务调整测试断言（测试守护真实行为） |
