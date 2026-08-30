---
author: qinyi
created_at: 2026-08-26 19:45:00
id: task-06
title: "Frontend dual-pane page"
title_zh: "前端双栏页面改造"
priority: P0
depends_on: [task-05]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/skills/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/skills/__tests__/page.test.tsx
goal: 双栏页面（列表+文件树/编辑器+对话框+确认，对照原型）
acceptance: |
  1. 左栏 skill 卡片（名+文件数）+选中展开文件树；新建文件/删除文件/删除 Skill 按钮（SKILL.md 删除禁用）；新建 Skill 对话框（名+描述）
  2. 右栏 textarea 编辑器+未保存标记+保存（PUT）/重置；保存成功 toast「已保存（下次同步对新会话生效）」
  3. 删除二次确认（skill 删除明示目录级不可恢复）
  4. 提示 hint（仅文本≤512KB/文件名字符约束/SKILL.md 保护）
  5. 主题 token 沿用（禁手写色值，规则 20）；对照 prototype-workspace-skill-edit.html
  6. 更新既有 page.test.tsx（:111 只读断言失效）+ 新增交互用例（新建/编辑保存/删除确认/路径错误提示）
implementation: page.tsx 双栏重构（参照原型布局 + explorer 交互习惯）
constraints: ["对照原型视觉", "中文文案", "错误经 useNotify/ErrorBanner"]
verify: cd frontend && pnpm test -- "workspaces.*skills"
expects_from:
  task-05:
    - contract: "skills hooks"
      needs: [5 fetch, 5 hooks, workspaceSkillFile key]
---

# task-06: 前端双栏页面改造

对照原型 prototype-workspace-skill-edit.html 实现。
