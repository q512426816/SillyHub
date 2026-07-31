---
id: task-10
title: isPathUnderAnyRoot 路径判定测试 + 改前改后对照
title_zh: sandbox 路径判定全场景测试与改前改后对照断言
author: WhaleFall
created_at: 2026-07-30 16:36:00
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/tests/policy/path-utils.test.ts
provides:
  - contract: SandboxPathCheckTestCoverage
    fields: [subpath, junction, case_insensitive, nonexist, symlink, borrow_root, before_after_assert]
expects_from:
  task-02:
    - contract: SandboxPathRealpathCheck
      needs: [target_resolved, root_resolved, junction_aware]
goal: >
  isPathUnderAnyRoot 全场景路径判定测试（子路径/junction/大小写/不存在/symlink/borrow root）+ 改前改后对照断言，保证 task-02 口径改动后 sandbox 判定不越权不误判（B1 红线）。
implementation:
  - 新增/扩展 sillyhub-daemon/tests/policy/path-utils.test.ts，覆盖：合法子路径=true、root 外路径=false、junction/symlink 解析后判定、Windows 大小写不敏感、不存在 target/root fallback、borrow root 场景
  - 改前改后对照断言：记录改前（normalizePath 比较）与改后（resolveRealPath 比较）在各场景的预期结果，断言关键安全场景（越权拒绝）一致
  - 对照现有 thinking 路径判定用例（如有）保持一致
acceptance:
  - 全场景判定结果符合预期（越权路径一律 false）
  - 改前改后关键安全断言一致（不存在因 realpath 下沉导致的新越权/误判）
  - cd sillyhub-daemon && pnpm test tests/policy/path-utils.test.ts 通过
verify:
  - cd sillyhub-daemon && pnpm test tests/policy/path-utils.test.ts
constraints:
  - **B1 红线**：sandbox 安全判定，改前改后对照必须先过才能进 task-13 实跑
  - 测试本身逻辑有误时禁止改测试凑过（CLAUDE.md #9），改实现
  - Windows 特定场景（junction/盘符大小写）需跨平台兼容（CLAUDE.md #13），非 Win 平台用条件跳过或 mock
---
