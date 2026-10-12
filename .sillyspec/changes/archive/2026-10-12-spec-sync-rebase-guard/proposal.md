---
author: flow-machine-draft
created_at: 2026-10-12T00:36:25.792Z
---
# 提案书（Proposal）— 2026-10-12-spec-sync-rebase-guard

## 动机

任务原话转写：动机：24h 风险审查 P1——c4ff833b0 自述要保住的不变量「首推已知 conflict 后，重试失败不得落入外层 tar 全量回退（静默覆盖违背 NFR-02）」守卫不完整：sillyhub-daemon/src/spec-sync.ts 首推 conflict=true 之后，同分支内 computeIncrementalOps（重算 ops，内部 readFile 无保护，Windows 杀软短暂锁 EBUSY/EPERM 或文件在 walk 与 read 之间被删即抛）与 onProgress 回调抛出的异常会穿透到外层 catch（if e instanceof SpecPushConflict throw 之外的其余异常），走 packSpecDir+postSpecSync tar 全量覆盖推送——正是该 commit 要堵的静默覆盖在非传输失败路径上仍然可达。
成功标准：
- 首推 postSpecSyncIncremental 返回 conflict=true 后，re-base 段内（rebaseManifestVersions/computeIncrementalOps/onProgress/重试推送）抛出的任何异常必须统一转为 SpecPushConflict 上抛人工裁决，禁止落入外层 tar 全量回退
- 重试推送仍 conflict（真分叉）与重试传输失败转抛 SpecPushConflict 的既有语义保持不变
- 成功路径（rebase 后推送成功、无 conflict）行为零变化，既有 spec-sync-incremental 用例全绿
- 新增用例：conflict 后 computeIncrementalOps 抛 IO 异常 → 断言抛 SpecPushConflict 且 postSpecSync（tar 全量）零调用（先红后绿）
- 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/spec-sync-incremental.test.ts 全文件

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 首推 postSpecSyncIncremental 返回 conflict=true 后，re-base 段内（rebaseManifestVersions/computeIncrementalOps/onProgress/重试推送）抛出的任何异常必须统一转为 SpecPushConflict 上抛人工裁决，禁止落入外层 tar 全量回退
2. 重试推送仍 conflict（真分叉）与重试传输失败转抛 SpecPushConflict 的既有语义保持不变
3. 成功路径（rebase 后推送成功、无 conflict）行为零变化，既有 spec-sync-incremental 用例全绿
4. 新增用例：conflict 后 computeIncrementalOps 抛 IO 异常 → 断言抛 SpecPushConflict 且 postSpecSync（tar 全量）零调用（先红后绿）
5. 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/spec-sync-incremental.test.ts 全文件

## 成功标准（可验证）

1. 首推 postSpecSyncIncremental 返回 conflict=true 后，re-base 段内（rebaseManifestVersions/computeIncrementalOps/onProgress/重试推送）抛出的任何异常必须统一转为 SpecPushConflict 上抛人工裁决，禁止落入外层 tar 全量回退
2. 重试推送仍 conflict（真分叉）与重试传输失败转抛 SpecPushConflict 的既有语义保持不变
3. 成功路径（rebase 后推送成功、无 conflict）行为零变化，既有 spec-sync-incremental 用例全绿
4. 新增用例：conflict 后 computeIncrementalOps 抛 IO 异常 → 断言抛 SpecPushConflict 且 postSpecSync（tar 全量）零调用（先红后绿）
5. 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/spec-sync-incremental.test.ts 全文件
