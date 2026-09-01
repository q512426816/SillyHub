---
change: 2026-09-01-session-group-chat
title: 会话群聊——多用户多 Agent 同会话协作（openclaw 同构）
scale: large
tier: independent
author: qinyi
created_at: 2026-09-01
status: draft
references:
  - prototype: prototype-group-chat.html
  - openclaw 源码调研（clone 于 C:/Users/qinyi/IdeaProjects/_openclaw_research，2026-09-01 HEAD 2e3f734）
---

# 设计：会话群聊（多用户多 Agent 同会话）

## 1. 背景与目标

平台现有会话为**单归属人制**（`AgentSession.user_id` 单主）：一个用户与一个 agent 配置的 1:1 对话。用户需要**群聊**：多个用户 + 多个 agent 成员在同一会话里协作，agent 成员各自可独立配置，参考 openclaw 最新版的群聊/多 agent 机制（mention 门控 + 每 agent 独立会话 + 群上下文共享缓冲）。

**核心决策记录**（用户拍板）：
- 触发模式：**@提及 + 独立记忆**——@昵称触发对应 agent，@全体 广播；每个 agent 成员独立对话记忆；未被 @ 的消息仅进群背景摘要
- 成员模型：**显式邀请制**——建群拉用户 + 配置 agent 成员，仅群成员可看可聊
- agent 成员**六要素**：机器(runtime) / 工作区 / 引擎类型(provider) / 模型(llm_provider) / 智能体方案(AgentProfile) / 群内昵称（@提及词，群内唯一）
- 协作模式：**openclaw 同构，无固定角色**——成员一律平等，"人格即角色"（配什么样的人格方案它就承担什么职责），不做角色模板、不做管理者派活工具；agent 间关联靠①群背景摘要（含所有成员发言，被动只读）②@全体广播③**agent 互@协作**（群级开关，默认开启，带防环护栏）
- 配置热切换：群聊进行中随时切换任意 agent 成员的模型/供应商/人格方案，**下一轮边界生效**，不影响该成员独立记忆与其他成员；例外：**机器/工作区切换会重建影子会话并重置该成员记忆**（切换前弹确认提示）
- 首期 UX：@补全菜单 + 成员面板 + 正在输入指示器（typing，草稿不落库不进 AI 上下文）

**openclaw 关键借鉴点**（源码级调研结论）：
| openclaw 机制 | 本设计对应 |
|---|---|
| mention gating（@提及才触发；未提及消息存群上下文缓冲当背景） | @昵称路由 + 群背景摘要 |
| 每 agent 独立 session key（`agent:<id>:<channel>:group:<gid>`） | 每 agent 成员一条影子会话（独立记忆） |
| group context buffer（按群共享、与 agent 无关的近期消息窗口） | 群背景摘要（DB 查询群时间线最近 N 条，含 agent 回复） |
| broadcast groups（一消息扇出多 agent 并行/串行） | @全体 广播（并行触发全部 agent 成员） |
| typing indicator（草稿流式、2.5s TTL、不落库不进上下文） | 群 typing 频道（同款边界） |
| agent 回复互不触发（防回声/防环） | 互@协作改为**显式开关 + 防环护栏**（增强点） |

## 2. 方案总览（影子会话桥接）

```
群成员浏览器（多用户）
   │ ① 发消息（含 @昵称）
   ▼
群会话 AgentSession(kind='group')  ──统一时间线：所有用户消息 + 所有 agent 回复投影
   │ ② @解析（backend）                     │
   │    @小码→[小码]  @全体→[全部]  无@→仅落时间线   │
   ▼                                     │
影子会话 AgentSession(kind='group_member', 独立记忆)│
   每个成员懒创建、长驻复用                    │
   · 六要素 → pinned runtime + cwd +      │
     provider/model/profile（lease）      │
   · 注入 prompt = 成员简报 + 群背景摘要 + 当前消息 │
   │ ③ daemon 执行（SessionManager/driver 复用） │
   ▼                                     │
run_sync 回流 ────④ 桥接投影（双写投影行 + 群频道 publish，带成员身份）──► 群时间线
```

