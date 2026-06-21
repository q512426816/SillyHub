---
author: qinyi
created_at: 2026-06-22T01:40:00
---

# 模块影响矩阵 — 登录支持邮箱/账号 + 平台选择

> 真实改动来源:本次变更 design.md 文件清单 + 已落地的代码(后端已 commit 到 HEAD,前端待提交)。git diff --cached 仅显示未提交前端,后端改动已在更早 commit 持久化(HEAD:service.py 含 username/account 9 处)。

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| auth | 接口变更 + 数据结构变更 | backend/app/modules/auth/{model,schema,service,router}.py | User 加 username 字段;LoginRequest email→account;login 双查(email/username);_lookup_active_user_by_username;bootstrap_admin 补 username | false |
| admin | 接口变更 + 调用关系变更 | backend/app/modules/admin/{schema,users_service,router}.py | UserCreateRequest/UserRead 加 username;create_user 加 username+_resolve_username 去重;_user_with_relations 补 username | false |
| models(迁移) | 数据结构变更 | backend/migrations/versions/202607240900_add_user_username.py | 加 username 列+回填 email 前缀去重加序号+NOT NULL+唯一索引 | true(待 PG 实测) |
| frontend_lib | 调用关系变更 | frontend/src/lib/auth.ts | login(email)→login(account) | false |
| frontend_app | 逻辑变更 | frontend/src/app/(auth)/login/page.tsx | 输入框「邮箱/账号」+ Segmented 平台选择 + 按选择跳转(ppm/sillyhub) + localStorage 持久 | false |
| 测试 | 新增 | backend/tests/modules/admin/test_users_router.py | test_login_by_email_or_username(双查/大小写/防枚举) | false |

## 未匹配文件
无(_module-map 已覆盖 auth/frontend_app/frontend_lib;admin 归入 admin 模块)

## needs_review 说明
- models/migration:needs_review=true,因迁移用 PostgreSQL split_part+ROW_NUMBER,host 无 PG 实测,SQL 已审查待 PG 环境验证回填去重与唯一性
- 其余模块:逻辑明确,已通过测试(ruff/pytest145/tsc/eslint),needs_review=false
