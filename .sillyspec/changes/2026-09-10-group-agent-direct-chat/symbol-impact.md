# 符号影响面报告

> tasks.md 内容指纹（生成时）: 3b82638b5b02d059——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更。SQLAlchemy 声明式模型仅新增列（consensus_mode/consensus_timeout_seconds 带 server_default）与新增表类 AgentGroupConsensusTask，无函数/构造签名改动，既有调用点零影响。
- task-02: DTO/Schema 定义变更（新增可选字段）：GroupChatCreate/Update/Read + consensus_mode/consensus_timeout_seconds（带默认，构造兼容）；GroupMessageSendRead + consensus_task_id（uuid|None）；GroupMemberTriggerRead + consensus_role（str|None）。受影响调用点：群建/改端点构造（backend/app/modules/agent/router 群路由）、send_group_message 返回组装（task-03 填值）、前端 api-types 消费（task-10 重生成）。均在任务范围内。
- task-03: 函数签名变更：_parse_group_mentions 增加 split_broadcast: bool = False 参数（默认 False，既有调用点 messages.py/mentions.py 内部与测试不传零影响，调用点在本任务 allowed_paths 内）。send_group_message 内部新增汇总分支与 _trigger_group_member kwargs 传参（消费 task-04 签名），返回体加 consensus_task_id（DTO 层已在 task-02 声明）。
- task-04: 方法签名变更：_trigger_group_member 增加 role_prompt: str|None = None 与 turn_overrides: dict|None = None（默认 None 零行为变化）。受影响调用点：messages.py（群触发/直聊间接经 _trigger_member_isolated）、mentions.py（互@触发）、shadow.py 内部——默认参数全兼容，显式传参的消费方 task-03/06 均在任务范围内。
- task-05: 类字段变更：_GroupBridgeContext（dataclass）增加 dm_target_member_id/consensus_role 字段（默认 None，构造兼容）。受影响调用点：_resolve_group_bridge_context 填充（同文件）、submit_steps.py:207 消费点（allowed_paths 内）。投影拦截为内部谓词分支，无签名变更。
- task-06: 无新签名级变更（消费 task-04 签名传 role_prompt/turn_overrides；护栏函数零改动）。run_cross_mention_detection 签名不变。
- task-07: 新文件新符号（record_collaborator_outcome/deliver_collaborator_opinion/inject_converge_directive 等）——无既有调用点，消费者 task-08/09 在范围内。
- task-08: 无签名级变更。_close_group_hooks 内部逻辑扩展（签名不变），消费 task-07 新函数。
- task-09: 无签名级变更。新增 consensus_sweeper_loop 常驻协程 + main.py lifespan 挂载（照 lease_expiry_sweeper 先例，无既有符号改动）。
- task-10: TS 类型定义变更：api-types.ts 由 OpenAPI 重生成（GroupChat*/GroupMessageSend/GroupMemberTrigger interface 新增可选字段，消费点为向导/设置/面板组件，均在 allowed_paths 内）。组件内部改动无导出签名变更。
