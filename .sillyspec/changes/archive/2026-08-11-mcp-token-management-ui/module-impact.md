---
change: 2026-08-11-mcp-token-management-ui
generated_at: 2026-08-11 16:40:00
source: git diff（真实变更，7 文件）
---

# 模块影响矩阵：McpToken 管理 UI

> 三重交叉验证：声明范围（design.md §6 = 4 源码文件）/ 任务范围（plan.md 5 task）/ 真实变更（git diff 7 文件 = 4 源码 + 3 测试）。以 git diff 为准。纯前端、零后端改动。

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| frontend | 新增 | `frontend/src/lib/mcp-tokens.ts` | McpToken API client 三函数（list/create/revoke），复用 api-types 类型 | false |
| frontend | 新增 | `frontend/src/components/mcp-token-create-dialog.tsx` | 签发弹窗双 phase（form/plaintext），明文仅一次 | false |
| frontend | 新增 | `frontend/src/app/(dashboard)/workspaces/[id]/mcp-tokens/page.tsx` | 管理主页（PageHeader + 3 StatCard + SectionCard 表格 + EmptyState + 403 空态 + 吊销确认） | false |
| frontend | 逻辑变更 | `frontend/src/components/workspace-tabs.tsx` | TABS 数组 +1「MCP 令牌」tab（紧邻「MCP」，全可见） | false |
| frontend | 新增(test) | `frontend/src/lib/__tests__/mcp-tokens.test.ts` | lib 三函数单测（5 例） | false |
| frontend | 新增(test) | `frontend/src/components/__tests__/mcp-token-create-dialog.test.tsx` | 弹窗双 phase 单测（6 例） | false |
| frontend | 新增(test) | `frontend/src/app/(dashboard)/workspaces/[id]/mcp-tokens/__tests__/page.test.tsx` | page 403/吊销/列表单测（6 例） | false |

## 模块匹配说明
- 7 个文件全部命中 `_module-map.yaml` 的 **frontend** 模块（paths glob `frontend/**`）。
- **backend / sillyhub-daemon / deploy / ci 零影响**：无后端代码、无 schema、无 openapi.json / api-types.ts 改动（类型复用现有 McpToken* schema）。
- 接口变更：无新增后端端点；前端仅消费既有 `POST/GET/DELETE /api/workspaces/{id}/mcp-tokens`（`mcp_gateway/router.py`，已存在）。

## 未匹配文件
无。
