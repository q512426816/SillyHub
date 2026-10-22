---
author: flow-machine-draft
created_at: 2026-10-22T16:57:27.461Z
---
# 决策记录（Decisions）— 2026-10-20-session-awaiting-answer-status

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：列表刷新频率下新增一次 IN 查询的负载。评估：与既有 owner_name/current_run_status/terminating_at 注入同构（同一查询函数内多次 IN 批查），单表 `idx_session_dialog_requests_status` + session_id 索引齐备；10s/30s 轮询与事件驱动共用的仍是同一次列表查询，增量成本可忽略。 另一风险：`dialog_kind` 语义扩容（如未来出现非「等用户回答」的持久化对话类型）会误显示问号——以「所有持久化 pending 对话即等用户回答」为当前契约（模型注释明示：普通 canUseTool 审批不落行，落行的都是 may wait indefinitely for a human answer）。若未来出现例外，在该注入点按 kind 白名单收窄即可，改动局部。 试过但放弃的方案： - 前端用 `fetchPendingDialogs`（workspace 聚合端点）在 portal 侧合并——portal 有 workspace/change/quicklog 三 scope，要各自请求+合并+多一轮轮询，且未打开会话也在左栏，聚合端点按 workspace 粒度不匹配行级展示。放弃。 - 复用活性 `blocked` 区分——blocked 是 tailer 10s 推导的通用「停住」态，无法区分等审批/等回答/其它阻塞，且本地 CLI 会话 30s 轮询下最坏 ~40s 才可见。放弃。 - 在 run 表加列——写路径多、语义错位（等待是对话请求状态而非 run 状态）。放弃。
