---
author: qinyi
created_at: 2026-07-04T19:05:30
---

# Proposal — 修复前端 OpenAPI 类型对齐的 5 处分叉

## 动机
项目正在把手写 TS 类型迁移到 OpenAPI 生成类型（`frontend/src/lib/api-types.ts`）。已完成 7 模块（`fecaa155`）。剩余 5 处分叉中有 3 处是活跃 bug，2 处是未完成迁移。本变更一次性消除这 5 处分叉，让前端 5 模块全部走生成类型，后端契约与运行时响应一致。

## 关键问题（为什么现状不够）
1. **scan-docs 徽章恒 undefined**：`scan-docs/page.tsx:75,80` 渲染"来源成员 / 冲突数"徽章，但后端 `ScanDocSummary` 不返这些字段，`conflict_count` 甚至从未实现（`/conflicts` 端点不存在）。功能名义存在、实际空转，用户看到的是永远空白的徽章。
2. **runtime OpenAPI 撒谎**：DTO 用 `Field(alias=camelCase)` 配 `response_model_by_alias=False`，运行时返 snake_case 但 OpenAPI 按 camelCase 生成。前端若迁移到生成类型，字段访问全部错位 —— 这是迁移路上的"地雷"，必须先拆。
3. **audit 类型与运行时不符**：`details_json` 后端是 JSON 字符串（Text 列），前端类型写成 object，`page.tsx` 用 `JSON.stringify` 对字符串二次序列化，类型撒谎且搜索语义错误。

## 变更范围
- **后端**：runtime 删 alias + service 构造参数改 snake；scan-docs schema 补字段 + conflict_count 聚合 + conflicts 端点；workspace-binding 三端点加 response_model。
- **重生**：`pnpm gen:types` 一次（dump openapi.json + 生成 api-types.ts）。
- **前端**：5 模块类型迁移到生成类型（scan-docs/runtime/audit/workspace-binding/workspaces）+ audit page.tsx 改 `JSON.parse`。

## 不在范围内（显式）
- 不重写 scan-docs 冲突解决 UI（仅暴露冲突**计数**和只读**历史**）。
- 不改 audit 存储格式（`details_json` 保持 string Text 列，是合理的审计表设计）。
- 不迁移 daemon/changes/admin 模块（孤儿类型多 / dict 退化 / 后端重构分叉，负收益，留后续）。
- 不改 workspace-binding 业务逻辑（仅加 response_model）。

## 成功标准（可验证）
- scan-docs 徽章显示真实来源成员 / 冲突数（不再 undefined）。
- runtime OpenAPI 类型字段为 snake_case，与运行时响应一致；前端 RuntimeProgress 走生成类型。
- audit `details_json` 类型为 `string | null`，page.tsx 正确 `JSON.parse` 后判断。
- workspace-binding `MemberBindingView` 走生成类型。
- workspaces 9 类型走生成类型，`WorkspaceStatus` 含 `"pending"`。
- backend `uv run pytest -q` 全绿；frontend `pnpm typecheck` + `pnpm test` 全绿，无回归。
- `pnpm gen:types:check` 通过（api-types 与 openapi.json 一致）。
