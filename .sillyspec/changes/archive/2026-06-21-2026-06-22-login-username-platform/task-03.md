---
author: qinyi
created_at: 2026-06-22T00:50:00
---

# task-03: 登录双查 — LoginRequest.account + _lookup_active_user_by_username

## 目标
登录字段 `email` → `account`，根据是否含 `@` 走 email 或 username 查询，均 `.lower().strip()`，失败统一防枚举报错。

## 涉及文件
- backend/app/modules/auth/schema.py
- backend/app/modules/auth/service.py
- backend/app/modules/auth/router.py（调用点：login 改 `account=payload.account`）

## 实现要点
- schema：`LoginRequest.email: str` → `account: str`（保留 min_length=3）；如有响应/示例同步改名
- router：`AuthService.login(email=payload.email,…)` → `login(account=payload.account,…)`（调用点修正，符号影响面）
- service `AuthService.login(account, password, …)` 签名同步改 `account`
- 新增 `_lookup_active_user_by_username(self, username)`：`.lower().strip()` 后按 username 查活跃用户，结构对齐现有 `_lookup_active_user_by_email`
- 分流逻辑：`'@' in account` → 走 email 查；否则走 username 查
- 查不到 / 密码错统一抛 `AuthInvalidCredentials`（沿用现状，防枚举）
- 同步修改 login 方法内其余 `email` 变量名为 `account`，避免语义错位

## 覆盖
FR-2, D-002@V1

## 验收
- `a@x.com` 与 `a` 两种输入均能登录同一用户
- 不存在的账号、密码错误均返回相同错误信息
- username/email 大小写、首尾空格不影响登录
