---
id: task-10
title: 集成验证（init lease 全链路）
title_zh: 本机真实 daemon init lease 走通：首成员产物断言 + 第二成员骨架 no-op 无 conflict + MIN_SILLYSPEC_VERSION_FOR_INIT 定版
author: qinyi
created_at: 2026-08-15 16:06:52
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09]
blocks: []
requirement_ids: [FR-01, FR-06]
decision_ids: [D-002@v2, D-008@v2, D-009@v1]
allowed_paths:
  - sillyhub-daemon/src/spec-sync.ts
goal: >
  Wave1 CLI 发版并本机安装后，把 MIN_SILLYSPEC_VERSION_FOR_INIT 占位改为实际发版版本号；本机起 backend + daemon，对测试工作区触发初始化（前端按钮或 API），验证全链路。属集成验证 task，改文件仅限版本常量定版。
implementation:
  - sillyspec 仓发版（Wave1 三 task 合入的版本），本机 npm install -g sillyspec@latest，`sillyspec --version` 确认
  - spec-sync.ts MIN_SILLYSPEC_VERSION_FOR_INIT 改为该版本号
  - 场景1（首成员）：新工作区/新 rootPath 触发 init → 断言 rootPath 出现 .sillyspec-platform.json（specRoot/workspaceId/status active）+ CLAUDE.md 受管段；specCacheRoot 出现骨架（knowledge/INDEX.md、workflows/、.runtime/sillyspec.db）；.claude/skills 下**无** sillyspec-* 新增（--no-skills 生效）；服务器 manifest 收到骨架新建（或 no-op）
  - 场景2（重复 init）：再点一次初始化 → local.yaml 手调内容保留、无 conflict
  - 场景3（第二成员）：同一工作区另一 rootPath 初始化 → 骨架 add 全 no-op，backend 无 conflict 记录（查 apply_ops 返回与日志）
  - 门控负路径（可选）：临时调高 MIN 常量 → init lease failed 且错误含升级指引 → 调回
acceptance:
  - AC-01/02/05/06 全部实测通过并留证（输出摘录进 verify 记录）
  - MIN_SILLYSPEC_VERSION_FOR_INIT 定版与已发 CLI 一致
verify:
  - 场景脚本化断言（可 bash 逐条检查文件存在 + curl backend manifest）
  - cd sillyhub-daemon && pnpm exec vitest run tests/test_init_lease.test.ts（定版后回归）
constraints:
  - 本机 8001 backend（docker 或本地）+ 真实 daemon；测试工作区数据可重置（项目未上线约定）
  - 集成发现的缺陷回灌对应 task 修复，不在本 task 扩大实现范围
---
