---
author: qinyi
created_at: 2026-06-22T00:50:00
---

# task-01: User 加 username 字段

## 目标
`User` 模型新增全局唯一的 `username` 字段，作为登录账号双查的基础。

## 涉及文件
- backend/app/modules/auth/model.py

## 实现要点
- 在 `User` 上新增 `username: Mapped[str]`，类型 `String(100)`， nullable 先设 True（由迁移回填后再加 NOT NULL + UNIQUE）
- 对齐现有 `email` 字段的列定义风格（长度/索引命名），不直接加 ORM 层 `unique=True`，唯一约束交由 alembic 索引管理
- 字段顺序放在 `email` 之后、`display_name` 之前，语义聚合
- repr/str 如有 username 字段可顺手加入，方便调试

## 覆盖
FR-1, D-003@V1

## 验收
- ruff / mypy 通过
- `User.username` 可在代码中读写
- 迁移执行后该列存在且具备唯一索引（索引本身由 task-02 建立）
