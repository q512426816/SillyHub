---
author: qinyi
created_at: 2026-08-09 09:10:00
---
# 模块影响分析（Module Impact）— changes.ts 迁 api-types

## 真实变更文件（git diff 为准）

- `frontend/src/lib/changes.ts`
- `frontend/src/lib/api-types.ts`
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx`
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`
- `backend/openapi.json`

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| frontend | 逻辑变更（类型层） | `src/lib/changes.ts`、`src/app/(dashboard)/workspaces/[id]/changes/page.tsx`、`src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` | 11 手写类型迁 api-types alias + 9 保留 shadow 注释 + 2 处调用方 null guard；无运行时行为变化 | false |
| frontend（生成物） | 数据结构变更 | `src/lib/api-types.ts` | 重新生成，含顺手修的 release `workspace_id` 预存 drift | false |
| backend（spec 产物） | 接口变更（生成物同步） | `openapi.json` | 与 api-types.ts 同步的 release `workspace_id` 删除（rule 20 顺手修，非本次业务改动） | false |

## 三重交叉验证

- 声明范围（design.md §6 文件变更清单）：changes.ts + 2 调用方 + api-types/openapi 同步 —— 一致。
- 任务范围（plan.md task-01/task-02 allowed_paths）：一致。
- 真实变更（git diff）：一致，无越权文件。

## 未匹配文件

无。

## 结论

仅影响 frontend 模块（类型层逻辑 + 生成物），backend 仅 spec 生成物同步、无源码逻辑改动。影响面清晰，needs_review 全 false。