- **群会话**（kind='group'）：统一消息时间线载体，复用现有 SSE（`agent_session:{id}` Redis 频道）、日志落库、断线恢复、软删/归档管线
- **影子会话**（kind='group_member'）：每个 agent 成员一条，对用户隐藏（不出现在会话列表），完全复用现有 interactive lease / daemon driver / resume / 排队管线
- **载体 run**：每条用户消息在群会话下创建一个 `status='completed'` 的纯载体 AgentRun（`AgentRunLog.run_id` NOT NULL FK 的承载；写 `started_at`），无执行语义
- **投影行**：agent 回复流在实时 publish 到群频道的同时，**双写一行 AgentRunLog 到载体 run**（新 PK；`dedup_key` 复用原值；身份进 `metadata` 列——详见 §5.2）——刷新/重连回放走现有 `get_agent_session_logs` 天然聚合
- 现有单聊会话（kind='chat'）**零行为改动**

### 与既有概念的关系
- **/team 团队（mission）**：保留不动——单聊里的临时任务团队（干完收敛）。群聊是常驻协作形态，**不依赖 mission 表**，不复用 worker 的 `parent_session_id` 树（见 §5.1 硬约束规避）
- **AgentProfile**：agent 成员的"人格/技能/工具集"载体（六要素之"智能体方案"），直接复用
- **quick-chat**：不变

## 3. 数据模型

### 3.1 AgentSession 扩展（加一列）
```
agent_sessions + session_kind: String(16), server_default 'chat', NOT NULL
  取值：'chat'（默认，存量行为不变） | 'group'（群会话） | 'group_member'（影子会话）
  索引：ix_agent_sessions_session_kind（列表过滤）
```
- 群会话：`spec_strategy='interactive'`、`change_id=NULL`（首期群不绑 change，避开 `_apply_session_terminal_status` 对 change 会话的首轮终态收敛）、`user_id=群主`（计量归属）
- 影子会话：`parent_session_id=NULL`（**刻意不挂**，见 §5.1）、`user_id=群主`、`config.manual_approval=False`（照 worker 先例，审批弹窗不进群——首期限制，见 §9）

### 3.2 新表：agent_group_chats（群）
| 列 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | 即群会话的 session_id（见下） |
| session_id | FK agent_sessions UNIQUE | 群时间线会话（1:1） |
| workspace_id | FK workspaces | 权限锚（群挂在一个工作空间下） |
| title | String(120) | 群名 |
| created_by | FK users | 群主（影子会话 user_id 同源） |
| agent_cross_mention | Boolean default **true** | agent 互@协作开关（默认开） |
| cross_mention_depth | Integer default 2 | 协作链深度上限 |
| context_window | Integer default 20 | 群背景摘要条数 |
| settings_json | JSON | 预留（护栏参数等） |
| created_at / ended_at / deleted_at | | 生命周期 |

### 3.3 新表：agent_group_members（成员）
| 列 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| group_id | FK agent_group_chats CASCADE | |
| member_type | String(8) | 'user' \| 'agent' |
| display_name | String(40) | 群内昵称 = @提及词；**UNIQUE(group_id, display_name)**（用户与 agent 共用同一昵称命名空间、群内全局唯一——@路由无歧义，用户与 agent 不可同名） |
| invited_by | FK users | 邀请人 |
| joined_at / removed_at | | 成员生命周期（removed_at 非空=已移除） |
| — 用户成员 — | | |
| user_id | FK users（member_type='user' 时 NOT NULL） | |
| — agent 成员六要素（member_type='agent'） — | | |
| runtime_id | FK daemon_runtimes | 机器（pinned，照 worker `pinned_skip_owner_check` 先例需处理非群主机器授权） |
| workspace_id | FK workspaces | 该成员的工作区（cwd 锚，可与群工作区不同→"一项目多工作区"分工） |
| provider | String(20) | 引擎类型（claude/codex） |
| llm_provider_id | FK llm_providers | 模型 |
| agent_profile_id | FK agent_profiles | 智能体方案（人格/技能/工具集） |
| config_snapshot | JSON | 冗余快照（machine_name/agent_name/profile_name 等，供列表 chips 免 N+1） |
| shadow_session_id | FK agent_sessions NULL | **反向指针**：该成员的影子会话（懒创建后回填；成员表持指针，影子会话不挂 parent） |
| shadow_status | String(16) | none/pending/active/failed（面板绿点） |
| UNIQUE(group_id, user_id)（user 成员）| | 防重复邀请 |

