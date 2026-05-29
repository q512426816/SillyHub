---
author: qinyi
created_at: 2026-05-27 09:43:14
---

# CONVENTIONS

## 框架隐形规则

- API router 在 `backend/app/main.py` 统一 include，并挂载到 `/api`。
- 后端路由通过 `Depends(get_current_user)` 或 `Depends(require_permission(...))` 显式声明认证授权；无全局认证中间件。
- 异常以 `AppError` 派生类建模，并由 `register_exception_handlers` 统一映射响应。
- 请求链路使用 request id middleware 和 structlog。
- 工作流、agent、Git gateway、tool gateway 写入审计或操作日志。

## 实体继承规范

- 持久化模型基于 SQLModel，通用基类为 `backend/app/models/base.py` 的 `BaseModel`。
- 多数实体使用 UUID 主键、`created_at`、`updated_at` 或业务时间字段。
- 用户删除采用 `deleted_at` / `status` 软删除语义；变更使用 `archived_at` 表示归档。
- 服务层持有 `AsyncSession`，常见写入模式为 `session.add(...)`、`commit()`、`refresh(...)`。

## 代码风格

- 后端模块通常包含 `model.py`、`schema.py`、`service.py`、`router.py` 和 `tests/`。
- Pydantic/SQLModel 字段使用 `Field(...)` 声明验证、默认值和 DB column。
- 前端 API client 位于 `frontend/src/lib/*.ts`，页面通过 dashboard 路由分区。
- 前端 UI 使用 Tailwind utility class、`Badge` / `Button` 等共享组件。
- 测试覆盖以模块级 pytest 和 Vitest 为主。
