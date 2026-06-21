---
author: qinyi
created_at: 2026-06-22T00:45:00
---

# Requirements

## 角色
| 角色 | 能力 |
|---|---|
| 普通用户 | 邮箱或账号登录；登录时选平台 |
| 平台管理员 | admin CRUD 用户（含 username） |

## 功能需求
| FR | 描述 | 决策 |
|---|---|---|
| FR-1 | User 新增 username（唯一）；alembic 迁移 username=email 本地部分，前缀重复加序号（a/a2/a3） | D-003 |
| FR-2 | 登录支持邮箱或账号：含 `@` 查 email、不含查 username，均 `.lower().strip()` | D-002 |
| FR-3 | admin 创建用户 username 可选，留空自动 email 前缀 + 去重 | D-001 |
| FR-4 | bootstrap_admin 新建管理员补 username=email 前缀 | D-005 |
| FR-5 | 登录页 Segmented 平台选择（项目管理平台/SillyHub），默认 SillyHub，localStorage 持久 | D-004 |
| FR-6 | 登录后按平台跳转：ppm→/ppm/projects，sillyhub→/workspaces | — |

## 行为规格（GWT）
- G 用户 username=a、密码正确；W 输 `a` 登录 → T 签发 token
- G 用户 email=a@x.com、密码正确；W 输 `a@x.com` 登录 → T 签发 token
- G 两个用户 email 前缀同为 `a`；W 迁移 → T username=`a`、`a2`
- G 选「项目管理平台」登录成功；W 跳转 → T 到 `/ppm/projects`
- G 选「SillyHub」登录成功；W 跳转 → T 到 `/workspaces`

## 非功能
- 登录失败防枚举：统一 `Invalid email or password.`（沿用现状）
- username 大小写不敏感（统一 lower）
- 迁移事务原子（单 alembic revision）

## 决策覆盖
D-001@V1→FR-3 | D-002@V1→FR-2 | D-003@V1→FR-1 | D-004@V1→FR-5 | D-005@V1→FR-4