> 六要素数据落点说明（核对报告 #6）：成员表存权威配置；派发时 `provider/agent_profile` 走 AgentSession 列 + `apply_session_profile_to_lease`（只写 system_prompt/mcp_refs/skill_refs），`model` 走 lease metadata.model，`llm_provider_id` 走 lease metadata `session_llm_provider_id`，`runtime` 走 `pinned_runtime_id`，`cwd` 走 lease metadata.cwd——与 worker 派发 `_dispatch_worker_core` 同构。

### 3.4 迁移
单文件 migration：`agent_sessions.session_kind` + 两张新表 + **`agent_run_logs.metadata` JSON NULL 列**（投影行承载 `{member_id, member_name, source_log_id}` 身份，前端回放据此还原发言者；存量行 NULL）。执行前 `cd backend && uv run alembic heads` 确认单 head、revision id 用 `YYYYMMDDHHMMSS` 唯一时间戳（known-issues：并行撞 head 会 crash-loop）。当前 head 为 `20260831150000`（versions 目录 178 个文件，含 merge heads）。

## 4. 消息流转与触发

### 4.1 用户消息入群
1. `POST /api/daemon/sessions/{group_session_id}/group-message`（新端点，成员校验）
2. 落库：载体 run（`status='completed'`、`started_at=now`、`user_id=发送者`、`agent_session_id=群会话`）+ `AgentRunLog(channel='user_input', run_id=载体run, content=原文)`
3. publish 群频道 `log` 事件（payload 增 `sender_member_name`/`sender_user_id`——envelope 扩展见 §6.2）
4. @解析（`_parse_group_mentions`）：正则 `@昵称`（全/半角 @，边界匹配，查成员表 display_name 精确命中）+ `@全体`/`@all`
5. 路由：
   - 命中 agent 成员集合 → 逐个触发（并行；@全体=全部 agent 成员）
   - 未命中 → 结束（消息已在时间线，进后续群背景摘要）
6. 触发成员：组装注入 prompt → 影子会话注入（§4.3）

### 4.2 群背景摘要（group context buffer 的 DB 版）
- 触发成员时查询群时间线最近 `context_window`（默认 20）条：`user_input` 行 + 投影行（agent 回复摘要）
- 格式（对齐 openclaw envelope 思路）：
  ```
  [群聊记录 · 背景，仅供了解上下文]
  小英(用户): 登录页偶现白屏…
  小码(Agent): 已定位：LoginForm.jsx:47 hooks 依赖…
  [当前消息 · 需要你回应]
  鲸落(用户): @小码 帮我修复它
  ```
- **含 agent 回复摘要** → 未被 @ 的 agent 也能在下次被 @ 时看到其他成员的进展（openclaw broadcast 模式刻意不含 agent 回复防回声；本设计群定位是协作群，跨成员可见性是需求，防刷屏由触发机制本身保证——只有被 @ 才有 turn）
- 单条截断 500 字、总长上限约 6000 字符

### 4.3 影子会话注入
- **懒创建**：成员首次被触发时，照 worker 先例**三件套**（`_dispatch_worker_core` mcp_tools.py:1195-1212）：①直接 ORM 建行 `AgentSession(config={'manual_approval': False})`（注意：审批开关的生效位是 **AgentSession.config 列**——`create_session` 的 DTO 默认与 `prepare_interactive_dispatch` 的 lease 层强制位（placement.py:837-842）均不适用于 config 列，permission_service 按 session.config 门控，影子会话审批关闭语义成立）：
  1. `AgentSession(kind='group_member', user_id=群主, runtime_id=成员.runtime_id, agent_profile_id/llm_provider_id/provider=六要素, config={'manual_approval': False})`
  2. `prepare_interactive_dispatch(pinned_runtime_id=成员.runtime_id, cwd=成员.workspace 根, provider/model=六要素, stage='group_member')`；**机器授权**：成员机器属主非群主时走 **grants 授权分支**（`_query_pinned_online_runtime(skip_owner_check=False, workspace_id=群workspace)`——属主命中或 workspace grant 授权才放行，照 create_session 钉定授权先例；**不照抄 worker 的 `pinned_skip_owner_check=True`**——那是 worker 代表绑定机器由服务端解析的豁免，群成员机器是群主任意选择的，必须走授权校验），allowed_roots 越界预检保留为第二道防线
  3. 回填成员表 `shadow_session_id`/`shadow_status='active'`
