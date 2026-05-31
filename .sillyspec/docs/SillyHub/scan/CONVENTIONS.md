---
author: qinyi
created_at: 2026-05-29T17:38:00
---

# CONVENTIONS

## 框架隐形规则

- API router 在 `backend/app/main.py` 统一 include，挂载到 `/api` 前缀。
- 后端路由通过 `Depends(get_current_user)` 或 `Depends(require_permission(...))` 显式声明认证授权；无全局认证中间件。
- 异常以 `AppError` 派生类建模（~30 个子类），由 `register_exception_handlers` 统一映射为 HTTP 响应。
- 请求链路使用 request id middleware（读/生成 UUID，附加到 request.state 和 response header）和 structlog。
- 前端 API 层通过 `apiFetch<T>()` 统一处理：自动添加 Authorization header、401 自动 refresh + 重试、统一 `ApiError` 错误类型。
- 前端 AppShell auth guard 检查 Zustand store 的 `accessToken`，缺失则重定向 `/login`。
- 工作流、agent、Git gateway、tool gateway 写入审计或操作日志。

## 实体继承规范

### Backend

- 持久化模型基于 SQLModel，通用基类为 `backend/app/models/base.py` 的 `BaseModel`。
- 所有表模型使用 `(BaseModel, table=True)` 多重继承。
- 基类提供 `id` (UUID)、`created_at`、`updated_at` 通用字段。
- 软删除使用 `deleted_at: datetime | None`（Workspace、User），配合部分唯一索引 `postgresql_where=text("deleted_at IS NULL")`。
- 复活模式：`_resurrect_soft_deleted()` 可在同名 slug 重建时恢复已软删除记录。
- 服务层持有 `AsyncSession`，写入模式：`session.add()` → `commit()` → `refresh()`。

### Frontend

- 无 ORM，类型定义在各 `src/lib/*.ts` 中与 API 函数共存。
- `interface` 用于实体数据结构和 Props 类型；`type` 用于联合字面量和简单别名。
- 约 90+ TypeScript 接口/类型分布在 19 个领域模块中。

## 代码风格

### Backend

| 维度 | 约定 |
|------|------|
| 模块结构 | `model.py` + `schema.py` + `service.py` + `router.py` + `tests/` |
| 函数命名 | snake_case（`list_workspaces`, `soft_delete`） |
| 私有方法 | 单下划线前缀（`_resurrect_soft_deleted`） |
| Schema 命名 | `<Entity><Action>` 后缀：`Create`, `Read`, `Update`, `Response`, `ListResponse`, `Summary` |
| 依赖注入 | `Annotated` 类型别名（`SessionDep`, `CurrentUser`）+ `Depends()` |
| 字段声明 | `Field(...)` 声明验证、默认值和 DB column |
| Lint | Ruff (E,F,I,B,UP,N,SIM,RUF,BLE) line-length=100 + mypy |

### Frontend

| 维度 | 约定 |
|------|------|
| 文件命名 | kebab-case（`workspace-card.tsx`, `api.ts`） |
| 组件命名 | PascalCase |
| 函数命名 | camelCase + CRUD 动词前缀（`listChanges`, `getChange`, `createChange`） |
| 导出模式 | 页面 = `export default`，组件 = 命名导出 |
| CSS | 100% Tailwind utility + shadcn/ui 语义 token（`bg-card`, `text-muted-foreground`） |
| API 函数 | 全部 `export function` 声明式，无箭头函数导出 |
| TypeScript | strict + noUncheckedIndexedAccess |
| 测试 | Vitest + jsdom + Testing Library |
