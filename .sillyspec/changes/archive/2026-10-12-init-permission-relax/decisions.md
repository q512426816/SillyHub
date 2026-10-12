---
author: flow-machine-draft
created_at: 2026-10-12T06:32:30.899Z
---
# 决策记录（Decisions）— 2026-10-12-init-permission-relax

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：viewer（访客）也获得 init 权限。独立评审（review.json P2， 2026-10-12）修正本节初稿的两处不准确表述，以下为补正后口径： - 初稿称"访客通常无 daemon 绑定，实际停在 409"——不准确：访客可以 自建绑定，`PUT /my-binding` 权限门同为 WORKSPACE_READ （member_runtimes/router.py:121），"通常无绑定"只是运营假设，不是防线。 - 初稿称"init 不产生服务端提权"——不准确：init lease claim 是 `shpsync_` sync token 的全仓唯一签发点（daemon/lease/context.py:856）， 持 token 可经 `POST /changes/-/spec-sync` 由 `SpecWorkspaceService.apply_ops` 单事务直写服务端 spec 源 （platform_sync/router.py:233-264，无审批门），另有 progress/documents/ approval/quicklog/agent-logs 五个写端点同通道。 - 净新增面评估：shpsync 写链路对可写角色本就存在、本次未改它；本次把 触发人群扩大到全部只读成员（viewer 含绑定自建路径）。 - 裁决：有条件可接受——init 本体（拉自己本地副本、lease 有 runtime owner 归属校验跨用户 404）无害；shpsync 链路沿用既有权限语义。 跟进项（独立变更，不阻塞本收口）：服务层按角色收窄 init 触发面， 或收窄 shpsync sync token 的写域。 试过/考虑过但放弃的方案： - 保持 WORKSPACE_WRITE、给 developer 角色加 workspace:write 权限点： 动的是全局角色种子，波及所有带写语义的端点（成员管理、配置修改等全部 对 developer 开放），远超"允许初始化本地环境"的诉求，弃。 - 仅对 init 例外放行 business_member/developer 白名单角色：在权限体系外 引入角色名硬编码（ROLE_KEY_WHITELIST 模式），角色演进时易漂移， workspace:read 已是"成员"的最自然表达，弃。 - activate 一并放宽：用户裁决仅放宽 init，activate 语义（激活工作区本体） 仍是写操作，不动，弃。