- **注入**：首句 = 成员简报（"你是群聊「{群名}」中的 Agent 成员「{昵称}」。成员列表：…。仅当消息 @你 或 @全体 时回应；回应简洁如聊天；你的发言会以「{昵称}」身份出现在群里"）+ 群背景摘要 + 当前消息；经现有 SESSION_INJECT 三段式下发（run 挂影子会话，`user_id=群主`，metadata 带来源群/成员/发送者）
- **忙轮排队**：影子会话已有活跃 run → 消息落 `AgentSessionQueuedMessage`（挂影子会话，`sender_user_id=实际发送者`）；**prompt 采用"拼入文本"方案**：入队时把"群摘要+当前消息"完整拼进 prompt Text 列（不加新列）——**排队消息按入队时刻的摘要快照派发，不吃后续群进展**（含该成员自己后续轮次；明确取舍，见 §9.7）；**队列派发新建 run 时透传原链 metadata**（source_carrier_run_id/chain_depth 照抄入队时的链状态，保证 turn_completed 互@检测可读链）；队列满 5 条 → 409 → 前端群内提示"「小码」的队列已满，请稍候"。轮终态由现有 `dispatch_next_queued_message` 续派
- **闲置与恢复**：影子会话长驻复用现有 resume（`agent_session_id` SDK id 持久化 + daemon 快照恢复）；daemon 重启走现有 `recover_session_after_daemon_restart`（kind 无关）

### 4.4 agent 互@协作（群级开关，默认开）
- 开关：`agent_group_chats.agent_cross_mention`（默认 true）
- 触发源扩展：桥接投影层在 agent 回复投影完成（turn_completed）时，若开关开启，对**该回复的最终文本**执行与用户消息相同的 @解析；命中的其他 agent 成员走与 §4.1-4.3 相同的触发管线（注入 prompt 的"当前消息"标注为"来自 Agent 成员「X」的协作请求"）
- **防环护栏**（照 openclaw A2A 有界 ping-pong 思路），状态载体为 **Redis**（不建表，全部带 TTL 自清理）：
  1. **协作链**：链 id = 触发该协作的用户消息载体 run_id；Redis Key `group_chain:{载体run_id}` = Hash `{member_id: 1}`（链内已触发成员去重集）+ `depth` 计数，TTL 30min。每次因互@触发成员时 SADD/查重/INCR depth；深度达 `cross_mention_depth`（默认 2）不再触发（可再@但只作纯文本）
  2. **同轮去重**：同一链内同一成员最多被触发一次（去重集命中即跳过）
  3. **频率限制**：Redis Key `group_rate:{group_id}:{member_id}` INCR + EXPIRE 60s 滑动窗口计数，每分钟被触发上限默认 6 次，超限群内系统提示
  4. **不自我触发**：成员回复中的 @自己 忽略
- 链 id 透传：注入影子 run 时写入 run metadata（`source_carrier_run_id`/`chain_depth`），turn_completed 互@检测时读取——链状态 DB 可查（run metadata）+ Redis 可判（去重/限频），双轨一致
- 关闭开关时严格 openclaw 模式：agent 回复中的 @ 为纯文本

### 4.5 配置热切换
- 群聊进行中修改 agent 成员六要素任意项：成员表更新 → 若影子会话已存在：
  - provider/llm_provider/agent_profile 变更 → `SESSION_SWITCH_CONFIG`（服务身份走 `inject_session_as_service` 先例），daemon 在**当前轮结束的边界** reload driver，下一轮生效；影子会话三列同步更新
  - runtime/workspace 变更 → 影子会话结束 + 标记 `shadow_status='pending'`，下次被 @ 按新六要素懒重建（记忆重置，切换前群内提示确认）
- 独立记忆不受模型/方案切换影响（SDK resume id 不变）

## 5. 关键链路设计

### 5.1 影子会话不挂 parent_session_id（硬约束规避）
现有 5 处以 `parent_session_id IS NOT NULL` 为 worker 子会话**唯一判定口径**：daemon 停机批量挂起（`daemon/session/service.py:5153-5174`）、离线 sweep（`sweep.py:235-247,295-298`）、suspended 自动恢复（`sweep.py:559` 只挑 parent IS NULL）、worker 自动重派（`worker_redispatch.py:95-134`）、闸拒绝首 run 收口（`run_sync/service.py:1415-1452`）。影子会话若挂 parent 会被误杀/误重派/永不恢复。**设计决策：影子会话 parent_session_id=NULL，群↔影子关联只经成员表 `shadow_session_id` 反向指针**——上述 5 处零改动。同理 `MAX_TREE_DEPTH`/`mission_worker_sessions` 树查询不涉及影子。

