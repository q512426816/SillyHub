---
change: 2026-09-03-group-chat-archive-delete
title: 群聊归档与删除——对齐会话既有操作语义
scale: large
tier: independent
author: qinyi
created_at: 2026-09-03
status: draft
references:
  - 会话侧先例：backend/app/modules/daemon/session/service.py:6527-6740（delete/archive/unarchive）+ backend/app/modules/daemon/router.py:3236-3275（端点）
  - 前端会话先例：frontend/src/components/sessions/session-list-panel.tsx:1074-1241（删除/归档 Modal+toast）+ 2479-2525（行 hover 按钮）
  - decisions.md D-01@v1（方案 A 镜像会话，用户拍板「和会话一样」）
---

# 设计：群聊归档与删除（对齐会话语义）

## 1. 背景与目标

会话（单聊）自 2026-08-24 起具备完整收纳三件套：归档 / 取消归档 / 删除（软删），
配套「已归档会话」筛选视图与行 hover 操作。群聊（2026-09-01-session-group-chat
上线）目前只有「解散」（`POST /group-chats/{id}/end`），前端 `endGroupChat` 甚至
没有 UI 消费者；群表 `AgentGroupChat.deleted_at` 列存在且在
`list_groups` / `_get_group` / `get_group_chat_by_session` 三处被
`IS NULL` 过滤，但**没有任何置位链路**（删除端点缺失）；`archived_at` 列不存在。

**用户需求**：群聊要有归档和删除操作，**和会话一样**。

**目标**：
1. 群支持归档/取消归档（幂等、从默认群列表隐藏、已归档视图可查可恢复）；
2. 群支持删除（软删、行保留审计、活跃群先收口再删）；
3. 交互与会话完全同构：群行 hover 操作按钮 + Modal.confirm + toast + 已归档徽标；
4. 复用既有 SSE 列表信号通道（`publish_sessions_changed`），其它客户端秒级同步。

## 2. 方案总览（方案 A：镜像会话，群级标志位）

```
群行（列表 hover）──归档──► agent_group_chats.archived_at = now()
                │            默认列表隐藏（list_groups 过滤）
                │            「已归档会话」视图可见 + 「已归档」徽标
                └─取消归档──► archived_at = NULL（回默认列表）
群行（列表 hover）──删除──► 未解散群：先 end 收口链（end 全部影子会话 +
                          群时间线会话置 ended + 群频道广播 session_ended）
                          → deleted_at = now()（软删，行/审计保留）
                          已解散群：直接置 deleted_at
SSE：publish_sessions_changed("status_changed"/"deleted", 群时间线会话id,
      群主, audience=全部用户成员) → 前端 invalidate ["groupChats"]
```

**口径对齐依据**：`AgentGroupChat` 模型注释（`backend/app/modules/agent/model.py:1223-1232`）
已预告「解散（ended_at）置位；软删（deleted_at）与之正交（对齐
AgentSession.ended_at/deleted_at 语义）」——本变更是该预留语义的首次消费。

**关键正交性**（与会话同款）：
- `archived_at` ⊥ `deleted_at` ⊥ `ended_at`：可归档后删除，可直接删除，可解散后归档；
- **群时间线 `AgentSession`（kind='group'）不置位 archived_at/deleted_at**——群列表
  不走会话列表端点（`session_kind` 过滤已排除 group），群表标志位是群列表唯一
  真相源；删除时群时间线会话保持 ended 终态（影子会话 kind='group_member' 同理
  不进普通会话列表，无泄漏面）。

## 3. 数据模型

### 3.1 迁移（backend/migrations/versions/）

`agent_group_chats` 加 1 列（照 `20260903090000_add_machine_sillyspec_status.py`
先例结构）：

```python
op.add_column("agent_group_chats",
    sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
```

downgrade 对称删列；不回填（存量行为 NULL=未归档）。down_revision 接执行时
唯一 head（当前 20260903090000，执行时以 `alembic heads` 实测为准）。

### 3.2 模型 / Schema

- `AgentGroupChat`（backend/app/modules/agent/model.py）：`archived_at: datetime | None`
  紧邻 `ended_at`/`deleted_at` 注释块（同款 DateTime(timezone=True) 列）；
- `GroupChatRead`（backend/app/modules/agent/schema.py）：暴露 `archived_at:
  datetime | None = None`（列表项/详情读体经继承自动携带）。

## 4. 接口设计（group/router.py，复用 /api/daemon/group-chats 前缀）

| 端点 | 方法 | 语义 | 返回 |
|---|---|---|---|
| `/group-chats/{id}/archive` | POST | 归档（群主/admin；幂等） | 204 |
| `/group-chats/{id}/unarchive` | POST | 取消归档（群主/admin；幂等） | 204 |
| `/group-chats/{id}` | DELETE | 删除=软删（群主/admin；活跃先收口） | 204 |
| `/group-chats` | GET | 加 `archived: bool \| None = Query(default=False)` 三态过滤 | 列表 |

