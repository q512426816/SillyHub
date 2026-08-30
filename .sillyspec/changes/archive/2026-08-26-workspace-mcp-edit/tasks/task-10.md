---
author: qinyi
created_at: 2026-08-26 14:20:00
id: task-10
title_zh: "前端页面双态改造与测试"
title: "前端页面双态改造与测试"
priority: P0
depends_on: [task-09]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/mcp/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/mcp/__tests__/page.test.tsx
  - frontend/src/lib/__tests__/workspace-mcp-edit.test.ts
goal: 页面查看/编辑双态（textarea JSON + zod 校验 + 提示文案，对照原型），更新既有失效测试并新增编辑态用例
acceptance: |
  1. 查看态保持现有卡片样式（FieldRow/脱敏 <set> 标注零变化）；「编辑」按钮进入编辑态，「取消」退出不保存，「刷新」仅查看态
  2. 编辑态：textarea JSON（初始值=当前 GET 结果序列化 indent 2）+ zod 校验（JSON 语法/顶层 mcpServers/command 非空/args 数组/仅 stdio，报错中文且含 server 名）
  3. 保存：调 useUpdateWorkspaceMcpConfig，成功回查看态并 refetch；失败 ErrorBanner/useNotify 中文提示
  4. 提示文案三条（design §7.4）：<set> 语义 / 白名单生效条件 / agent 画像 mcpRefs 可能进一步收窄
  5. 既有 page.test.tsx 更新（现断言「只读/无编辑」文案已失效）+ 新增编辑态用例（进入编辑/校验拦截/保存成功/取消）
  6. 样式对照原型 prototype-workspace-mcp-edit.html（双主题 token，不另起风格）
verify: cd frontend && pnpm test -- "workspaces.*mcp\|workspace-mcp-edit"
implementation: page.tsx 查看/编辑双态 + zod 校验 + 提示文案（对照原型），更新既有 page.test.tsx + 新增编辑态用例
constraints: ["主题 token var 化禁手写色值（规则 20）", "查看态零变化", "错误中文定位 server 名"]
expects_from:
  task-09:
    - contract: "useUpdateWorkspaceMcpConfig"
      needs: [useUpdateWorkspaceMcpConfig, invalidate workspaceMcpConfig.detail]
---

# task-10: 页面双态改造

## 实现要点

- zod schema 就近放页面或 lib（参照 settings/mcp/page.tsx 既有 zod 先例）；校验错误信息格式：`校验失败：server "X" ...`（中文定位）
- 保存按钮 loading 态（mutation.isPending）；双主题 token（brand-*/shadow-* var 化，禁止手写色值——CLAUDE.md 规则 20）
- 原型文件为本任务视觉/交互对照基准（编辑说明 hint、白名单提示 hint、错误行、toast 均已画）