### 5.2 桥接投影（两个改动点 + 双写投影行）
| 改动点 | 位置 | 内容 |
|---|---|---|
| ① 日志流 | `run_sync/service.py: submit_messages`（事务内）→ `PublishIntent` → `publish_submitted_messages`（commit 后纯 Redis，:168-295） | **双写投影行在 submit_messages 事务内完成**（publish 阶段无 DB session，不可写库）：影子 run 落库原行后，同事务内插**新 PK** 投影行 `AgentRunLog(id=新uuid, run_id=群载体run, dedup_key=原dedup_key, channel='stdout', content=原文, segment_id=原值, metadata={member_id, member_name, source_log_id})`——注意 **id 必须用新 uuid**（原 log_id 已被影子行占用，同 id 插入必然 PK 冲突）。`PublishIntent` 新增标量字段：`group_id/member_id/member_name/member_session_id/projection_log_id`（投影行 id），publish 时向群频道 `agent_session:{group_id}` 发事件，**事件内 log_id 用投影行 id**——实时事件与回放读库同 id，前端 `seenLogIds` 去重天然兼容（SSE 生成器无 backlog，去重全靠两端 id 对齐） |
| ② 轮终态 | `run_sync/service.py: close_interactive_run`（:1881-1896） | 影子 run 收口时向群频道发 `turn_completed`，payload 增 `member_id/member_name/member_session_id`（现 payload 只有 run_id/session_id，群 UI 无法判"哪个成员说完了"）；收口后执行 §4.4 互@检测 |

- **投影范围**：仅 assistant 文本回复（stdout 文本段）；tool_call/thinking 不进群时间线（保持聊天干净）。服务端投影过滤按现有前缀分类（`[ASSISTANT]`/`[THINKING]`，与前端 `classifySessionLog` 同口径）；partial 半截行透传（segment_id 语义不变），override 到达时投影行按 (run_id=载体run, segment_id) DELETE + 群频道 stale 信号——与单聊同机制
- **身份快照语义**：`member_name` 按投影行落库时刻从成员表快照，改名不回填历史行（实时事件与回放行同源同刻，无双源漂移）
- 刷新/重连回放：群历史 = 载体 run 的 user_input 行 + 投影行，`get_agent_session_logs` 现有聚合天然覆盖（影子 run 不挂群会话，不会被重复聚合）；**前端群时间线不消费 run 分组装配**——见 §7 排序策略

### 5.3 权限模型（参与者制分支，单聊零改动）
- 新增 `_require_group_member(session, user)`（照 `file_artifacts._check_session_permission` 两段式模式）：群成员表命中（member_type='user' 且未移除）→ 放行；否则 workspace admin → 放行；否则 404（不泄露存在性）
- 改造点（集中式，其余经调用链继承）：
  - `_get_owned_session_for_update`（daemon/session/service.py:928）：kind='group' 走成员分支（群消息端点/排队 CRUD/interrupt/end）
  - `get_agent_session`（:5739）/ `list_agent_sessions`（:5650 base_filters 加 session_kind 谓词）/ `get_agent_session_logs`（:6376）
  - SSE `stream_session_logs` 内联校验（daemon/router.py:3304）
  - `permission_service.py:704/748/943`（权限对话框，影子 manual_approval=False 首期不触发，仍过一遍防漏）
  - `file_artifacts.py:121`（群会话分支用成员校验）
  - 其余 usage/delete/archive/unarchive/ctx_window 经 `get_agent_session`/`_get_owned_session_for_update` 自动继承
- 影子会话 API 不对外暴露（仅群桥接内部+admin debug）
- 会话列表：`list_agent_sessions` 加 `session_kind` Query 参数（默认 'chat' 存量口径）；群聊列表走新端点 `GET /api/group-chats`（按成员表过滤，含成员摘要 chips——成员表 config_snapshot 冗余，免 N+1）
- `agent_sessions:changed` 事件：`publish_sessions_changed` payload 增 `audience_user_ids`（群事件=全部用户成员 id 列表，payload 内嵌免每事件查库）；`_stream_sessions_events` 过滤（router.py:3247）改"payload.user_id 命中或 audience_user_ids 包含当前用户"

