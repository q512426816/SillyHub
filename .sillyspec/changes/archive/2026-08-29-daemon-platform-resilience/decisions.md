---
author: qinyi
created_at: 2026-08-29 02:35:14
---

# 决策记录（Decisions）

## D-001@v1: daemon 重启后原会话恢复口径
- type: term
- priority: P0
- status: accepted
- source: user
- question: daemon 关闭一段时间再重启后，原会话的验收标准是什么？
- answer: 自动恢复可继续对话——历史消息完整、会话状态正常（存活），用户可以直接在原会话里继续发消息；被中断的那一轮标记失败，但不影响会话存活
- normalized_requirement: daemon 停止（优雅停止或进程被杀）后再次启动，持久化会话经恢复链路回到 active 并可继续对话；中断轮终态为 failed；任何时长间隔后重启均要求历史消息一条不丢
- impacts: [FR-04, FR-05]
- evidence: 用户 AskUserQuestion 回答第 1 轮（2026-08-29）

## D-002@v1: 服务器重新部署范围
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 「服务器重新部署」包含哪种情况？
- answer: 仅后端进程重启（docker 容器重启/发新版镜像），数据库保留，daemon 的 api_key 与注册信息仍有效
- normalized_requirement: 不要求覆盖 DB 清空/换库场景（daemon 凭证全失效后的重新绑定流程不在本轮范围）；后端进程重启后 daemon 侧零人工干预自动恢复，平台侧状态自动收敛
- impacts: [FR-02]
- evidence: 用户 AskUserQuestion 回答第 1 轮（2026-08-29）

## D-003@v1: 前端回显纳入范围
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 本轮改造是否包含前端回显体验？
- answer: 包含关键前端修复——断线状态提示、卡住的「运行中」轮次兜底、审批面板断线重连
- normalized_requirement: daemon/后端数据正确性之外，前端需可见连接状态（重连中提示）、运行中轮次有本地超时/对账兜底（不无限挂起）、审批面板 SSE 断线后自动重连
- impacts: [FR-06]
- evidence: 用户 AskUserQuestion 回答第 1 轮（2026-08-29）

## D-004@v1: 改造深度
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 改造深度允许到什么程度？
- answer: 允许结构改造——可新增接口/协议（控制消息补拉接口、lease 过期回收后台任务、SSE 游标增强等），彻底解决断线窗口丢消息
- normalized_requirement: 不限于参数级调整；新增端点/表/常驻协程需按既有模式（如 DaemonChangeWrite 占坑-轮询-GC、outbox 幂等）设计，保持三端（Windows/Linux/macOS）兼容
- impacts: [FR-01, FR-03]
- evidence: 用户 AskUserQuestion 回答第 1 轮（2026-08-29）

## D-005@v1: 实现方案选型
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 控制指令可靠化与整体稳定性改造采用哪种方案（A 可靠投递+分层加固 / B 纯轮询化 / C 事件溯源重构）？
- answer: 方案 A——控制指令落库待发（参考 DaemonChangeWrite 占坑-轮询-GC 先例）+ WS 推送保即时性 + daemon 重连后 HTTP 补拉幂等消费；分层加固：daemon 退避重连+register 重试、终态上报入 outbox、backend lease GC 接线与 WS 断开即时降级、会话 suspended 挂起语义、前端连接状态与看门狗兜底
- normalized_requirement: 下行控制面采用「落库 pending → WS 推送 → 补拉 ACK」三段式，command_id 幂等；不采用轮询优先（B）与事件溯源（C）
- impacts: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
- evidence: 用户方案选择轮（2026-08-29，AskUserQuestion 第 2 轮）

## D-006@v1: 六段设计整体确认
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 六段设计（A1 daemon 连接韧性 / A2 控制指令可靠投递 / A3 上行终态可靠化 / A4 backend 收敛接线 / A5 会话挂起语义 / A6 前端回显兜底）是否确认？
- answer: 确认。变更名 2026-08-29-daemon-platform-resilience，原型 prototype-session-connection-states.html 六状态快照
- normalized_requirement: 设计按 A1-A6 六块推进；关键语义决策：控制指令补拉只返回 pending（delivered 不重发，零重复执行）；WS 断开延迟 10s 再降 DB 离线防抖动；suspended 会话 24h 上限；恢复网络失败保留本地记录退避重试
- impacts: [design.md 全文]
- evidence: 用户设计确认轮（2026-08-29，AskUserQuestion 第 3 轮）

## D-007@v1: Design Grill 交叉审查裁定的语义空洞
- type: consistency
- priority: P1
- status: accepted
- source: design-grill
- question: 独立审查发现的 5 处语义空洞如何裁定？（X-07/X-08/X-14/X-15/X-22）
- answer: ①WS 断开 10s 延迟降级的取消判定=延迟任务执行时复查 ws_hub.is_connected(daemon_instance_id)，为真则跳过；DB 抖动窗口上限一个心跳周期（~15s），期间不派发优于派发即卡死。②offline sweep 改挂起只覆盖 active，pending 会话维持 failed（daemon 本地无快照记录，suspended 无人 recover）。③outbox 扩展形态=entry 加 kind 字段（messages/run_result/session_end）、drain 按 kind 路由（SubmitClient 扩展两方法）、文件命名维度泛化为 dedupId（旧 runId 文件 load 兼容）。④inject 控制指令两条过期路径（pending 过期、delivered-未-ack 过期）均联动 run→failed(interactive_inject_send_failed)。⑤recover 维持「非终态一律可 recover」现状非白名单语义，用例锁定 suspended/pending/reconnecting 三态
- normalized_requirement: design.md A2/A3/A4/A5/生命周期契约表/接口定义已按上述裁定修正；实现阶段不得偏离
- impacts: [FR-01, FR-02, FR-04, task 执行]
- evidence: 独立审查子代理 cross-check matrix X-07/X-08/X-14/X-15/X-22（2026-08-29，.sillyspec/.runtime/stage-reviews/brainstorm-review-2026-08-29-024203/review.json）
