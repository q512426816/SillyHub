---
id: task-01
title: CLI --no-skills 开关
title_zh: sillyspec init 支持 --no-skills 跳过 skills 复制段
author: qinyi
created_at: 2026-08-15 16:06:52
priority: P0
depends_on: []
blocks: [task-04]
requirement_ids: [FR-07]
decision_ids: [D-004@v1]
repo: sillyspec
base_commit: 26550bb765bb76b5b3734374a8e9642391b7979b
head_commit: 01c44daba2c5c2f8a39f8c72bcf156fa255af6a7
allowed_paths:
  - src/index.js
  - src/init.js
  - test/init-no-skills.test.mjs
goal: >
  sillyspec init 新增 --no-skills 布尔开关：index.js 解析后透传 cmdInit(dir, { ..., noSkills })，init.js doInstall 收到时跳过"复制 skills 到各工具目录"整段。指令注入（CLAUDE.md/AGENTS.md 等）不受影响。
implementation:
  - src/index.js init 参数解析段（~:185 --tool 附近）加 `--no-skills` 布尔分支（吞进变量不透传 filteredArgs）
  - case 'init' 调 cmdInit 时 options 加 noSkills 字段
  - src/init.js cmdInit 解构 noSkills，透传 doInstall（建议 doInstall 加 options 参数或第 6 参，保持既有调用兼容）
  - doInstall 在"复制 skills 到各工具目录"段前判断 noSkills 为 true 则整段跳过（console.log 一行提示跳过）
acceptance:
  - "sillyspec init --no-skills --tool claude --spec-dir <外部> <dir> 执行后项目内不出现 .claude/skills/ 下 sillyspec-* 目录"
  - 不带 --no-skills 行为与现状完全一致（skills 照常复制）
  - CLAUDE.md/AGENTS.md 指令注入不受 noSkills 影响
verify:
  - cd ~/IdeaProjects/sillyspec && npm test（含新增 test/init-no-skills.test.mjs：--no-skills 跳过复制 + 不带 flag 照常 两用例）
constraints:
  - 默认 false 零回归；--no-skills 与 --tool 任意组合可用
---