### 5.4 实时通道
- **群消息 SSE**：复用 `agent_session:{group_id}` 频道与 `stream_session_logs`（校验换 §5.3）——多成员同时在线各自订阅，天然广播
- **typing/presence 的投递通道**：群 SSE 生成器**多路订阅**——除 `agent_session:{group_id}` 外同时订阅 `group_typing:{group_id}`（Redis pub/sub 双订阅合流进同一 SSE 流，事件以 `event: typing` 区分），前端 streamSession 消费循环加 typing 分支（不建独立端点，连接数不翻倍）
- **typing**：新 Redis pub/sub 频道 `group_typing:{group_id}` + `POST /api/group-chats/{id}/typing`（节流：前端 250ms 间隔、preview ≤400 字、TTL 2.5s 自动过期，仅广播 typing 状态+昵称+可选草稿预览；**不落库、不进 AI 上下文、不进群背景摘要**）。agent typing：影子 run 开始时后端自动发一条（"「小码」正在输入…"）
- **presence（在线绿点）**：Redis key `group_presence:{group_id}:{user_id}` TTL 60s；**续期挂在群 SSE 生成器循环**（每轮 keepalive 周期 >45s 时 touch）；读取经群列表/详情接口返回 `online_member_ids`（读 `group_presence:{group_id}:*` keys，前端随列表刷新轮询）

## 6. 接口与协议

### 6.1 新端点（backend，均挂 daemon 域群聊子路由）
| 端点 | 说明 |
|---|---|
| POST /api/group-chats | 建群（title+workspace+初始成员+agent 成员六要素数组）；建群会话 |
| GET /api/group-chats | 群列表（当前用户=群成员，含成员摘要/最后消息/未读计数） |
| GET /api/group-chats/{id} | 群详情（成员列表含 agent 六要素+影子状态） |
| PATCH /api/group-chats/{id} | 改群名/开关（agent_cross_mention/context_window/护栏参数） |
| POST /api/group-chats/{id}/members | 加用户成员 / 配置 agent 成员（六要素） |
| PATCH /api/group-chats/{id}/members/{mid} | 改 agent 成员六要素（触发 §4.5 热切换）/改昵称 |
| DELETE /api/group-chats/{id}/members/{mid} | 移除成员（agent 成员→end 影子会话） |
| POST /api/daemon/sessions/{gid}/group-message | 发群消息（§4.1） |
| GET /api/daemon/sessions/{gid}/stream | 群 SSE（复用现有端点，校验分支） |
| POST /api/group-chats/{id}/typing | typing 心跳（§5.4） |
| POST /api/group-chats/{id}/end | 解散群（end 群会话+全部影子会话） |
- 群主/成员权限：建群/加删成员/改群设置/解散=群主（+workspace admin）；发消息/typing=任意用户成员
- DTO 变更后同变更内跑 `pnpm gen:types` 提交 `api-types.ts`+`openapi.json`（gen:types:check 不在 CI，纪律写进任务卡）

### 6.2 SSE envelope 扩展（SessionStreamEnvelope）
log / turn_completed 两类事件增可选字段：`sender_member_name`（用户消息发送者昵称）、`member_id` / `member_name` / `member_session_id`（agent 成员投影）。存量单聊事件不带新字段，前端向后兼容。

## 7. 前端设计

- **入口**：workspaces/[id]/sessions 页 SessionsPortal 增"群聊"分区——**群分区数据统一由 `GET /api/group-chats` 供数**（`list_agent_sessions` 按 user_id=请求者过滤，非群主成员经 kind 过滤看不到群，不能用）；前端分桶照 `TOOL_REPORT_SECTION_KEY` 先例 + 全局 /sessions 同步；侧栏群行含成员头像堆叠预览
- **建群向导**（新对话框组件）：群名 → 邀请用户（workspace 成员多选）→ 配置 agent 成员（六要素表单，可添加多个）→ 创建。**不内置角色模板**（人格即角色，纯自定义）
- **群聊视图**：**新建 `group-chat-panel` 组件**（不复用 session-panel 的单 currentRunId 状态机——群内多成员并行 turn 破坏其前提；复用 `session-log-assembler` 的分类原语 + turn-timeline 的渲染单元）：
  - **时间线排序模型**：群消息流是**平铺消息流**（非单聊的 run 分组 turn 模型）——实时事件与回放读库统一**按 log timestamp 全局排序**（多成员交错回复时，`get_agent_session_logs` 的 run 锚分组会把迟到回复"吸回"触发消息组，群视图忽略 run 分组、只按时间轴平铺，实时与回放顺序一致）
  - 顶栏：群名+成员头像堆叠（facepile +N）+成员面板开关
  - 时间线：用户消息气泡（头像+昵称+时间，多发送者按 `sender_member_name` 区分）；agent 回复气泡（成员头像+昵称+引擎/模型标签，流式光标，投影日志按 member_id 分色分组）；系统事件居中（xx 加入/移除/配置已切换）
  - 刷新回放：投影行按 metadata.member_name/member_id 还原身份（身份为落库时刻快照，改名不回填）
  - 输入区：@补全（扩展现有 `session-mention-popover` 判别联合加 `{kind:'member'}`——群成员+@全体）；typing 指示器（输入框上方气泡：谁正在输入+三点动画，agent 触发时"「小码」正在输入…"）
  - 成员面板（右抽屉）：用户成员（在线绿点/presence、移除）；agent 成员卡片（六要素展示+**随时切换配置**按钮→热切换弹窗（引擎/模型/方案/机器/工作区，提示下轮生效；机器/工作区切换提示记忆重置）+重置记忆）
