---
id: task-02
title: CLI --tool 逗号/重复多值
title_zh: sillyspec init --tool 支持逗号分隔与重复 flag 多值
author: qinyi
created_at: 2026-08-15 16:06:52
priority: P0
depends_on: [task-01]
blocks: [task-04]
requirement_ids: [FR-07]
decision_ids: [D-005@v1]
repo: sillyspec
base_commit: 26550bb765bb76b5b3734374a8e9642391b7979b
head_commit: 01c44daba2c5c2f8a39f8c72bcf156fa255af6a7
allowed_paths:
  - src/index.js
  - src/init.js
  - test/init-tool-multi.test.mjs
goal: >
  --tool 支持 `--tool claude,codex` 逗号分隔与重复 `--tool claude --tool codex` 两种多值形式，收集为数组透传 cmdInit，展开后逐一过 VALID_TOOLS 校验（未知值 exit 1 报错列合法值）。单值行为不变。
implementation:
  - src/index.js 解析段 tool 变量改数组收集（逗号 split + 重复 flag push）
  - case 'init' 透传 tools 数组（cmdInit options 加 tools，向后兼容旧 tool 单值）
  - src/init.js cmdInit：tools 非空数组时全部校验 VALID_TOOLS，与显式 tool 单值合并去重；未提供时保持 detectTools(projectDir) 现行为
  - 未知工具报错信息列出全部合法值（沿用现有文案格式）
acceptance:
  - "--tool claude,codex 同时注入 CLAUDE.md 与 AGENTS.md"
  - 重复 flag 形式等价；去重后无重复注入
  - "--tool claude,foo 会 exit 1 且报错含合法值列表"
  - 不带 --tool 行为不变（detectTools 自动检测）
verify:
  - cd ~/IdeaProjects/sillyspec && npm test（含 test/init-tool-multi.test.mjs：多值注入/去重/非法值报错/单值回归 四用例）
constraints:
  - 单值零回归；与 --no-skills 组合可用（task-01 已落）
---
