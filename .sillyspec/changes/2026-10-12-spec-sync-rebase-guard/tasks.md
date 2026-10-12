---
author: flow-machine-draft
created_at: 2026-10-12T00:36:25.792Z
---
# 任务注册表（Tasks）— 2026-10-12-spec-sync-rebase-guard

- [x] task-01: 首推 postSpecSyncIncremental 返回 conflict=true 后，re-base 段内（rebaseManifestVersions/computeIncrementalOps/onProgress/重试推送）抛出的任何异常必须统一转为 SpecPushConflict 上抛人工裁决，禁止落入外层 tar 全量回退
- [x] task-02: 重试推送仍 conflict（真分叉）与重试传输失败转抛 SpecPushConflict 的既有语义保持不变
- [x] task-03: 成功路径（rebase 后推送成功、无 conflict）行为零变化，既有 spec-sync-incremental 用例全绿
- [x] task-04: 新增用例：conflict 后 computeIncrementalOps 抛 IO 异常 → 断言抛 SpecPushConflict 且 postSpecSync（tar 全量）零调用（先红后绿）
- [x] task-05: 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/spec-sync-incremental.test.ts 全文件