- 样式遵循 AI-Native 双主题铁律（brand-* 语义阶/themes.ts 单源/shadow token），原型 `prototype-group-chat.html` 为视觉与交互对照基准

## 8. 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| group.created | 用户（前端） | backend | title/workspace_id/成员数组 | 建 agent_group_chats 行 + 群 AgentSession(kind='group', status='active')；无 lease |
| group.member.added | 群主 | backend→群成员 | group_id/member(类型+六要素或user_id) | 成员行 inserted；agent 成员 shadow_status='none'；`agent_sessions:changed`(audience) |
| group.member.removed | 群主 | backend→daemon | group_id/member_id | 成员行 removed_at 置位；agent 成员影子会话 SESSION_END→status='ended'、shadow_status='none'；**影子队列 pending 行删除**（防终态后静默丢弃）+ 群内系统提示"「昵称」已移除" |
| group.message.sent | 群成员 | backend | group_id/content/sender | 载体 run(status='completed', started_at=now) + user_input log；群频道 log 事件 |
| member.mentioned | backend(@解析) | backend 派发 | group_id/成员集合/协作链id/链深度 | 命中成员进入触发流程（懒建/注入） |
| shadow.created | backend（懒建） | daemon（lease） | 六要素/pinned_runtime/cwd/stage='group_member' | 影子 AgentSession(status='active') + interactive lease（kind='interactive'，手动审批关）；成员 shadow_session_id 回填 |
| member.injected | backend | daemon | session_id/run_id/prompt(简报+摘要+当前消息)/source_carrier_run_id/chain_depth | 影子 run(status='pending'→'running')；忙时进队列（AgentSessionQueuedMessage, sender_user_id=实际发送者, prompt 拼入摘要快照） |
| member.stream.log | daemon | backend→群频道 | run_id/projection_log_id/segment_id/member_id/member_name | 事务内双写投影行（载体 run，新 PK + metadata 身份）+ 群频道 log 事件（log_id=投影行 id） |
| member.turn.completed | daemon | backend→群频道/前端 | run_id/member_id/member_name | 影子 run→'completed'；群频道 turn_completed；互@检测（§4.4，护栏内再触发） |
| member.interrupted | 群成员 | backend→daemon | group_id/member_id/run_id | 影子在途 run SESSION_INTERRUPT→'killed'；群内系统提示"「昵称」已打断"；队列消息保留由 dispatch 续派 |
| member.config.switched | 群主（前端） | backend→daemon | member_id/六要素 diff | 成员表更新；SESSION_SWITCH_CONFIG→下轮边界 reload driver；runtime/workspace 变更→影子 end+pending |
| typing.ping | 群成员/后端(agent) | 群频道 | group_id/member_name/preview(≤400字) | 无状态（ephemeral，TTL 2.5s；不落库不进上下文） |
| presence.upsert | 群成员 SSE 连接 | Redis | group_id/user_id/TTL 60s | presence key 续期；面板绿点 |
| group.ended | 群主 | backend→daemon | group_id | 群会话 status='ended'；全部影子 SESSION_END→'ended'；成员 shadow_status='ended'；`agent_sessions:changed`(audience) |
| shadow.recovered | daemon 重启恢复 | backend | session_id/runtime | 影子 status→'reconnecting'→'active'（复用现有恢复链路，kind 无关） |

## 9. 边界与限制（明确接受的取舍）

