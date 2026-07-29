---
author: qinyi
created_at: 2026-07-29T10:02:27
---
# 决策台账 — 2026-07-29-model-error-visibility

本变更的决策台账（非长期术语表）。仅记录有实现/验收影响的决策。

## D-001@v1 覆盖范围聚焦 claude 交互会话
- **type**: scope
- **status**: decided
- **source**: brainstorm step3 用户澄清（AskUserQuestion）
- **question**: 错误可见性覆盖哪些场景？
- **answer**: claude code 交互会话优先；架构预留多 agent 扩展点（adapter classifier 分发），本次不实现 codex/opencode/kimi，不做后台批量任务。
- **normalized_requirement**: FR-01（claude 交互会话错误可见）
- **impacts**: daemon classifier 按 agent 类型分发（仅 claude 落地）；Non-Goal 明确排除其他 agent 与 task-runner。
- **evidence**: 用户选「claude 交互会话优先」；其他 agent 错误输出格式不同，全做工作量过大。
- **priority**: P0

## D-002@v1 展示形式=消息流错误项 + 状态失败
- **type**: ux
- **status**: decided
- **source**: brainstorm step3 用户澄清
- **question**: 运行失败时页面怎么显示错误？
- **answer**: 在对话消息流插入醒目错误项（含原因）+ run/session 状态标「失败」。不做顶部 banner 单独方案。
- **normalized_requirement**: FR-04（错误项渲染）
- **impacts**: 前端新增 RunErrorItem 组件；normalize.ts 生成 error 类日志项；lifecycle event error_event_push。
- **evidence**: 用户选「消息流错误项 + 状态失败」。
- **priority**: P0

## D-003@v1 错误细分类型 + 针对性提示
- **type**: ux
- **status**: decided
- **source**: brainstorm step3 用户澄清
- **question**: 错误要不要细分类型给针对性提示？
- **answer**: 细分 auth_failed/quota_exceeded/rate_limited/timeout/model_not_found/network/provider_error/unknown，每类给可读 message + hint。
- **normalized_requirement**: FR-02（结构化错误类型）
- **impacts**: ModelErrorType 枚举贯穿三端；classifier 归类规则；前端 type→UI 映射表。
- **evidence**: 用户选「细分类型 + 针对性提示」。
- **priority**: P0

## D-004@v1 后续操作=重发/切换供应商/查看详情
- **type**: ux
- **status**: decided
- **source**: brainstorm step3 用户澄清
- **question**: 显示错误的同时要不要给操作入口？
- **answer**: 错误项带「重新发送」「切换供应商」「查看详情（展开 raw）」按钮。
- **normalized_requirement**: FR-03（错误后操作）
- **impacts**: 前端 actions；retry_inject 复用现有 inject 链路；切换供应商跳 llm-provider 设置。
- **evidence**: 用户选「重发 + 切换供应商 + 查看详情」。
- **priority**: P0

## D-005@v1 技术方案=方案C 三端标准协议
- **type**: architecture
- **status**: decided
- **source**: brainstorm step4 方案选择
- **question**: 错误归类放在哪层、结构化深度？
- **answer**: 方案 C——跨三端同构 ModelError 标准协议 + 类型枚举贯穿；daemon 每 adapter 归一化（claude 优先）→ backend 结构化存储 → frontend 类型→UI 映射。非方案 A（虽 daemon 近源归类，但无标准协议贯穿）/ 非方案 B（后端解析文本精度差）。
- **normalized_requirement**: FR-05（三端标准协议）
- **impacts**: 三端各自定义同构 ModelError 类型；契约靠 gen:types + 契约测试保证。
- **evidence**: 用户选「方案C：三端标准协议」；架构最可扩展。
- **priority**: P0
- **note**: 方案 C 在 claude 上的落地与 A 相似（daemon classifier + 后端字段 + 前端展示），差异在强调「标准协议+枚举贯穿」为多 agent 扩展建契约。

## D-006@v1 429 区分 quota_exceeded vs rate_limited
- **type**: design
- **status**: decided
- **source**: brainstorm step4/5 设计
- **question**: 429 如何处理？
- **answer**: 依错误文本区分：含「使用上限/quota/上限」→ quota_exceeded（retryable=false）；含「Too Many Requests/rate limit」→ rate_limited（retryable=true）。决定 retryable 与 hint 建议。
- **normalized_requirement**: FR-02
- **impacts**: §7.2 归类规则；枚举两个独立 type；retryable 语义。
- **evidence**: 实测 GLM 返回「[1310][您已达到每周/每月使用上限]」属 quota，非瞬时限流。
- **priority**: P1

## D-007@v1 AgentRun 用 JSON 列 error_detail
- **type**: data-model
- **status**: decided
- **source**: brainstorm step5 设计
- **question**: 错误信息在后端怎么存？
- **answer**: AgentRun 加单列 `error_detail`（JSON，存完整 ModelError）。非拆多列、非独立错误表。
- **normalized_requirement**: FR-06（错误持久化）
- **impacts**: §8 数据模型；alembic 加一列；契约即 ModelError JSON。
- **evidence**: JSON 单列够结构化且灵活，避免多列/独立表的过度工程；YAGNI。
- **priority**: P1

## D-008@v1 Non-Goals 边界
- **type**: scope
- **status**: decided
- **source**: brainstorm step3/5
- **question**: 哪些明确不做？
- **answer**: 不改 daemon-start.bat 的 GLM token；不回填历史 failed run；不自动恢复/自动切换供应商。
- **normalized_requirement**: §3 非目标
- **impacts**: 范围收口；历史 run 兜底「运行失败（无详情）」。
- **evidence**: GLM 额度是独立运维问题；自动恢复超范围；历史回填无结构化原料。
- **priority**: P1

## D-009@v1 error_code vs error_detail 分工
- **type**: boundary
- **status**: decided
- **source**: design-grill（F7 对账）
- **question**: AgentRun 既有 `error_code` 列与新增 `error_detail` 如何分工？
- **answer**: `error_code`（agent/model.py:113，既有，如 `no_online_daemon`）保留供**调度层/系统错误**；`error_detail`（新增 JSON）专存**模型层** ModelError（claude 调模型失败）。两者正交，不互相覆盖。
- **normalized_requirement**: §8 数据模型分工
- **impacts**: §8；run failed 时模型错误填 error_detail，系统错误保留 error_code；前端按 error_detail 渲染错误项。
- **evidence**: agent/model.py:113 既有 error_code；design-grill F7 对账。
- **priority**: P2
