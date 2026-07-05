---
author: qinyi
created_at: 2026-07-04T00:51:06
---

# proposal — 后端 OpenAPI 自动生成前端 TypeScript 类型

## 一句话

把后端 FastAPI 已暴露的 OpenAPI 作为唯一真相源，自动生成前端 TypeScript 类型，消除前端 `lib/` 下 ~30 个模块靠手写 interface + 注释 "Mirrors backend schema.py" 维护契约导致的漂移。

## 背景与动机

前端 `frontend/src/lib/` 约 30 个 API 客户端模块全部手写 interface，靠注释提醒同步后端 schema。这种「人肉契约」必然漂移，已有铁证：

- 前端 `workspaces.ts:26`：`WorkspaceStatus = "active" | "archived" | "deleted"`
- 后端 `schema.py:12`：`Literal["pending", "active", "archived", "deleted"]`
- 前端**漏掉 `pending`** —— workspace 刚创建未激活时前端类型识别不到，这是会真实导致 bug 的漂移。

后端 FastAPI 在 `main.py:96` 已暴露 `/api/openapi.json`，是现成的、与代码强一致的契约源。本变更把它接起来，建立「后端 schema 改 → 前端类型自动跟改」的闭环。

## 价值

1. 根治前后端类型漂移（pending 这类问题不会再发生）
2. 后端 schema 变更对前端可见、可 review（生成的 api-types.ts 提交进 git）
3. CI/pre-commit 守门：schema 改了但前端类型没重新生成 → 提醒
4. 为后续「daemon JSON Schema 共享」「全量迁移 33 模块」「mypy 清理」奠基（三件套中最先落地、风险最低的一个）

## 方案概要

详见 design.md。核心：openapi-typescript（纯类型生成）+ 后端静态 dump openapi.json + 前端 `api-types.ts`（commit 进 git）+ pre-commit 提醒式守门 + health.ts 示范迁移。

## 非目标（明确不做，防止 scope creep）

- 不全量迁移 33 个 lib 模块（仅 health.ts 示范，证明闭环 work；全量迁移作为后续 task）
- 不改后端 dict 返回值为 Pydantic（如 quick_chat；独立变更）
- 不做 daemon JSON Schema 共享（独立变更，OpenAPI 描述不了 WebSocket）
- 不加运行时 zod 校验（仅编译期类型；YAGNI）
- 不清理 mypy disable_error_code（独立变更）

## 关联

- 架构契约改进三件套之一（前端类型生成 / daemon 契约共享 / mypy 清理），最先落地。
