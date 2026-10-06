# 符号影响面报告

> tasks.md 内容指纹（生成时）: 78120e0b19fded3d——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 签名级变更：LlmProvider.agent_kind: str 列属性 → agent_kinds: list[str]（model.py）+ __table_args__ 索引元组调整。受影响调用点：schema.py 三 DTO、service.py create/update/set_default、context.py/inject_gates.py/capability.py/tools.py 四处 row.agent_kind 读取——全部在 task-02~04 范围内
- task-02: 签名级变更：LlmProviderCreate/Update/Read 的 agent_kind: str → agent_kinds: list[str]（含 _forbid_pi_openai_chat 校验器判定入参）。受影响调用点：service.py 赋值/日志行、前端 api-types（task-09 重生成）
- task-03: 无新签名变更（service 内部 create/update/set_default 逻辑改集合遍历；_clear_sibling_defaults 参数 user_id+agent_kind → 循环调用，私有 helper 语义内变）
- task-04: 无公开签名变更：resolve_default/bound/_inject_provider_config 返回 dict 结构不变（agent_kind 键值来源细化为会话引擎）；capability/tools 内部查询条件集合化
- task-05: 无签名级变更：notify_provider_switch(session, user_id, provider_config) 签名不变，内部改按会话引擎分组构造 config
- task-06: 无签名级变更（注释/description 文本同步）
- task-07: 无签名级变更（测试）
- task-08: 无签名级变更（表单 UI 控件形态；DTO 消费经 task-09 类型）
- task-09: 签名级变更（生成物）：api-types.ts 的 agent_kind: string → agent_kinds: string[]（gen:types 再生成）+ llm-providers.ts 归一化函数内部字段
- task-10: 无签名级变更（测试）
- task-11: 无签名级变更（手动验收记录）
