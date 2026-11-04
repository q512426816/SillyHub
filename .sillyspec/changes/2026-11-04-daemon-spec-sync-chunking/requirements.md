---
author: flow-machine-draft
created_at: 2026-11-04T14:20:16.936Z
---
# 需求规格（Requirements）— 2026-11-04-daemon-spec-sync-chunking

## 功能需求

### FR-01: daemon 增量推送按 op 数与 base64 字节粗估双约束切块（缺省 128 ops / 2MiB，env SILLYSPEC_SPEC_SYNC_CHUNK_OPS / SILLYSPEC_SPEC_SYNC_CHUNK_BYTES 可调，键名与 CLI 一致）顺序提交，块响应合并（conflict 任一块真、server_versions/new_versions 累积）后走既有 conflict re-base 与缓存回写路径，对外行为与单批等价

- 增量推送必须按双约束切块顺序提交：ops 超出块上限时逐块调用 postSpecSyncIncremental（每块 ≤ 上限）；块响应必须合并成单批等价形状（conflict 任一块命中即真、server_versions/new_versions 逐块累积）后交给既有 re-base 与缓存回写，禁止改动这两段语义；ops 在一块内时必须保持现状单请求直发（缺省零回归）。

#### 场景：主路径

Given 有清单缓存、12 个新增文件、`SILLYSPEC_SPEC_SYNC_CHUNK_OPS=5`；When postSpecSync；Then postSpecSyncIncremental 被调 3 次（块内 5+5+2 ops），全部 200 后返回 `{ok:true, filesTotal:12}` 且不回退旧 tar。

### FR-02: 中途块失败且已有块落地时禁止回退整包 tar（部分落地后 tar 全量覆盖有覆盖他端写入风险且必超时），异常上抛由下轮同步以服务器清单为锚断点续传；首块即失败（零落地）维持既有 tar 回退行为不变（旧后端兼容）

- 已有块落地后的块失败必须上抛原始错误且禁止回退整包 tar（postSpecSync 不得被调用）；首块失败（零落地）必须维持既有行为原样回退旧 tar；rebase 重试段命中部分落地失败时必须透传断点续传分支，禁止升级为 SpecPushConflict 人工裁决。

#### 场景：主路径

Given 12 ops 切 3 块、第 2 块网络错误；When postSpecSync；Then 拒绝（rejects）原始错误、postSpecSyncIncremental 恰被调 2 次、旧 tar 端点零调用。Given 首块即 404；When postSpecSync；Then 回退旧 tar 一次（现状不变）。

### FR-03: onProgress 进度按块累计上报 files_processed

- onProgress 必须在起点 `files_total=ops.length`（既有）之后，每块落地累加上报 `files_processed`（5/10/12…）；onProgress 缺省（undefined）时必须零调用。

#### 场景：主路径

Given 12 ops 切 3 块且传入 onProgress；When 推送；Then observed files_processed 序列为 [5,10,12]（起点 total=12 上报在前）。

### FR-04: 分批纯逻辑有判别性单测（超限单 op 独占一块、恰好等于阈值、双约束同时生效、保序）；集成测试覆盖全落地/中途失败不回退 tar/首块失败仍回退 tar 三态

- chunkOpsForPush 必须有覆盖以下边界的判别性单测：单 op 单块、恰好等于 ops 阈值（=1 块）、超出阈值切块、字节阈值切块（粗估口径 content+path×2+96）、双约束同时生效取更严、超字节单 op 独占一块、flatten 保序、空数组零块；postSpecSync 集成必须覆盖全落地/中途失败不回退 tar/首块失败仍回退 tar 三态断言。

#### 场景：主路径

Given 显式 opts.maxOps/maxBytes 驱动各边界与 env 驱动集成三态；When 断言块分布/调用次数/端点零调用；Then 全部通过（无顺序依赖、env 在 afterEach 还原）。

### FR-05: 既有 daemon 测试套件全绿

- 本变更合入后既有 daemon 测试套件必须全绿（重点回归 spec-sync-incremental / spec-sync / spec-sync-conflict-autoheal），TypeScript typecheck（tsc --noEmit）必须通过。

#### 场景：主路径

Given 实现与测试就位；When vitest run 相关面 + npx tsc --noEmit；Then 全部退出码 0。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/spec-sync-push-chunking.test.ts「12 ops → 3 块顺序提交全部落地：逐块调用 5+5+2、响应合并、不回退 tar、进度按块累计」
FR-02: sillyhub-daemon/tests/spec-sync-push-chunking.test.ts「中途块失败（第 2 块）→ 原始错误上抛、已落地块保留、不回退旧 tar」+「首块失败（零落地）→ 维持既有 tar 回退（旧后端兼容）」
FR-03: sillyhub-daemon/tests/spec-sync-push-chunking.test.ts「12 ops → 3 块顺序提交全部落地」（processedSeq [5,10,12] 断言）
FR-04: sillyhub-daemon/tests/spec-sync-push-chunking.test.ts「chunkOpsForPush 双约束切块」三用例
FR-05: sillyhub-daemon/tests/spec-sync-incremental.test.ts 全文件 + spec-sync-conflict-autoheal.test.ts 全文件 + npx tsc --noEmit（typecheck）
