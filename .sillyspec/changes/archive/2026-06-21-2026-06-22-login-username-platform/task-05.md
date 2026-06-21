---
author: qinyi
created_at: 2026-06-22T00:50:00
---

# task-05: bootstrap_admin 补 username

## 目标
首次 bootstrap 新建管理员时补 `username = email 前缀`，避免迁移加 NOT NULL 后 bootstrap 因缺字段失败。

## 涉及文件
- backend/app/modules/auth/service.py

## 实现要点
- 定位 bootstrap_admin 中新建 `User(...)` 的位置（约 service.py:256）
- 构造时新增 `username=email.split('@')[0].lower().strip()`
- 与 task-02 迁移 / task-04 admin 生成规则字面一致（首管理员通常无前缀冲突，简单取前缀即可；若担心冲突可复用 task-04 去重工具）
- 不改 bootstrap 其余逻辑（密码生成、首次标记等）

## 覆盖
FR-4, D-005@V1

## 验收
- 全新库 bootstrap 后管理员 `username` 非空，等于 email 本地部分
- 迁移加 NOT NULL 后再跑 bootstrap 不报错
