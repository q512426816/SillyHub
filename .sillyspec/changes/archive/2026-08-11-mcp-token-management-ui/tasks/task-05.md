---
id: task-05
title: Vitest unit tests and regression check
title_zh: vitest 单测（lib 三函数 + 弹窗双 phase + page 403 空态 + 吊销确认）+ 回归核查
author: qinyi
created_at: 2026-08-11 15:08:00
priority: P1
depends_on: [task-01, task-02, task-03, task-04]
blocks: []
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/mcp-tokens/__tests__/page.test.tsx
  - frontend/src/lib/__tests__/mcp-tokens.test.ts
  - frontend/src/components/__tests__/mcp-token-create-dialog.test.tsx
goal: >
  补 vitest 单测覆盖 lib 三函数（mock fetch）、签发弹窗双 phase 切换、page 403 无权限空态、吊销二次确认，
  并做回归核查确保 api-keys 页、workspace 其他 tab、mcp 只读页零影响，覆盖 AC-06。
implementation:
  - lib 测试 mock fetch 验证 listMcpTokens 解包 items、createMcpToken 返明文、revokeMcpToken DELETE 路径与编码
  - 弹窗测试验证 form 提交切 plaintext、scope 默认勾 read 与 dispatch、明文复制回显
  - page 测试 mock listMcpTokens 返 403 验证无权限空态且不泄漏存在性，以及吊销确认与刷新
  - 回归核查确认 api-keys 页、其他 workspace tab、mcp 只读页未被改动，跑全量 vitest 与 tsc
acceptance:
  - 新增 lib、弹窗、page 三组 vitest 全通过
  - 403 场景渲染无权限空态且不泄漏 token 存在性
  - 吊销场景需二次确认且成功后刷新
  - 全量 vitest 与 tsc 零回归，api-keys 页与其他 tab 不受影响
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test
constraints:
  - 仅加 allowed_paths 内测试文件，不加无关测试
  - mock fetch 而非真实网络，与现有 lib 测试风格一致
  - 回归核查以全量 vitest 与 tsc 为准，不跑后端测试（纯前端变更）
---