`archived` 三态：**False（HTTP 默认）=仅未归档**、True=仅已归档（归档视图）、
None=不过滤（service 层态——**HTTP 不可显式到达**：FastAPI `bool | None` Query
对 `null`/空串字面量一律 422，与会话侧同款限制（会话侧 None 同样只是默认值，
从未显式传输）；admin debug 全量需直调 service，execute 期实证后修订）。**有意
分歧**：会话列表 Query 默认 None（`daemon/router.py:2688`）曾致桌面端不传参泄漏
已归档行（ql-20260831-015 教训），群侧把安全默认前移到 HTTP 层——
`listGroupChats` 有三个无参消费点（桌面群分区/移动端群分区/群面板 presence），
默认 False 让「忘了传参」天然安全。

权限门：三个写操作均「成员判定先行 + `_require_group_owner`」（镜像会话
owner-only；群的 owner=群主或 workspace admin）。非群主成员归档/删除 → 403
中文文案；非成员/已删群 → 404 不泄露存在性。

动词口径说明（Grill X8）：archive/unarchive 会话侧是 PATCH，群侧取 POST——
群 router 动作端点先例统一 POST（end/interrupt/reset-memory/read/typing/pinned
系列），群内自洽优先于跨域严格镜像。

## 5. 关键链路设计（group/service.py）

### 5.1 archive_group / unarchive_group（照 archive_session:6672-6740 逐段镜像）

```
取群（带 FOR UPDATE 行锁——新增 _get_group_locked 变体：_get_group 现状无锁
  （group/service.py:1807-1822），归档/删除需要与会话先例同款行锁防并发双写）
→ _require_group_member → _require_group_owner
→ 幂等早退（已归档重复 archive / 未归档重复 unarchive → rollback 释放行锁 + return）
→ 置位/清除 archived_at → commit → _publish_group_sessions_changed(group, "status_changed")
```

注意：已解散群（ended_at 非空）**可归档/可删除**（解散群仍占列表位，归档是
收纳解散群的主场景）；软删群（deleted_at 非空）在 `_get_group` 已 404，天然不可
再操作。

### 5.2 delete_group（照 delete_agent_session:6527-6583 镜像）

```
_get_group_locked → _require_group_member → _require_group_owner
→ 未解散（ended_at IS NULL）：复用 end 收口链——逐 agent 成员 _end_member_shadow
  （end 影子 + 影子队列清理，AppError 内层容错不阻断，group/service.py:2014-2021
  既有语义）+ 群时间线会话置 ended + 群行 ended_at + agent 成员
  shadow_status='ended' + 群频道广播 session_ended（直接调用既有 end_group
  的收口段，不重写）。end_group 幂等（已解散早退回读，首末已广播不重发，
  group/service.py:2462-2465）；其内部 commit 后外层再置 deleted_at 再 commit
  ——两 commit 间的「ended-未删」半态可由 end_group 幂等重试收敛，删除本身
  未落库无半态；DB 层失败则整请求 500 由调用方重试（影子 end 的 WS 投递
  失败已由 end_group 内部 warning 吞掉，不阻断软删——与会话侧
  delete_agent_session 的分层容错同构：内层 best-effort、外层事务性）
→ 群时间线 AgentSession.deleted_at = now()（严格镜像 delete_agent_session:6578
  对会话行的软删置位——封堵属主经 GET /sessions/{id} 直读时间线的旁路）
→ group.deleted_at = now() → commit
→ _publish_group_sessions_changed(group, "deleted")
```

实现取舍：不抽 `_end_group_for_delete` 私有方法——`end_group` 本身幂等（重复
解散直接回读），`delete_group` 先调 `await self.end_group(...)`（含全部收口+广播）
再置 `deleted_at`，链路单一无重复代码；与 `delete_agent_session` 需要独立
`_end_session_for_delete` 的原因不同（后者要绕开 status 收口细节，前者 end_group
即目标语义）。

**旁路封堵**（Grill X2）：群表软删后，影子日志解析分支
`get_group_chat_by_session` 邻域（group/service.py:1688-1702）用裸
`db.get(AgentGroupChat)` 不过滤 `deleted_at`——补 1 行
`AgentGroupChat.deleted_at.is_(None)` 过滤，封堵成员经影子会话读已删群日志的
旁路。属主经 logs 端点的审计只读保留（会话侧现状同款：owner logs 分支不滤
软删，session/service.py:6824-6831——审计口径，不改）。

### 5.3 list_groups 过滤扩展

`list_groups(user, *, archived: bool | None = False)`：False（默认）→ 追加
`archived_at IS NULL`；True → `archived_at IS NOT NULL`；None → 不过滤。
service 默认 False 与会话 service 口径一致（session/service.py:6002）。

