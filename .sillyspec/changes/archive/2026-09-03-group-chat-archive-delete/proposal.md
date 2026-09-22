---
author: qinyi
created_at: 2026-09-03 16:49:47
---
# 提案书（Proposal）

## 动机

会话（单聊）自 2026-08-24 起具备归档/取消归档/删除（软删）收纳三件套；
群聊（2026-09-01 上线）只有「解散」且无前端入口。用户群列表只增不减，
解散的群也永久占位，无法收纳。需求：**群聊要有归档和删除操作，和会话一样**
（用户原话，2026-09-03）。

## 关键问题

1. **无收纳能力**：群表 `AgentGroupChat.deleted_at` 列存在且在
   `list_groups`/`_get_group`/`get_group_chat_by_session` 三处被过滤，但无任何
   置位链路（删除端点缺失）；`archived_at` 列不存在——群的可见性管理是半成品。
2. **交互断层**：会话行有 hover 归档/删除按钮 + Modal 确认 + toast + 已归档
   视图；群行无任何操作入口，同一列表内两种实体体验割裂。
3. **解散 ≠ 删除**：解散保留群于列表（成员仍可读历史），用户需要「眼不见」
   的归档与「彻底移除」的删除两种独立语义，与会话对齐。

## 变更范围

- 后端：`agent_group_chats` 加 `archived_at` 列（迁移）；`GroupChatRead` 暴露
  该字段；group service 新增 `archive_group`/`unarchive_group`/`delete_group`
  （群主/admin 权限门 + 幂等 + SSE 信号）+ `list_groups` archived 三态过滤 +
  删除旁路封堵（群行+群时间线会话双置软删、影子日志分支过滤）；group router
  三端点 + 列表 `archived` Query（HTTP 默认 False）。
- 前端：gen:types 再生成；`lib/daemon.ts` 三函数 + `listGroupChats` archived
  参数；`session-list-panel.tsx` 群行 hover 操作/已归档徽标/归档视图数据源；
  `sessions-portal.tsx` 回调接线；`group-chat-panel.tsx` presence 显式
  `archived: null`。
- 测试：后端 `test_group_chat_management.py` 增补；前端
  `session-list-panel.test.tsx` 增补。

## 不在范围内（Non-Goals）

- 不做群批量归档/删除（会话有批量栏，群为共享实体数量少，YAGNI）
- 不做按成员个人归档（decisions.md D-01@v1 方案 B 已否决）
- 不改解散（end）语义、不补解散的前端 UI 入口（另行需求）
- 不物理删除任何数据（软删审计口径）
- 不碰移动端代码（HTTP 默认 False 使 mobile 群分区零改动天然正确）
- 不改会话侧既有 archive/delete 行为（含其 Query 默认 None 的历史口径）

## 成功标准（可验证）

- 群主/管理员可归档群：默认列表消失、「已归档会话」视图可见（带徽标），
  取消归档恢复；普通成员执行 → 403 中文提示；重复操作幂等
- 群主/管理员可删除群：列表与一切成员读路径 404；活跃群删除后影子会话与
  群时间线均收敛 ended + 双软删置位；行保留（审计可查）
- `GET /group-chats` 不传参不含已归档群（防泄漏回归锚点）；`?archived=true`
  仅已归档；`?archived` 显式 null 全量
- SSE：归档 → status_changed、删除 → deleted，其它客户端群列表秒级刷新
- 后端/前端相关测试全绿；`pnpm gen:types` 产物（openapi.json + api-types.ts）
  同 change 提交
