---
author: qinyi
created_at: 2026-06-22T00:50:00
---

# task-04: admin 用户 CRUD 支持 username

## 目标
admin 创建/读取用户时纳入 username 字段，留空时自动按 email 前缀去重生成，与旧用户迁移逻辑统一。

## 涉及文件
- backend/app/modules/admin/schema.py
- backend/app/modules/admin/users_service.py
- backend/app/modules/admin/router.py（调用点：create_user 传 `username=payload.username`）

## 实现要点
- `UserCreateRequest` 新增 `username: Optional[str] = None`（可选）
- router：`svc.create_user(email=…,…)` 增加 `username=payload.username` 传参（调用点修正）
- `UserRead` 新增 `username: str`
- `create_user` 中：若传入 username 则 `.lower().strip()` 直接用；否则 `email.split('@')[0].lower().strip()` 为 base，查表已占用则加 `2/3/…` 去重
- 去重逻辑尽量抽成与 task-02 迁移可复用的工具函数（避免两份实现漂移），若不便复用则保持生成规则字面一致
- 更新/重置等其他接口不强制改 username（非目标范围）

## 覆盖
FR-3, D-001@V1

## 验收
- admin 创建用户时 username 可显式填写或留空
- 留空且前缀已存在时自动生成 `a2`、`a3`
- `UserRead` 返回 username
