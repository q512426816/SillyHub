# Decisions：会话附件

## D-1: 图片 base64 由 backend 预读内联下发
- type: architecture
- priority: P1
- status: accepted
- source: brainstorm 方案 A
- rationale: 省 daemon 回拉一跳；受 D-4 帧闸门约束。

## D-2: 非图片非 PDF 文件落会话 cwd/attachments/ 供工具消费
- type: architecture
- priority: P1
- status: accepted
- source: brainstorm
- rationale: Claude Code 生态 Read/Grep 工具消费最自然；大文件多模态不可行。

## D-3: 历史回显走 user_input 日志标记行（不加 DB 列）
- type: architecture
- priority: P2
- status: accepted
- source: brainstorm
- rationale: agent_run_logs 本就是回显数据源；零迁移。
- impacts: [FR-6]

## D-4: 帧总量闸门——内联 base64 总量 >8MB → 全部附件改 daemon 回拉
- type: consistency
- priority: P0
- status: accepted
- source: design-grill X-001
- question: 按"单张 >8MB 回拉"判定时 5×7MB 内联=35MB 单帧，超 WS/Redis 舒适区
- answer: 闸门按 payload 总量判定，超限整体切回拉模式（payload 只带元数据+objectKey）
- impacts: [FR-2, FR-5]

## D-5: 对象不删只删行（V1）
- type: risk
- priority: P2
- status: accepted
- source: brainstorm
- rationale: 内容寻址对象可能共享；孤儿对象存储泄漏为 accepted risk（清理任务只删行）。

## D-6: codex 不支持附件（三层门控）
- type: compatibility
- priority: P1
- status: accepted
- source: brainstorm
- answer: 前端禁用入口 + backend 422（HTTP_422_SESSION_ATTACHMENTS_UNSUPPORTED）+ driver 忽略兜底。
- impacts: [FR-7]

## D-7: 带附件豁免空 prompt
- type: definition
- priority: P1
- status: accepted
- source: design-grill X-002
- rationale: 看图说话场景；先例：ql-20260817-010 静默切换豁免。
- impacts: [FR-9]

## D-8: 附件生命周期独立于会话软删
- type: boundary
- priority: P2
- status: accepted
- source: design-grill X-004
- rationale: 归属校验只查 user_id；会话删除后历史标记仍可回显。

## D-9: 多模态能力门控 + 自动降级
- type: feasibility
- priority: P0
- status: accepted
- source: 用户补充（2026-08-20「不是所有模型都是多模态的，比如 GLM」）
- question: 向 GLM-4.5 等文本模型直传 ImageBlock → Anthropic 兼容端点 400 或中转站静默丢图
- answer: llm_providers 加 multimodal 三态（auto 启发式 / true / false 手动覆盖；auto 未命中别名=不支持，保守侧）；inject 按会话实际生效 provider 判定，不支持时图片/PDF 自动降级文件落盘模式（turn 不失败，prompt 注明）；前端明示降级提示条
- normalized_requirement: FR-10；启发式前缀表覆盖 glm-*-v/*-vl/*vision/gpt-4o/gpt-5/claude-*/gemini-*/qwen*vl
- impacts: [FR-2, FR-5, FR-10, task-05, task-06, task-13；llm_providers 迁移]
