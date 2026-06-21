---
author: qinyi
created_at: 2026-06-22T00:45:00
---

# Decisions

## D-001@V1 新建用户 username 处理
- type: boundary
- status: accepted
- 决策：admin 创建用户 username 可选，留空自动 = email 前缀 + 去重加序号（与旧用户迁移统一）
- 来源：code（admin UserCreateRequest 无 username + create_user display_name=email前缀）

## D-002@V1 username 大小写
- type: boundary
- status: accepted
- 决策：username 统一 `.lower().strip()` 存储与查询（对齐 email 现状）
- 来源：code（auth/service.py:142 email.lower()）

## D-003@V1 username 唯一约束
- type: architecture
- status: accepted
- 决策：全局唯一索引 `ux_users_username`，迁移脚本去重保证
- 来源：code（ux_users_email_active 先例）

## D-004@V1 登录默认平台
- type: boundary
- status: accepted
- 决策：Segmented 默认选中 SillyHub（主平台），选择 localStorage 持久回填
- 来源：user（AskUserQuestion 确认页内控件）

## D-005@V1 bootstrap_admin 补 username
- type: consistency
- status: accepted
- 决策：bootstrap 新建管理员时 username = email 前缀（与迁移统一），避免 username NOT NULL 后 bootstrap 失败
- 来源：Design Grill 发现（auth/service.py:256 User 创建无 username）
