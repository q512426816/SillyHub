---
author: qinyi
created_at: 2026-05-29T17:38:00
---

# CONVENTIONS — backend

## 框架隐形规则

- 所有路由在 `app/main.py` 的 `create_app()` 中通过 `app.include_router()` 注册，统一挂载 `/api` 前缀。
- 认证/授权通过 `Depends(get_current_user)` 或 `Depends(require_permission(...))` 逐路由声明，无全局认证中间件。
- `CORSMiddleware` 全局挂载，允许 credentials，暴露 `x-request-id`。
- `request_id_middleware` 读取或生成 UUID，附加到 `request.state` 和 response header。
- 异常统一由 `AppError` 层次结构建模，`register_exception_handlers(app)` 注册全局异常处理。
- 服务层使用 `AsyncSession`，通过 `get_session` 依赖注入，异常时自动回滚。
- Settings 通过 `@lru_cache` 单例加载，从 `.env` / 环境变量读取。

## 实体继承规范

- 基类 `BaseModel(SQLModel)` 定义于 `app/models/base.py`，提供 `id` (UUID)、`created_at`、`updated_at`。
- 所有表模型使用 `(BaseModel, table=True)` 多重继承。
- 软删除：`deleted_at: datetime | None`，配合部分唯一索引豁免已删除记录。
- 复活：`_resurrect_soft_deleted()` 方法可在同名 slug 重建时恢复。
- `created_by` / `updated_by` 为按需添加字段（Workspace、PlatformSetting）。
- 写入模式：`session.add(obj)` → `await session.commit()` → `await session.refresh(obj)`。

## 代码风格

| 维度 | 约定 | 示例 |
|------|------|------|
| 目录结构 | `modules/<feature>/model.py + schema.py + service.py + router.py` | — |
| 函数命名 | snake_case | `list_workspaces`, `soft_delete` |
| 私有方法 | 单下划线前缀 | `_resurrect_soft_deleted`, `_build_slug_query` |
| Schema 命名 | `<Entity><Action>` | `WorkspaceCreate`, `ChangeRead`, `TaskListResponse` |
| 依赖注入 | `Annotated` 类型别名 | `SessionDep`, `CurrentUser` |
| 字段声明 | `Field(...)` + 验证 + 默认值 | `name: str = Field(..., min_length=1)` |
| 异常命名 | `<Resource><Event>` | `WorkspaceNotFound`, `PermissionDenied` |
| Lint | Ruff + mypy | line-length=100, asyncio_mode=auto |
