---
author: flow-machine-draft
created_at: 2026-10-12T06:19:08.220Z
---
# 提案书（Proposal）— 2026-10-12-init-permission-relax

## 动机

任务原话转写：用户裁决:放宽工作区 init 权限——开发者(developer)等只读角色需要初始化自己的本地环境,当前 /init 要求 workspace-scoped workspace:write 导致 developer 403(生产实证 181144@spdemo request_id 62c277ac)。修订 2026-08-14-security-audit-remediation FR-09 的权限档位,保留其工作区隔离意图。
成功标准：
 - POST /api/workspaces/{id}/init 的权限门从 WORKSPACE_WRITE 改为 WORKSPACE_READ,仍 workspace-scoped
 - 本工作区成员(含 developer 等只读角色)发起 init 不再 403,无 daemon 绑定时走既有 409 MemberBindingNotFound 业务路径
 - 非本工作区成员发起 init 仍 403(FR-09 隔离意图不回退)
 - workspace activate 端点不动(仍是 WORKSPACE_WRITE,本次仅放宽 init)
 - 先写失败测试(developer 409 而非 403 / 非成员仍 403)再改实现,相关 pytest 全绿
 - 接口契约无 DTO 变化,无需重生成 api-types

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. POST /api/workspaces/{id}/init 的权限门从 WORKSPACE_WRITE 改为 WORKSPACE_READ,仍 workspace-scoped
2. 本工作区成员(含 developer 等只读角色)发起 init 不再 403,无 daemon 绑定时走既有 409 MemberBindingNotFound 业务路径
3. 非本工作区成员发起 init 仍 403(FR-09 隔离意图不回退)
4. workspace activate 端点不动(仍是 WORKSPACE_WRITE,本次仅放宽 init)
5. 先写失败测试(developer 409 而非 403 / 非成员仍 403)再改实现,相关 pytest 全绿
6. 接口契约无 DTO 变化,无需重生成 api-types

## 成功标准（可验证）

1. POST /api/workspaces/{id}/init 的权限门从 WORKSPACE_WRITE 改为 WORKSPACE_READ,仍 workspace-scoped
2. 本工作区成员(含 developer 等只读角色)发起 init 不再 403,无 daemon 绑定时走既有 409 MemberBindingNotFound 业务路径
3. 非本工作区成员发起 init 仍 403(FR-09 隔离意图不回退)
4. workspace activate 端点不动(仍是 WORKSPACE_WRITE,本次仅放宽 init)
5. 先写失败测试(developer 409 而非 403 / 非成员仍 403)再改实现,相关 pytest 全绿
6. 接口契约无 DTO 变化,无需重生成 api-types
