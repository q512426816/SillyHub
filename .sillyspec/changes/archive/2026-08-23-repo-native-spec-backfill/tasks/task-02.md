---
id: task-02
title: 'cli-self-referential-helpers'
title_zh: 'CLI isSelfReferentialSpecRoot + isPlatformMode helper + shared.js 四处判定收敛 + 单测'
author: qinyi
created_at: 2026-08-23 21:40:00
priority: P0
depends_on: []
blocks: [task-03, task-04]
repo: sillyspec
base_commit: 2c35ab240cf1489b1cffde9a47eb34f4971c358c
head_commit: 2c35ab240cf1489b1cffde9a47eb34f4971c358c
repo_root: /Users/qinyi/Desktop/sillyspec
requirement_ids: [FR-3, FR-5]
decision_ids: [D-001, D-002]
allowed_paths:
  - src/run/shared.js
  - test/
goal: >
  提供自指判定的单一数据源并接入平台模式门禁，使 repo-native junction 回环场景的
  内置 sync/auto-pull 按本地模式语义运行（shared.js:536/609/631/698 四处裸判定收敛）。
  契约：task-03/04 消费本任务产出的两 helper（isSelfReferentialSpecRoot(cwd, specRoot)、
  isPlatformMode(platformOpts, cwd)）及其既定语义（design 接口定义）。
implementation:
  - shared.js 新增导出 isSelfReferentialSpecRoot(cwd, specRoot)：specRoot 非空时 fs.realpathSync 双方（join(cwd,'.sillyspec') 为基准）严格相等返回 true；任一路径不存在或 realpath 抛错返回 false；cwd 须为项目根（与指针查找同基准，design 接口定义约束）
  - 新增导出 isPlatformMode(platformOpts, cwd)：(platformOpts?.specRoot || platformOpts?.runtimeRoot) && !isSelfReferentialSpecRoot(cwd, platformOpts?.specRoot)
  - 四处收敛：triggerSync(:536)/triggerPull(:609)/triggerPullActiveChange(:631)/checkApproval 内第 4 处(:698) 的裸判定替换为 isPlatformMode(platformOpts, cwd)（各函数已有 cwd 入参；缺失处补传）；语义保持：自指 → 不跳过内置 sync、auto-pull 走本地语义
  - 单测按 test/run-tests.mjs 既有注册模式接入（先读该文件确认注册方式）：自指 true（tmp 目录构造 symlink 回环）/ 非自指 false（真外部目录、platform-managed 缓存目录、cwd/.sillyspec 不存在、specRoot null）/ isPlatformMode 四象限
acceptance:
  - 两 helper 导出且语义符合 design 接口定义（FR-3）
  - 四处裸判定全部收敛，shared.js 内 `platformOpts?.specRoot || platformOpts?.runtimeRoot` 直判仅剩 isPlatformMode 定义内部一处（grep 验证）
verify:
  - cd /Users/qinyi/Desktop/sillyspec && npm test 全绿（新增用例 + 既有回归）
constraints:
  - 不改变 platform-managed 真外部目录的平台模式判定结果（D-002@v1/FR-5）
  - Node 18+ 原生 API，零新依赖
---

# task-02 补充说明
跨仓任务：在 sillyspec 仓直做直提（不进主仓 worktree）；commit message 注明本变更名。task-03 的指针恢复/写入/声明三处消费本任务 helper 语义，不得在 task-03 内重复实现判定逻辑。
