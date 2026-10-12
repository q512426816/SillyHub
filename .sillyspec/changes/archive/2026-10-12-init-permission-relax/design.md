---
author: flow-machine-draft
created_at: 2026-10-12T06:19:08.221Z
---
# 设计记录（Design Record）— 2026-10-12-init-permission-relax

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

`POST /api/workspaces/{id}/init`（`backend/app/modules/workspace/router.py:457`）
的权限依赖从 `require_permission(Permission.WORKSPACE_WRITE)` 改为
`require_permission(Permission.WORKSPACE_READ)`，并把 docstring 里的
"鉴权收紧为 workspace-scoped（task-09）"注释更新为修订后的口径。

选这个方案的依据：①init 的语义是"为当前成员初始化本地副本"（D-002/D-009），
服务层 `AgentService.start_init_dispatch` 本就强制发起者必须有成员 daemon
绑定（`MemberBindingResolver.resolve_member_binding` 无绑定即 409
MemberBindingNotFound），权限门只是第二道闸——降为 `workspace:read`
（= 是本工作区成员）后，防线仍由成员绑定+归档区禁写
（`WorkspaceService.ensure_writable`）兜底；②2026-08-14-security-audit-remediation
FR-09 的核心意图是 workspace 隔离（非本工作区成员即便全局有写权限也 403），
本变更保留隔离、只调档位，是修订不是回退；③生产实证 developer 成员
（181144@spdemo）被挡在初始化之外，而开发者正是需要初始化本地环境的日常角色。

测试先行：新建 `tests/modules/workspace/test_init_permission.py`，
developer 成员（角色仅 `workspace:read`，与生产权限精简后的真实种子一致）
期望 409 而非 403（旧实现下先红），非成员期望 403（守护 FR-09 隔离不回退），
activate 非成员仍 403（FR-04 不动面）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `POST /api/workspaces/{id}/init`：权限要求由 workspace-scoped
  `workspace:write` 放宽为 workspace-scoped `workspace:read`。路径、请求体
  （无 body）、成功响应（lease_id/runtime_id/claim_token）与错误体系均不变。
- 成员视角行为变化：developer / viewer / business_member 等仅读角色可进入
  服务层；无 daemon 绑定时得到既有 409 MemberBindingNotFound（此前是 403）。
- 非成员行为不变：403（details 的 permission 字段值随依赖变为 workspace:read）。
- `POST /api/workspaces/{id}/activate` 不动（仍 WORKSPACE_WRITE）。
- 无 DTO/OpenAPI schema 变化，无需重生成 api-types；函数签名无变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：单请求同步权限判定，无事件流。权限缓存（Redis 三键）失效链路不受
影响——权限判定读的是角色权限点，本次只改"要求哪个权限点"，缓存语义不变。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：init 并发语义不变——服务层 ensure_spec_workspace 幂等建容器、lease
创建为独立行，两个成员并发各自初始化各自的本地副本互不冲突；本变更不改
任何写入路径，仅改前置权限判定。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：部署窗口内新旧版本共存时，新前端+旧后端的成员 init 仍会 403（旧行为），
不产生脏状态；旧前端+新后端下成员 init 直接可用。无需灰度——放宽类变更
失败面是"继续 403"，与现状一致。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：权限判定仍按路径 `{workspace_id}` 逐工作区解析（require_permission 的
workspace-scoped 语义），在 A 工作区有角色不会解锁 B 工作区的 init；
归档区禁写守卫（ensure_writable）在服务层按目标工作区生效，不受影响。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：viewer（访客）也获得 init 权限。独立评审（review.json P2，
2026-10-12）修正本节初稿的两处不准确表述，以下为补正后口径：

- 初稿称"访客通常无 daemon 绑定，实际停在 409"——不准确：访客可以
  自建绑定，`PUT /my-binding` 权限门同为 WORKSPACE_READ
  （member_runtimes/router.py:121），"通常无绑定"只是运营假设，不是防线。
- 初稿称"init 不产生服务端提权"——不准确：init lease claim 是
  `shpsync_` sync token 的全仓唯一签发点（daemon/lease/context.py:856），
  持 token 可经 `POST /changes/-/spec-sync` 由
  `SpecWorkspaceService.apply_ops` 单事务直写服务端 spec 源
  （platform_sync/router.py:233-264，无审批门），另有 progress/documents/
  approval/quicklog/agent-logs 五个写端点同通道。
- 净新增面评估：shpsync 写链路对可写角色本就存在、本次未改它；本次把
  触发人群扩大到全部只读成员（viewer 含绑定自建路径）。
- 裁决：有条件可接受——init 本体（拉自己本地副本、lease 有 runtime
  owner 归属校验跨用户 404）无害；shpsync 链路沿用既有权限语义。
  跟进项（独立变更，不阻塞本收口）：服务层按角色收窄 init 触发面，
  或收窄 shpsync sync token 的写域。

试过/考虑过但放弃的方案：
- 保持 WORKSPACE_WRITE、给 developer 角色加 workspace:write 权限点：
  动的是全局角色种子，波及所有带写语义的端点（成员管理、配置修改等全部
  对 developer 开放），远超"允许初始化本地环境"的诉求，弃。
- 仅对 init 例外放行 business_member/developer 白名单角色：在权限体系外
  引入角色名硬编码（ROLE_KEY_WHITELIST 模式），角色演进时易漂移，
  workspace:read 已是"成员"的最自然表达，弃。
- activate 一并放宽：用户裁决仅放宽 init，activate 语义（激活工作区本体）
  仍是写操作，不动，弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | backend/app/modules/workspace/router.py | init 端点权限依赖 WORKSPACE_WRITE→WORKSPACE_READ + 注释口径更新 |
| 增 | backend/tests/modules/workspace/test_init_permission.py | init 权限边界测试（developer 409/非成员 403/activate 不动） |
