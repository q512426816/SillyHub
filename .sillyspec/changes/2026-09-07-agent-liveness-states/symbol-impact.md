---
author: qinyi
created_at: 2026-09-07 14:10:00
---
# 符号影响面报告（Symbol Impact）— Agent 会话活性状态推导

> 逐 task 结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）列变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更显式写明。

| task | 签名级变更 | 说明 |
|---|---|---|
| task-01 | 无签名级变更 | 全新模块 `agent-log/liveness/{types,registry}.ts`：新增导出 LivenessState/DeriverInput/DeriverOutput/LivenessDeriver/getDeriver，无既有调用点 |
| task-02 | 无签名级变更 | 新文件 derive-zcode-model-io.ts + registry.ts 注册行追加（getDeriver 消费方零改动） |
| task-03 | 无签名级变更 | 新文件 tailer.ts（导出 LivenessTailer 类，仅 task-06 消费） |
| task-04 | 无签名级变更 | 新文件 discovery.ts（导出 discoverLivenessWatchTargets，仅 task-03/06 消费） |
| task-05 | 无签名级变更 | discovery.ts 内部扩展窄扫档，公开签名不变 |
| task-06 | 方法新增（非修改） | hub-client.ts 新增 pushAgentLogStates/fetchAgentLogEntries 两方法（新增不改既有签名）；daemon.ts 新增 tailer 挂接调用点（start/stop 序列插入） |
| task-07 | DTO/ORM 字段新增 | AgentSessionLogORM 增 state/state_derived_at/state_evidence/last_event_at 四 nullable 列（类属性新增，无方法签名变更）；schema 响应模型增同名可选字段——受影响调用点：GET /agent-logs 响应消费者（frontend api-types，再生成在 task-14 范围内） |
| task-08 | 路由/service 函数新增 | 新增 POST /agent-logs/states 路由 + service.py 新函数 upsert_agent_log_states（新增）；GET 响应模型透传四字段（task-07 已声明字段，此处填充返回值） |
| task-09 | 常量/函数新增 | notification 新 type 常量 agent_blocked + service 新建通知函数；无既有签名修改 |
| task-10 | 无签名级变更 | 新文件 derive-codex-rollout.ts + registry 注册行 |
| task-11 | 无签名级变更 | 新文件 derive-claude-code.ts + registry 注册行（spike-02 证伪则 blocked 分支不实现，签名不变） |
| task-12 | DTO 字段新增 | list_workers 响应 worker 增 liveness 可选字段（agent/schema.py DTO 字段级增量，旧消费方向后兼容；受影响调用点：MCP 消费方=编排 agent 指令模板——语义说明在 task-13 范围内同步交付）；orchestrator/mission_context 汇入点由 spike-01 定（若需改函数入参在此 task 内闭环） |
| task-13 | 无签名级变更 | sillyhub-mcp.js 模板字符串文本改写（不改函数签名/执行逻辑） |
| task-14 | 前端组件增量 | 会话列表行/工作台/面板组件渲染增量（组件内部，无导出 props 签名破坏）；api-types.ts 再生成（消费 task-07/08 新字段） |
| task-15 | 无签名级变更 | 集成验收，不改产品代码 |
