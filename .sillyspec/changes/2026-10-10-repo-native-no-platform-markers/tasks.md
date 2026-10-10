---
author: flow-machine-draft
created_at: 2026-10-10T06:51:49.152Z
---
# 任务注册表（Tasks）— 2026-10-10-repo-native-no-platform-markers

- [x] task-01: spec-sync.ts pullSpecBundle repo-native 分支：源项目无 .sillyspec 时 mkdir 空目录（repo_native_source_created 日志）后照常建 junction，删除 source_missing_fallback 降级——验证：新用例 getSpecBundle 不被调 + junction 成立
- [x] task-02: ensureSpecJunction 普通目录残留分支：rename 到 <wsId>.pre-junction-backup-<ts> 备份后建 junction，rename 失败 catch 返回 false 保守降级——验证：新用例备份目录存在原内容 + junction 成立
- [x] task-03: test_init_lease.test.ts 策略分支 describe 新增两用例：源项目无 .sillyspec 不降级投毒 / 普通目录残留备份交换——验证：pnpm vitest run 该文件全绿（含既有用例）
- [x] task-04: 回归确认：test_init_lease.test.ts 全量（repo-native/repo-mirrored/platform-managed 既有用例）+ tsc typecheck 全绿——验证：两命令 exit 0
- [x] task-05: 收口前自查：junction 成立后 init 自指守卫前置条件（源 .sillyspec 存在 + 缓存 symlink）在两新路径成立（用例内断言 lstat isSymbolicLink + realpath 相等）——验证：用例断言通过
