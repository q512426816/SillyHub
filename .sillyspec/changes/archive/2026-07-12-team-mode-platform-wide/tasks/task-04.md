---
id: task-04
title: mission-console 表单加 mode 双卡片选择 + 角色预览 + 预算提示
title_zh: mission-console 表单加 single/team 选择 UI
author: qinyi
created_at: 2026-07-12 10:41:54
priority: P1
depends_on: [task-03]
blocks: []
requirement_ids: [FR-1]
decision_ids: [D-003, D-004]
allowed_paths:
  - frontend/src/components/mission-console.tsx
---

## 目标

mission-console 创建表单（MissionConsole 组件 :279-410）加 mode 选择 UI：
- single/team 双卡片选择（single 绿 / team 紫）
- team 选中时显示角色预览 chips（复用现有 ROLE_LABEL :32-40 的 7 角色）+ 预算提示
- onCreate 调 createMission 时传 mode

**参考原型**（brainstorm 已确认视觉/交互，照原型实现）：
`C:\Users\qinyi\.sillyhub\daemon\specs\56c70aa3-4067-4648-b139-aa5360b38ec4\changes\2026-07-12-team-mode-platform-wide\prototype-team-mode-platform-wide.html`

**参考样式系统**（CLAUDE.md 规则 17）：
`.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/prototype-frontend-style-system.html`

## 实现要点

1. 加 state：`const [mode, setMode] = useState<"single" | "team">("single")`（默认 single）。
2. 在创建表单区（:350-379，textarea objective + budget input + 启动按钮 之前）插入 mode 双卡片选择 UI（照原型布局）。
3. team 选中时，mode 选择下方显示：
   - 角色预览 chips（arch/code_style/test/integration/risk/impl/verify，用 ROLE_LABEL :32-40 中文标注）
   - 预算提示文案（如"团队模式将拆分 1-5 个 worker 并行，建议设置预算上限"）
4. onCreate（:310-329）调 createMission 时传 mode（mission 页无 session 上下文，session_id 省略）：
   ```typescript
   await createMission(workspaceId, { objective, budget_usd, mode, change_id: null })
   ```
5. 样式：single 卡片绿色系，team 卡片紫色系（照原型 + 样式系统 token）。

## 验收标准

- 表单渲染 single/team 两卡片，默认选中 single（绿色）。
- 点 team（紫色）→ 显示 7 角色 chips + 预算提示。
- 点 single → 隐藏角色/提示，保留原表单。
- 提交时 createMission input 含 mode。
- `pnpm typecheck` + mission-console 现有测试不回归。

## verify

```
cd frontend && pnpm typecheck
cd frontend && pnpm test -- mission-console
```

## 约束

- 只改 mission-console.tsx，不动其他前端文件。
- 不改 createMission 函数签名（task-03 加 input 字段）。
- 复用 ROLE_LABEL，不重新定义角色映射。
- 样式照原型 + 样式系统，不凭空设计。
