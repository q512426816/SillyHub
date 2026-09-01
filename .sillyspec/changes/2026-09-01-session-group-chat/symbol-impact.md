# 符号影响面报告

> tasks.md 内容指纹（生成时）: cd3185bb43e69518——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 新增型变更（AgentSession/AgentRunLog 加列 server_default/nullable 不改签名；AgentGroupChat/AgentGroupMember 为全新模型；schema.py 新增群 DTO 不改既有 DTO）；既有调用点（list_agent_sessions 等读列查询）零破坏——均在任务范围内
- task-02: 新增型变更为主：新建 daemon/group/ 子模块（新 router/service）；_get_owned_session_for_update/get_agent_session/list/logs 内部加 kind 分支（函数签名不变，仅内部分支）；permission_service/file_artifacts 同款内部分支。无既有调用点需改
- task-03: 新增型：group 内新端点与 _parse_group_mentions 等新函数；prepare_interactive_dispatch 传参复用现有参数（pinned_runtime_id/cwd/provider/stage，不改签名）；placement.py 若需暴露 grants 分支仅为参数取值路径（skip_owner_check=False 既有路径），无签名变更
- task-04: 新增型：互@检测/护栏为 group/service 新函数；热切换复用 inject_session_as_service 与 SESSION_SWITCH_CONFIG 既有链路（不改签名）；session/service.py 仅加分支
- task-05: PublishIntent dataclass 新增可选标量字段（group_id/member_*/projection_log_id）——构造调用点仅 submit_messages 内部自建（单一构造点随任务更新），外部无构造调用；AgentRunLog 新 PK 行为新增插入路径不改既有签名；close_interactive_run 内部加分支
- task-06: 新增型：typing 端点/新 Redis 频道/presence 函数均为新增；stream_session_logs 生成器内部加多路订阅分支（签名不变）；session_events publish_sessions_changed payload 加可选 audience_user_ids 键（payload 为 dict 无 DTO 签名约束，消费方 _stream_sessions_events 过滤分支同任务内改）
- task-07: 新增型：lib/daemon.ts 新增群聊客户端函数（不改既有函数签名）；sessions-portal/session-list-panel 加分区渲染分支（props 不变或加可选 prop 向后兼容）
- task-08: 新增型：group-chat-panel 全新组件；lib/daemon.ts 新增 SSE typing 分支消费逻辑（streamSession 既有函数不动，群流用新封装）
- task-09: 扩展型：session-mention-popover SessionMentionItem 判别联合新增 member kind（新增联合成员向后兼容——既有 kind 分支零改动，TypeScript exhaustive check 需补 member 分支即本任务内完成）；member-panel 全新组件
- task-10: 无签名级变更（回归验证与 e2e；session-manager.ts 预期零改动，若需 stage 标识仅元数据透传）
