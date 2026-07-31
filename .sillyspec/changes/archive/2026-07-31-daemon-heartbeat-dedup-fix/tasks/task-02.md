---
id: task-02
title: isPathUnderAnyRoot 补 resolveRealPath（下沉到判定）
title_zh: sandbox 路径判定在比较时对 target 与每个 root 做 realpath
author: WhaleFall
created_at: 2026-07-30 16:36:00
priority: P0
depends_on: []
blocks: [task-04, task-10]
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/policy/path-utils.ts
provides:
  - contract: SandboxPathRealpathCheck
    fields: [target_resolved, root_resolved, junction_aware, case_insensitive_win]
goal: >
  isPathUnderAnyRoot 在比较时对 target 与每个 root 调 resolveRealPath（下沉到判定），保证 PolicyCache 去掉 realpath 后 sandbox 路径权限判定仍正确（含 junction/symlink/大小写/不存在路径），不越权不误判。
implementation:
  - path-utils.ts:149-169 isPathUnderAnyRoot，比较前对 target 调 resolveRealPath（realpath + Windows 盘符小写），对每个 root 也调 resolveRealPath，再走现有 isPathUnder 判定
  - resolveRealPath 已存在（path-utils.ts:70-90，存在则 realpathSync.native+normalizeCase，不存在则父目录 fallback），直接复用
  - 处理 root 不存在/不可 realpath 的情况（resolveRealPath 已有 try/catch fallback，不抛）
  - junction/符号链接：realpath 解析后判定，保证 borrow root 等场景正确
acceptance:
  - 子路径/junction/大小写/不存在路径/symlink/borrow root 判定结果与改前一致（task-10 改前改后对照断言）
  - target 与每个 root 均经过 resolveRealPath
  - 不存在的 root/target 不抛异常（fallback）
  - cd sillyhub-daemon && pnpm typecheck 通过
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm test tests/policy/path-utils.test.ts（task-10 补全场景）
constraints:
  - **B1 安全红线**：是 sandbox 路径权限判定，必须 task-10 改前改后对照 + 全场景覆盖
  - realpath 下沉到判定，不在 PolicyCache.set 存（与 task-01 配合）
  - 性能：realpath 同步 stat 仍在（R4），本轮接受，视 task-13 实跑决定是否异步化（D-005）
---