1. **审批/AskUserQuestion 不进群**（首期）：影子会话 `manual_approval=False`（同 worker 先例），agent 权限请求按 lease 工具策略自动处理；群内审批转投为后续增强
2. **影子会话计量归群主**（首期）：影子 run/用量挂群主 user_id；群级分成员计量为后续
3. **会话闸共享**：同一机器上所有影子会话共享 daemon `SILLYHUB_MAX_ACTIVE_SESSIONS=20`；每群 **agent 成员上限默认 8、用户成员上限 50**（建群/加成员校验 + 超限提示；用户上限同时防 `agent_sessions:changed` audience payload 膨胀），溢出触发 SessionLimitReached 时群内系统提示"机器会话额度已满"
4. **群不绑 change**（首期）：群聊会话 change_id=NULL（change 场景仍走单聊/team）
5. **A2A 私信（agent 互发会话消息不进群）不做**：协作统一走群内互@（公开可见）
6. 未@消息也全量落库（离线成员重连可见 + q 搜索/标题派生口径一致）
7. **排队消息按入队时刻摘要快照派发**：排队期间群内新进展（含该成员自己其他轮次）不进快照——取实时性换取实现简单，群内长任务建议直接等 agent 空闲
8. **群会话不消费 run 级视图**：每条消息一个 completed 载体 run 会出现在 list_session_runs/usage 等按 run 视图里——群 UI 不展示 run 列表（群时间线是消息流模型），usage 计量走群主汇总口径（§9.2）

## 10. 非目标（Non-Goals）

- agent 主动插话（无人 @ 时自主发言）
- 外部 IM 渠道接入（WhatsApp/Telegram 等渠道桥）
- 群消息编辑/撤回、已读回执、@消息免打扰
- agent 间私信（A2A sessions_send 式）
- 群内语音/视频、文件实时转写（现有附件机制不变）
- typing 的"有观众才广播"优化、群级计量、群审批转投（列为后续增强）

## 11. 测试策略

- backend（pytest，模块 tests/）：@解析矩阵（全/半角@、@全体、无@、昵称边界、跨类型重名拒绝）、**群背景摘要组装**（截断 500/总长 6000/含 agent 回复/身份标签格式）、懒建+触发管线（含 **grants 授权分支**：非群主机器有/无 grant 两路、allowed_roots 预检）、**双写投影行**（新 PK 无冲突、metadata 身份、投影行 id 进群频道事件、override DELETE、partial 透传、身份快照不回填）、互@护栏（同轮去重/深度/频率/不自我、Redis 链 key TTL）、成员校验矩阵（成员/非成员/admin）、kind 列表过滤不泄漏、热切换 diff 分支（影子重建 vs SWITCH_CONFIG）、排队（满 5 → 409、**快照按入队时刻冻结**）、生命周期（建群/移除含队列清理/打断/解散 end 链）、agent_sessions:changed audience 投影、typing/presence（TTL 过期、生成器 touch、在线集读取）
- daemon（vitest）：影子会话 driver 复用不改逻辑，仅 stage='group_member' 标识透传的回归；现有 session-manager 用例不动
- frontend（vitest+testing-library）：群聊面板装配（多成员消息流身份分组、**平铺时间线全局 timestamp 排序**——实时与回放顺序一致性）、@补全（member 判别联合）、建群向导、typing 指示器（SSE typing 分支消费）、回放还原身份（投影行 metadata）、presence 绿点渲染
- 涉 LLM/delegation 的测试 monkeypatch `GLMConfig.from_env` 返 None（知识库铁律）

## 12. 风险与开放问题

- **桥接投影行双写的写放大**：agent 回复每条日志两次落库（影子 run + 载体 run 投影）。评估：群聊回复文本量级与单聊相同，PG 写入可承受；若 execute 期发现瓶颈，可只投影 assistant 最终文本段（跳过 partial，回放略有差异）
- **互@护栏参数**（深度 2/频率 6/agent 成员上限 8/用户成员上限 50）为首版保守值，execute 后按实测调
- **群 SSE 生成器多路订阅**：`agent_session:{gid}` + `group_typing:{gid}` 双 pubsub 合流，需注意生成器取消时两个订阅都释放（防 Redis 连接泄漏）——execute 时对照现有单订阅生成器的清理路径实现
- ~~pinned 机器授权~~（已闭环，Design Grill C8 修正）：非群主机器走 grants 授权分支，不再照抄 worker skip_owner_check 豁免
