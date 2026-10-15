# 符号影响面报告

> tasks.md 内容指纹（生成时）: 380874d158ac200b——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: DTO 响应体 additive 扩展——GroupChatCreate/Update 加可选字段 cross_mention_mode、GroupChatRead/ListItem/Detail 加恒透出字段；AgentGroupChat 模型加列（新增属性无既有签名变更）；迁移新文件。受影响调用点：群 CRUD router（透传，任务范围内）与前端 api-types（再生成，task-04 范围内）；无破坏性签名变更。
- task-02: 无签名级变更——mentions.py 互@触发参数构造函数内部加三态分支（函数签名不变），helpers.py 新增常量 ROLE_PROMPT_AGENT_PUBLIC（纯新增）；turn_overrides 新增键 dm_kind=agent_public/asked_by_member_id 为 dict 新键（消费方 group_bridge 在 task-03 范围内改造）。
- task-03: 无签名级变更——group_bridge.py 上下文结构识别 agent_public 分支（结构体字段 dm_kind 已存在，仅扩枚举值）+ 收口钩子内部追加回流调用（函数签名不变）；delegation_notice.py 为新文件新函数（纯新增）。
- task-04: 无签名级变更——member-panel.tsx/create-group-wizard.tsx 组件内部加控件（组件 props 不变）；api-types.ts×2 与 openapi.json 为生成物（additive 类型扩展，规则 21 义务产物）。
