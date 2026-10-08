---
author: flow-machine-draft
created_at: 2026-10-08T02:13:50.083Z
---
# 提案书（Proposal）— 2026-10-08-menu-permissions-page-audit

## 动机

任务原话转写：全站 38 菜单逐页对账：菜单卡权限与页面实际接口鉴权不匹配的还有 7 处（components 缺 workspace:read、changes 缺 task:read、knowledge 缺 knowledge:write、mcp 缺 settings:admin、approvals 缺 task:read+task:run_agent、audit 缺 change:read、incidents 缺 deploy:staging），统一补齐使角色管理勾选器可按页面真实需要配置。

成功标准：
- 上述 7 个菜单卡 permissions 各自补齐缺口权限（既有 key 不删、门控主 key 保持首位）
- 每个新增 key 有后端端点消费依据（router 文件级引用）
- menu-permissions 相关测试（含 6 子菜单 workspace:read 断言、changes/audit 用例）同步更新并全绿
- tsc 与改动文件 eslint 零新增报错

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 上述 7 个菜单卡 permissions 各自补齐缺口权限（既有 key 不删、门控主 key 保持首位）
2. 每个新增 key 有后端端点消费依据（router 文件级引用）
3. menu-permissions 相关测试（含 6 子菜单 workspace:read 断言、changes/audit 用例）同步更新并全绿
4. tsc 与改动文件 eslint 零新增报错

## 成功标准（可验证）

1. 上述 7 个菜单卡 permissions 各自补齐缺口权限（既有 key 不删、门控主 key 保持首位）
2. 每个新增 key 有后端端点消费依据（router 文件级引用）
3. menu-permissions 相关测试（含 6 子菜单 workspace:read 断言、changes/audit 用例）同步更新并全绿
4. tsc 与改动文件 eslint 零新增报错
