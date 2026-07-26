---
author: qinyi
created_at: 2026-07-25 21:21:12
---

# 提案书（Proposal）— 业务/管理人员借用开发人员 daemon 读源码出业务方案

## 动机

系统有两类用户：开发人员（电脑有 daemon + 源码）、业务/管理人员（无 daemon 无源码）。业务人员需要读开发源码、跑 agent 分析、出业务方案、落系统。现状是"自带 daemon 才能玩"，业务人员被三道闸门（绑定 / 派发 / 角色）完全挡在外面，无法自助完成"读源码出方案"。

## 关键问题（现有方案为什么不够）

1. **collaborative-workspace 只支持"成员各自自带 daemon"协作**，不允许借用他人 daemon：`service.py:49-56` daemon_not_owned / `queries.py:38-48` + `placement.py:768-775` 派发校验 / viewer 无 `task:run_agent`。
2. **host_fs 委托虽已有"按工作空间解析 daemon、不校验归属"的窄路**（`queries.py:115-168`），但只用于读文件，没接到完整 agent 派发。
3. **业务人员无任何途径**触发 agent 读源码出方案——要么求开发人员代跑（体验差、依赖开发有空），要么自己装 daemon（业务人员不该装）。

## 变更范围

让无 daemon 的业务人员借用工作空间里开发人员"共享出来"的 daemon：
1. 数据模型：`shared` 标记 + 借用审计表
2. 权限：`DAEMON_BORROW` 权限点 + `business_member` 角色
3. 派发：4 路 resolver 收敛到共享 helper，无自有 daemon 时回退借用
4. daemon 沙箱：按 lease 隔离只读 policy，不污染开发代码
5. 落点：方案经 FileService 落文件中心
6. 前端：共享开关 / owner 管理 / 业务触发（无感）/ 方案查看

## 不在范围内（显式清单）

- 不做服务器侧 agent（不回退已删的 SERVER backend）
- 不做借用审批流（自动借用）
- 不做额度限额（仅审计）
- 不做跨工作空间借用
- 不改 collaborative-workspace 既有 per-member 自带模型
- 业务人员不改代码（只读源码 + 出方案）
- 不做 HTML 原型大改（前端辅助，留 plan 细化）

## 成功标准（可验证）

- 现有"自带 daemon"用户/路径行为**完全不变**（`shared` 默认 false、`DAEMON_BORROW` 默认不授、helper 第 1 步原路径）——零回归
- 开发人员能把自己的 daemon 标记为工作空间共享；owner 能看到并撤销
- 业务人员（business_member 角色）触发 agent 时，系统自动借用工作空间在线共享 daemon，跑 agent 读源码出方案
- 方案落到文件中心，业务人员工作台可见（`created_by=业务人员`）
- 借用 agent **不能写开发人员代码区**（只读 root_path，写边界测试通过）
- 借用全程记审计（borrower / lender / daemon / workspace / run / usage）
