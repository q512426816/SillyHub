---
id: task-03
title: McpToken create dialog dual phase
title_zh: McpToken 签发弹窗 mcp-token-create-dialog（双 phase form 与明文展示）
author: qinyi
created_at: 2026-08-11 15:08:00
priority: P0
depends_on: [task-01]
blocks: [task-06, task-08]
allowed_paths:
  - frontend/src/components/mcp-token-create-dialog.tsx
expects_from:
  task-01:
    needs: [createMcpToken, McpTokenCreated, McpScope]
provides:
  - contract: McpTokenCreateDialog
    fields: [McpTokenCreateDialog]
goal: >
  新增 components/mcp-token-create-dialog.tsx，复刻 api-key-create-dialog 的双 phase（form 提交、plaintext 明文一次展示），
  form 含 name 与 scope 多选（默认勾 read 与 dispatch），明文态展示 token 一次加复制与警示与连接信息，
  props 比 ApiKeyCreateDialog 多 workspaceId，覆盖 FR-02。
implementation:
  - Props 为 workspaceId、onCreated、onClose 三字段，比 ApiKeyCreateDialog 多 workspaceId
  - form phase 含 name 输入（1 到 100 字符）与 scope 多选（read、dispatch、converge，默认勾 read 与 dispatch），提交前校验 name 与 scope 非空
  - 提交调 createMcpToken(workspaceId, 含 name 与 scope 入参) 成功后切 plaintext phase 并触发 onCreated
  - plaintext phase 展示明文 token 一次，配复制按钮、醒目警示（勿入日志或仓库）、连接信息（MCP 服务地址与 Authorization 头用法），关闭后明文不可再获取
acceptance:
  - form 提交成功后切到 plaintext phase，明文仅展示一次
  - scope 默认勾 read 与 dispatch，提交前 name 与 scope 均校验非空
  - 明文态有复制按钮与警示与连接信息，关闭后明文不可再获取
  - createMcpToken 收到 workspaceId 与 name 与 scope
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- mcp-token-create-dialog
constraints:
  - 双 phase 模式 1:1 复刻 api-key-create-dialog，不引入新弹窗体系
  - 明文只展示一次是硬约束（R-06 安全），列表与后续 GET 永不含明文
  - Authorization 头示例用中文描述或纯文本展示，不在代码里写带冒号空格的字面量
  - 代码须兼容 Windows、Linux、macOS
---
