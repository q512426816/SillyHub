---
author: flow-machine-draft
created_at: 2026-10-12T00:36:25.792Z
---
# 需求规格（Requirements）— 2026-10-12-spec-sync-rebase-guard

## 功能需求

### FR-01: 首推 postSpecSyncIncremental 返回 conflict=true 后，re-base 段内（rebaseManifestVersions/computeIncrementalOps/onProgress/重试推送）抛出的任何异常必须统一转为 SpecPushConflict 上抛人工裁决，禁止落入外层 tar 全量回退

- 首推已返回 conflict=true 后，re-base 段内（清单 version re-base、ops 重算的文件 IO、onProgress 回调、重试推送）抛出的任何异常必须统一转为 `SpecPushConflict` 上抛（`SpecPushConflict` 本身原样透传），禁止落入外层 `packSpecDir` + `postSpecSync` tar 全量回退——已知冲突面下静默全量覆盖违背 NFR-02「conflict 后不自动覆盖」。

#### 场景：重算 IO 异常不落 tar 回退

- Given 桩首推返回 conflict=true 且 server_versions 非空，重算 ops 期间文件读取抛 EBUSY 形态异常
- When 执行增量推送
- Then 抛 `SpecPushConflict`，且 tar 全量端点 `postSpecSync` 零调用、不写 pending_push 标记

#### 场景：onProgress 回调异常同样受守卫

- Given 首推 conflict=true 后 onProgress 回调抛异常
- When 执行增量推送
- Then 同样转 `SpecPushConflict` 上抛，不落 tar 回退

### FR-02: 重试推送仍 conflict（真分叉）与重试传输失败转抛 SpecPushConflict 的既有语义保持不变

- 重试推送响应仍 `conflict=true`（真分叉）必须原样抛 `SpecPushConflict`；重试推送传输失败必须转抛 `SpecPushConflict`（c4ff833b0 review P2 既有语义）——两者在守卫重构后行为逐字不变。

#### 场景：真分叉原样上抛

- Given 首推与重试均返回 conflict=true
- When 执行增量推送
- Then 抛 `SpecPushConflict`，增量端点恰好调用两次，tar 端点零调用

#### 场景：重试传输失败转抛

- Given 首推 conflict=true、重试推送 reject ECONNRESET
- When 执行增量推送
- Then 抛 `SpecPushConflict`，增量端点恰好两次，tar 端点零调用，不写 pending_push

### FR-03: 成功路径（rebase 后推送成功、无 conflict）行为零变化，既有 spec-sync-incremental 用例全绿

- re-base 后重试成功（conflict=false）的路径必须零行为变化：重试 op base_version 对齐服务端 version、成功后缓存按 new_versions 回写、返回 `{ok:true}`；既有 spec-sync-incremental 全部用例必须保持全绿，不得为通过而改语义。

#### 场景：他端先推型自愈不变

- Given 首推 conflict=true + server_versions、重试返回 new_versions
- When 执行增量推送
- Then 成功返回、重试 op base_version 对齐、缓存 version 回写为 new_versions（既有用例口径）

### FR-04: 新增用例：conflict 后 computeIncrementalOps 抛 IO 异常 → 断言抛 SpecPushConflict 且 postSpecSync（tar 全量）零调用（先红后绿）

- 必须存在用例：在首推 conflict=true 与 ops 重算之间的确定性窗口注入 `readFile` EBUSY 形态异常，断言抛 `SpecPushConflict`、增量端点恰好一次、tar 端点 `postSpecSync` 零调用；该用例在守卫前为红（异常穿透外层 catch 走 tar 回退）、守卫后为绿。

#### 场景：注入窗口确定性

- Given `node:fs/promises.readFile` 部分替身受旗标控制（默认透传），旗标在首推桩回调内置位、finally 复位
- When 首推 conflict 后重算 ops 触发 readFile
- Then 抛 EBUSY 形态异常并被守卫转为 `SpecPushConflict`

### FR-05: 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/spec-sync-incremental.test.ts 全文件

- 本变更只必须运行 `sillyhub-daemon/tests/spec-sync-incremental.test.ts` 全文件，禁止跑全量测试套件（规则 0，全量留给 CI）。

#### 场景：相关面回归

- When 运行该测试文件
- Then 新增用例与既有用例全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/spec-sync-incremental.test.ts「conflict 后 re-base 重算遇 IO 异常 → 转 SpecPushConflict 不落 tar 回退（2026-10-12-spec-sync-rebase-guard）」
FR-02: sillyhub-daemon/tests/spec-sync-incremental.test.ts「conflict → re-base 重试仍 conflict → 抛 SpecPushConflict（不静默覆盖，NFR-02 / 2026-10-11-sync-conflict-tri-fix FR-02）」「re-base 重试遇传输失败 → 转抛 SpecPushConflict 不落 tar 回退不写 pending_push（review P2 2026-10-11）」
FR-03: sillyhub-daemon/tests/spec-sync-incremental.test.ts「conflict → re-base 重试全绿 → 自愈成功（他端先推型，2026-10-11-sync-conflict-tri-fix FR-02）」
FR-04: sillyhub-daemon/tests/spec-sync-incremental.test.ts「conflict 后 re-base 重算遇 IO 异常 → 转 SpecPushConflict 不落 tar 回退（2026-10-12-spec-sync-rebase-guard）」
FR-05: sillyhub-daemon/tests/spec-sync-incremental.test.ts（全文件回归）
