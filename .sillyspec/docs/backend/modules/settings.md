---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# settings

> 最后更新：2026-05-31
> 最近变更：`53383c5` feat(component-as-workspace): Workspace Graph data plane
> 模块路径：`app/modules/settings/**`

## 职责

平台设置与用户管理模块。提供两个独立功能域：(1) 平台级 key-value 配置项的读取和批量更新；(2) 用户 CRUD 管理（创建、列表、更新、软删除）。无独立 service 层，业务逻辑直接内联在 router 中。

## 当前设计（架构 + 关键逻辑）

**平台设置（PlatformSetting）**：
- 简单 key-value 存储，key 为主键（最大 100 字符），value 为字符串
- `GET /settings`：返回所有配置项列表
- `PUT /settings`：批量 upsert（存在则更新，不存在则创建），记录 updated_by 和 updated_at
- 无 key 命名空间或分组机制，使用方自行约定 key 命名规范

**用户管理（User）**：
- `GET /users`：分页列表，支持 status 过滤，排除软删除用户
- `POST /users`：创建用户，密码经 `password_hasher` 哈希，email 自动转小写去空格，display_name 默认取 email 前缀
- `PATCH /users/{user_id}`：更新 display_name / is_platform_admin / status
- `DELETE /users/{user_id}`：软删除（设置 deleted_at + status="deleted"），非物理删除

**认证**：所有端点要求登录（`get_current_user`），但未做角色细分校验（任何登录用户均可操作）。实际权限控制应在中间件或反向代理层实现。

## 对外接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/settings` | 列出所有平台设置 | 登录用户 |
| PUT | `/settings` | 批量更新设置（upsert） | 登录用户 |
| GET | `/users` | 列出用户（分页，?status= 过滤） | 登录用户 |
| POST | `/users` | 创建用户 | 登录用户 |
| PATCH | `/users/{user_id}` | 更新用户信息 | 登录用户 |
| DELETE | `/users/{user_id}` | 软删除用户 | 登录用户 |

## 关键数据流

```
PUT /settings
  → 遍历 payload.settings (dict[str, str])
    → session.get(PlatformSetting, key)
      → 存在 → 更新 value / updated_by / updated_at
      → 不存在 → 创建新行
  → commit → 返回 {updated: [key1, key2, ...]}

POST /users
  → password_hasher.hash(payload.password)
  → User(id=uuid4, email=lower+strip, password_hash, ...)
  → session.add → commit → refresh → return
```

## 设计决策

| 决策 | 原因 |
|------|------|
| 无独立 service 层 | 设置和用户管理逻辑简单，直接在 router 内联减少样板代码 |
| 软删除用户（deleted_at + status） | 保留历史关联数据完整性，支持审计追溯 |
| key 作为主键 | key-value 场景天然适合，无需额外 ID |
| 批量 upsert 而非逐项 API | 设置通常需要原子性批量更新，减少请求次数 |
| 无 key 命名空间 | 简化设计，依赖约定（如 `feature_xxx.enabled`）而非强制分区 |

## 依赖关系

- **模型**：PlatformSetting（platform_settings 表，key PK）、User（auth.model.User）
- **基础设施**：password_hasher（argon2/phc 哈希）、get_current_user（JWT 认证）
- **下游被依赖**：全模块（User 作为通用主体模型）

## 注意事项

- **权限模型粗糙**：当前所有端点仅需登录即可访问，缺少 admin 角色检查，生产环境需补充 RBAC
- 设置项 value 为纯字符串，复杂值需 JSON 序列化后存储
- 用户删除为软删除但 `status_filter` 默认不过滤 deleted 状态，需前端显式过滤
- User 模型定义在 auth 模块中，settings 模块仅消费，修改需跨模块协调
- 密码最小长度由 schema 校验（`min_length=8`），未实现复杂度策略

## 变更索引

| 日期 | 变更 |
|------|------|
| 2026-05-31 | 初始归档文档 |