### 5.4 SSE 信号

复用 `_publish_group_sessions_changed`（payload 内嵌全部未移除用户成员
audience）：归档/取消归档 → `status_changed`；删除 → `deleted`。前端
sessions-portal 已订阅该频道并 invalidate `["groupChats"]`（sessions-portal.tsx
群事件处理段），零新前端订阅代码。

## 6. 前端设计

### 6.1 lib/daemon.ts

- `listGroupChats(opts?: { archived?: boolean })` → GET `?archived=`；
- `archiveGroupChat(groupId)` / `unarchiveGroupChat(groupId)` / `deleteGroupChat(groupId)`
  → 三个端点封装（204 空）。

### 6.2 session-list-panel.tsx（群分区）

- **GroupChatRow**：hover 操作区（行尾，`group-hover:flex`，与会话行
  SessionRow:2479-2525 同款）——归档（Archive 图标）/取消归档
  （ArchiveRestore，按 `archived_at` 二选一）+ 删除（Trash2，destructive hover）；
  已归档行降调 `opacity-60` + 「已归档」muted 徽标（含相对时间 title），
  全部照会话行先例；
- **群分区数据源**：`groupChatsQuery` 的 queryFn 按 `isArchivedView` 传
  `archived: true/false`，queryKey 追加视图维度（默认视图 `false` / 归档视图
  `true`）防缓存串视图；
- **分区头**：归档视图下计数语义同会话（「已归档群 N 个」）；「＋」新建按钮在
  归档视图隐藏（**群分区新增行为**——收纳视图禁建新，理由同会话归档区不建新
  的产品直觉；会话组头「＋」现状无此门控，不引为先例）；
- **确认交互**：Modal.confirm（icon 同会话 `confirmIcon`）+ useNotify toast；
  删除文案与会话对齐并补群语义：「确定删除群聊「{title}」吗？删除后所有成员
  将不再看到该群，群消息记录保留于平台审计但不可再访问。」

### 6.2b group-chat-panel.tsx（presence 消费点适配）

群面板 presence 查询（group-chat-panel.tsx:765-771，queryKey
`["groupChats","list",null]` 按 id 查在线集）依赖列表端点返回**当前群**——
已归档群仍可打开聊天（归档≠解散）。**execute 期实证修订**：FastAPI `bool | None`
Query 无法经 HTTP 显式传 null（422），lib 层 `listGroupChats({ archived: null })`
与不传参等价（走 HTTP 默认 False）——已归档群不在 presence 刷新列表内，
`online_member_ids` 回退选中时快照（`group?.online_member_ids`，归档视图列表项
本身携带该字段，SSE invalidate 驱动的列表重拉会刷新它）；仅 presence 自身的
30s 轮询不覆盖已归档群（绿点不实时跳动，属已知降级——与会话侧 null 同款
传输层限制，后端如需全量入口须改自定义解析，另行需求）。lib 注释已锚定
「后端补显式全量入口后 daemon.ts 单点改拼参、调用点零改动」路径。

### 6.3 sessions-portal.tsx（回调接线）

照 `onDeleteSessions/onArchiveSessions` 模式新增群回调：
`onDeleteGroup/onArchiveGroup/onUnarchiveGroup` → 调 lib 函数 → invalidate
`["groupChats"]` → 若被删/归档群是当前选中群则清 `selectedGroupId/
selectedGroup` + `syncSessionParam(null)`。

### 6.4 类型再生成

后端 schema 变更同 change 内跑 `pnpm gen:types` 提交 `api-types.ts` +
`backend/openapi.json`（CLAUDE.md 规则 21）。

## 7. 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| group.archived | 群主/workspace admin（POST /{id}/archive） | SSE sessions 频道（event=status_changed，audience=全部用户成员） | group_id（=session_id）、event、audience_user_ids | archived_at: NULL→now()；列表默认视图隐藏、归档视图出现 |
| group.unarchived | 群主/workspace admin（POST /{id}/unarchive） | 同上（event=status_changed） | 同上 | archived_at: now()→NULL；回默认视图 |
| group.deleted | 群主/workspace admin（DELETE /{id}） | 同上（event=deleted） | 同上 | 未解散群先走 group.ended 收口（影子→ended、群时间线→ended）；**群行+群时间线会话双置 deleted_at**；成员视角一切读路径 404（属主 logs 审计只读保留，会话侧同款现状） |
| group.ended（既有，本变更消费） | delete_group 内部复用 end_group | 群频道 session_ended | — | 影子会话/群时间线置 ended（不变更既有语义） |

幂等契约：archive/unarchive 重复调用无操作（行锁内早退）；delete 对已删群
`_get_group` 404（天然幂等边界）。

## 8. 边界与非目标（Non-Goals）

