---
author: qinyi
created_at: 2026-06-22T00:45:00
---

# Proposal

## 动机
当前登录仅支持 email，用户希望用「账号」或「邮箱」登录，旧用户要有账号（email 前缀）；并需登录页选择进入「项目管理平台(ppm)」或「SillyHub」。

## 关键问题
1. `User` 无 username 字段，无法用账号登录
2. 旧用户无账号，需补 `username = email 前（@ 前）`
3. 登录后固定跳 `/workspaces`，无法直接进 ppm

## 变更范围
User 加 username + alembic 一体迁移补账号 + 登录双查 + admin CRUD 补 username + bootstrap 补 username + 登录页 Segmented 平台选择 + 按选择跳转。

## 不在范围内
- 不改 JWT / RBAC / Session 生命周期 / 权限体系
- 不做账号自助找回或修改账号 UI
- 不做 MFA

## 成功标准（可验证）
- 旧用户可用 email 前缀（或邮箱）登录
- 登录页可选平台，登录后跳转正确（ppm→/ppm/projects、sillyhub→/workspaces）
- admin 创建用户可填或自动生成 username
- 迁移后 username 全局唯一、无 NULL
