---
author: qinyi
created_at: 2026-09-02 00:07:28
change: 2026-09-01-session-group-chat
---

# 任务分解：会话群聊（粗粒度输入，供 plan 阶段编排 Wave）

> 本文件是 brainstorm 产出的功能域分解；实现顺序、依赖与文件级拆分由 `sillyspec run plan` 重组。

## 任务注册表（plan step 2 写回，execute 解析此清单）

- [ ] task-01: 数据模型与迁移（session_kind + metadata 列 + 两新表 + alembic + DTO + gen:types）
- [ ] task-02: 群管理服务与权限分支（group router/service CRUD + _require_group_member + 4 处集中校验改造）
- [ ] task-03: 群消息与 @触发管线（载体 run + @解析 + 影子懒建 grants 授权 + 注入组装 + 忙轮排队）(depends_on: task-01,02)
- [ ] task-04: 互@协作护栏与热切换（turn_completed 检测 + Redis 护栏 + 六要素 diff 分支）(depends_on: task-03,05)
- [ ] task-05: 桥接投影（run_sync 双改动点：事务内双写投影行新 PK + 群频道事件 + turn_completed 成员身份）(depends_on: task-03)
- [ ] task-06: 实时通道（SSE 多路订阅合流 + typing 端点/agent typing + presence + audience events）(depends_on: task-02)
- [ ] task-07: 前端群列表与建群向导（SessionsPortal 群分区 + 向导 + API 客户端）(depends_on: task-01,02)
- [ ] task-08: 前端群聊面板（group-chat-panel 平铺时间线 + SSE 消费 typing/resync）(depends_on: task-05,06,07)
- [ ] task-09: 前端成员面板与 @补全（member-panel 热切换弹窗 + mention-popover member 扩展）(depends_on: task-02,07)
- [ ] task-10: daemon 回归 + 真实 e2e 验证（stage 透传回归 + Docker 部署浏览器实测 AC-01~07）(depends_on: task-01..09)


## T1 数据模型与迁移（backend 基础）
- T1.1 alembic 迁移（先 `alembic heads` 确认单 head）：`agent_sessions.session_kind`（default 'chat'）+ `agent_run_logs.metadata` JSON NULL + 新表 `agent_group_chats` / `agent_group_members`（含 UNIQUE(group_id, display_name)、成员六要素列、shadow_session_id 反向指针、config_snapshot）
- T1.2 model.py 模型类 + schema DTO（GroupChatRead/MemberRead/建群与成员变更请求体）+ `pnpm gen:types` 重生成并提交 api-types.ts/openapi.json

## T2 群管理服务（backend）
- T2.1 群 CRUD 路由/服务：建群（群会话 kind='group' 创建）、群列表（成员过滤+成员摘要 chips+online_member_ids）、详情、PATCH 设置、解散（end 群+全部影子+队列清理）
- T2.2 成员管理：加/移用户成员、agent 成员六要素 CRUD（昵称唯一校验/上限校验）、移除 agent 成员联动（影子 end+队列清理+群内提示）
- T2.3 权限：`_require_group_member` 两段式（成员→workspace admin→404）；集中改造 `_get_owned_session_for_update` / `get_agent_session` / list·logs 内联谓词 / SSE router 内联校验 / **permission_service.py（3 处）/ file_artifacts.py** 群分支（单聊路径不动）

## T3 消息与触发管线（backend 核心）
- T3.1 群消息端点：载体 run（completed+started_at）+ user_input 落库 + 群频道 log 事件（sender 身份）
- T3.2 @解析（全/半角、@全体、昵称精确匹配、边界规则）+ 触发编排（并行触发/@全体广播）
- T3.3 影子会话懒建（worker 三件套先例：ORM 行 config.manual_approval=False + prepare_interactive_dispatch，机器授权 grants 分支 + allowed_roots 预检）
- T3.4 注入组装：成员简报 + 群背景摘要（最近 N 条含投影行，截断规则）+ 当前消息；忙轮排队（prompt 拼入文本 + 链 metadata 透传）
- T3.5 互@协作：turn_completed 后回复文本 @检测 → 触发管线（来源标注）；Redis 护栏（group_chain 去重集+depth TTL 30min、group_rate 滑动窗口、不自我）；开关读取
- T3.6 热切换：六要素 diff 分支（SESSION_SWITCH_CONFIG 服务身份下发 vs 影子重建重置记忆）

## T4 桥接投影（backend 核心）
- T4.1 submit_messages 事务内双写投影行（新 PK、dedup_key 复用、metadata 身份、assistant 文本过滤、partial/override 语义）+ PublishIntent 扩展标量（group/member/projection_log_id）
- T4.2 publish_submitted_messages 群频道发布（log 事件带投影行 id 与成员身份）
- T4.3 close_interactive_run 群频道 turn_completed（成员身份字段）+ 互@检测挂接

## T5 实时通道（backend）
- T5.1 群 SSE 生成器多路订阅（agent_session:{gid} + group_typing:{gid} 合流，event: typing；双订阅释放）
- T5.2 typing 端点（节流/TTL 2.5s/preview 400 字）+ agent typing 自动事件
- T5.3 presence（group_presence key TTL 60s，生成器 >45s touch；列表/详情返回 online_member_ids）
- T5.4 agent_sessions:changed payload 增 audience_user_ids + events 过滤分支

## T6 前端
- T6.1 群列表分区（SessionsPortal + session-list-panel 分桶，数据源 /api/group-chats）
- T6.2 建群向导（群名→邀人→agent 六要素配置，多成员）
- T6.3 group-chat-panel：平铺时间线（全局 timestamp 排序、成员身份气泡、流式光标、系统事件）+ SSE 消费（typing 分支、断线 resync）
- T6.4 输入区：@补全（mention-popover 扩展 member 判别联合）+ typing 上报
- T6.5 成员面板（用户在线/移除；agent 六要素卡片+热切换弹窗+重置记忆）+ 群设置

## T7 daemon（最小改动）
- T7.1 stage='group_member' 标识透传回归（driver/SessionManager 零逻辑改动验证）；会话闸 SessionLimitReached 群场景错误呈现

## T8 测试与验收
- T8.1 backend pytest：design §11 清单（@矩阵/摘要组装/懒建+grants 两路/双写投影（新 PK 无冲突/投影 id 进事件/override DELETE）/互@护栏矩阵/权限矩阵/kind 过滤/热切换/排队快照冻结/生命周期含打断与队列清理/audience/typing presence TTL）
- T8.2 frontend vitest：面板装配+排序一致性、@补全、向导、typing、回放身份还原
- T8.3 回归：单聊/quick-chat/团队现有测试全绿；ruff/mypy/tsc 零错
