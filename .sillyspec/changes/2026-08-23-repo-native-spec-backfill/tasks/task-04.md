---
id: task-04
title: 'cli-release-3-27-3'
title_zh: '工具仓发版 3.27.3 + 全局重装 + 自指场景冒烟'
author: qinyi
created_at: 2026-08-23 21:40:00
priority: P1
depends_on: [task-02, task-03]
blocks: [task-05]
repo: sillyspec
base_commit: 84db32696fbf415a1fa53e486921c00a1ac687af
repo_root: /Users/qinyi/Desktop/sillyspec
requirement_ids: [FR-6]
decision_ids: [D-001]
allowed_paths:
  - package.json
goal: >
  修复进入实际生效态——全局 CLI 具备自指免疫，消除"发版前持续中毒"窗口（design 风险 2）。
  依赖 task-02（helper+四处收敛合入、npm test 绿）与 task-03（指针生命周期免疫合入、
  npm test 绿）。
implementation:
  - package.json version 3.27.2 → 3.27.3
  - 全仓 npm test 终验（task-02/03 全部用例 + 既有回归）
  - npm install -g（安装产物直 ship src/，无构建步骤——design Phase 2 已核）
  - 冒烟：sillyspec --version = 3.27.3；tmp 项目构造 junction 自指指针 → run 命令 warn + 本地模式 + exit 0；--spec-dir 真外部目录 → 平台模式保持
  - 工具仓独立 git commit（conventional 风格，84db326 同款），commit message 注明本变更名，不混入主仓文件
acceptance:
  - 全局 sillyspec --version 显示 3.27.3（FR-6）
  - 自指冒烟通过：不进平台模式、内置 sync 不被禁用（FR-3/FR-4 生效态验证）
verify:
  - which sillyspec && sillyspec --version
  - 冒烟输出留存本变更目录 execute 产物
constraints:
  - 不 npm publish（本地全局重装即生效；是否推 npm 由用户另行决定）
---

# task-04 补充说明
跨仓任务：在 sillyspec 仓直做直提；head_commit 回填本卡（发版提交）。