- **不做群批量归档/删除**（会话有批量栏，群为共享实体数量少，YAGNI）；
- **不做按成员个人归档**（decisions.md D-01@v1 方案 B 否决）；
- **不改解散（end）语义**、不补 endGroupChat 的 UI 入口（另行需求）；
- **不物理删除任何数据**（软删审计口径，run/log 历史保留）；
- 移动端群分区（mobile-session-list.tsx:236-248）已有群列表，依赖列表端点——
  HTTP 默认 False 后无参调用天然只看未归档群，**零改动**即正确，本变更不碰
  移动端代码（后续如需移动端归档视图另立需求）。

## 9. 测试策略

**后端**（backend/app/modules/daemon/tests/test_group_chat_management.py 增补）：
- 归档/取消归档：置位/清除断言 + 幂等（重复调用无操作）+ 非群主 403 +
  非成员 404 + 已解散群可归档；
- 删除：软删后列表消失 + `_get_group` 路径 404 + 活跃群删除后影子会话置
  ended + 群时间线会话置 ended **且双 deleted_at 置位（群行+时间线行，属主
  GET /sessions/{id} 旁路封堵断言）** + 群频道收到 session_ended + 已解散群
  直接软删 + **已删群影子日志解析分支 404（旁路封堵回归）**；
- 列表 archived 三态：HTTP 默认（不传参）不含已归档群（防泄漏回归锚点）/
  True 仅已归档 / None 全量；
- SSE 信号：archive → status_changed、delete → deleted（audience 含全部用户成员）。

**前端**（session-list-panel 测试增补）：
- 群行 hover 三按钮渲染与 aria-label；已归档行徽标 + 取消归档按钮二选一；
- 归档视图拉取 archived=true；分区头「＋」隐藏；
- 删除确认 Modal 文案；回调后 invalidate + 清选中态。

## 10. 风险登记（Risk）

| 风险 | 等级 | 缓解 |
|---|---|---|
| 已归档群在群面板 presence 刷新回归（HTTP 默认 False 滤掉当前群） | 中 | §6.2b 面板显式 archived:null + 测试锚点 |
| delete_group 两段 commit 间「ended-未删」半态 | 低 | end_group 幂等可重试收敛；删除未落库无半态（Grill X1 验证） |
| 属主旁路（logs 审计只读）被误解为缺陷 | 低 | design §5.2 明示对齐会话侧现状（session/service.py:6824-6831） |
| archived 三态过滤泄漏进无参消费点 | 中 | HTTP 默认 False 硬化（会话侧 ql-20260831-015 教训前移）+ 回归测试锚点 |
| 迁移链冲突（他端同时加 head） | 低 | 执行时 alembic heads 实测单 head 再定 down_revision |

## 11. 自审（Self-Review）

- 镜像先例行号逐条核对源码（archive_session:6672 / delete_agent_session:6527 /
  SessionRow hover:2479 / archived Query:2688 / end_group:2451）；
- Design Grill 独立子代理交叉审查（review-2026-09-03-163216）passed，2 fail +
  3 gap 文档缺陷已按代码证据修正进本文档（§4 默认值硬化 / §5.1 行锁 /
  §5.2 旁路封堵与容错措辞 / §6.2 假先例清除 / §6.2b+§8+§10 消费点覆盖）；
- 生命周期契约表（§7）覆盖四个事件×发起方×接收方×字段×状态变化。

## 12. 文件变更清单

| 文件 | 变更 |
|---|---|
| backend/migrations/versions/20260903XXXXXX_add_group_chat_archived_at.py | 新增迁移（+1 列） |
| backend/app/modules/agent/model.py | AgentGroupChat.archived_at 字段 |
| backend/app/modules/agent/schema.py | GroupChatRead.archived_at 暴露 |
| backend/app/modules/daemon/group/service.py | archive/unarchive/delete_group + _get_group_locked + list_groups archived 过滤 + 影子日志分支软删过滤（§5.2 旁路封堵） |
| backend/app/modules/daemon/group/router.py | 三端点 + 列表 archived Query（默认 False） |
| backend/app/modules/daemon/tests/test_group_chat_management.py | 增补用例 |
| backend/openapi.json + frontend/src/lib/api-types.ts | gen:types 再生成 |
| frontend/src/lib/daemon.ts | 三函数 + listGroupChats archived 参数 |
| frontend/src/components/sessions/session-list-panel.tsx | 群行操作/徽标/归档视图数据源/确认交互 |
| frontend/src/components/sessions/sessions-portal.tsx | 群回调接线 |
| frontend/src/components/group-chat/group-chat-panel.tsx | presence 查询显式 archived:null（§6.2b） |
| frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | 增补用例 |

> 移动端 mobile-session-list.tsx 有群分区但零改动（§8：HTTP 默认 False 天然
> 正确，不入清单）。
