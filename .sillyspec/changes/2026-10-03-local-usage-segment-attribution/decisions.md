---
author: qinyi
created_at: 2026-10-03
---

# 决策记录（Decisions）

## D-001@v1: 本地用量归属 = 水位差分片段（方案 2）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 同一日志文件（CLI 会话）连续干多个变更时用量归属被后上报覆盖——三方案：①归属不覆盖 ②按片段水位差分 ③接受现状加注脚
- answer: 方案 ②（用户 AskUserQuestion 拍板「方案 2」）。协议：每次 agent-logs 上报插一行「水位」记录（上报时刻的 ctx + 当行已落库累计五值：invocations/四维 token）；某变更的本地用量 = 该 ctx 水位与下一水位（或 entry 当前快照）的差分之和。否决 ①（把偏差换个方向：后干的工作量记到先变更）、③（跨变更连续工作是常态，持续失真不可接受——本会话实证 caliber-fix 的量被 backfill 抢走）。
- normalized_requirement: 新水位表（上报时点快照水位）；上报链路在 upsert 覆盖前读旧行插水位；聚合本地段改「水位差分求和」，无水位历史的存量 entry 仍按整行快照归属当前 ctx（回填已完成的存量不重算）；差分 max(0,·) 防御负值；ctx 为空的水位片段不计任何变更。
- impacts: [FR 定义, 数据模型, 聚合服务, 上报链路]
- evidence: DB 实证（本会话 2026-10-03）：sess_25a36c16 先干 caliber-fix 后干 backfill，entry 归属被最后一次上报覆盖为 backfill（caliber-fix 聚合会话 0 entry）；用户裁决轮次 1
- 故障面: 水位插入与摄取异步竞态（水位取的是「当时已落库值」，摄取稍后刷新——差分仍正确，见 D-002 时序推演）；水位表无界增长（见 D-003 修剪）
- 退役判据: 若未来 CLI 协议升级为逐调用上报（含实时 ctx），水位差分可整体下线换直记

## D-002@v1: 水位语义 = 「ctx 接管时点的已落库累计值」，差分归属前水位 ctx
- type: definition
- priority: P0
- status: accepted
- source: code
- question: 水位记什么值、片段归属给谁（时序推演：上报是同步 upsert、摄取是异步刷快照）
- answer: 上报 N（ctx=B）时，在 upsert 覆盖**前**读旧行已落库五值插水位行 (ctx=B, mark=旧值)——mark 即「B 接管时点已落库累计」。B 变更用量 = Σ(下一水位 − 本水位)；A 的尾巴（A 最后上报后到 B 接管前的增量，由 A 时期的异步摄取刷进快照）包含在 mark_B 里，差分 (mark_B − mark_A) 全归 A ✓。最后一个水位到「现在」的量归最后 ctx（聚合时取 entry 当前快照 − 末水位）。连续同 ctx 上报插多条水位（聚合差分自然合并，不做合并优化）。
- normalized_requirement: 水位插入点 = platform_sync service upsert 循环内、行覆盖前；值源 = 库中旧行（无旧行/NULL 快照按 0 记水位）；quicklog 片段同构（quick_id 水位）。
- impacts: [上报链路实现, 聚合 SQL]
- evidence: 时序推演：上报 N(ctx=B)→异步摄取刷 V'_N→上报 N+1(ctx=C) 水位 C.mark=V'_N——A 量=(mark_B−mark_A)、B 量=(V'_N−mark_B) 守恒无缺口无重叠

## D-003@v1: 水位表增长治理 = 每 entry 保留最近 200 行 + 归档豁免
- priority: P2
- type: risk
- status: accepted
- source: code
- question: 水位表随上报频次无界增长（CLI 每条命令一次上报）
- answer: 每次插入后按 log_entry 维度修剪保留最近 200 行（单条 SQL DELETE，对齐 platform_change_events 5000 修剪先例）；聚合只消费差分，老水位删掉不影响已消费片段（片段在被下一水位消费后即无用——修剪 200 行保留远超「待消费」窗口）。存量豁免：不回填历史水位（无历史水位 = 存量 entry 走整行快照归属，D-001）。
- normalized_requirement: 上报事务内插水位 + 条件修剪（count>200 时删旧）；变更归属归档后其历史水位随修剪自然淘汰。
- impacts: [数据模型, 上报链路]
- evidence: 先例 backend/app/modules/platform_sync/router.py 变更事件通道 5000 条同事务修剪（2026-09-23-change-events-channel）

## D-002@v2: 水位语义补精度边界（Grill X1 修正，supersedes D-002@v1 的一条断言）
- type: definition
- priority: P1
- status: accepted
- supersedes: D-002@v1
- source: design-grill
- question: 「A 尾巴全归 A」在摄取滞后时是否恒成立
- answer: 恒成立的是**总量守恒**（mark 单调序列 telescoping 可证）；「A 尾巴归 A」仅在尾巴摄取先于 B 上报落库时成立——滞后窗口内跨界 token 归后继变更（错归方向声明：后继多计/前驱少计），窗口=一次摄取延迟。invocations 同步值无此问题。D-002@v1 其余语义不变。
- normalized_requirement: 反例序列（上报A→上报B（摄取未跑）→摄取→上报C）进单测：断言 Σ守恒 + A/B/C 各得量符合边界声明。
- impacts: [FR-03, R-06, 测试]
- evidence: 审查 review-2026-10-03-173933 X1 反例推演

## D-004@v1: 首水位锚定 = 差分序列隐式起点 0（Grill X2 P0 修正）
- type: architecture
- priority: P0
- status: accepted
- source: design-grill
- question: CLI 全量重推把存量 entry 卷入水位协议——首水位 mark=存量基线 V0，[0,V0) 段无人认领、整行路径又被排除，回填基线脱离归属
- answer: 每 entry 差分序列隐式起点 0：首水位 ctx 认领 [0, mark_first)。存量迁移语义=与改造前整行归属同值同主（重推 ctx 即当时 ctx）；新文件 mark_first=0 无影响。实现为聚合侧规则（无需插锚定行）。
- normalized_requirement: 聚合 SQL 首水位 diff = mark_first − 0；单测覆盖「存量 entry 带基线被重推」场景断言数字连续。
- impacts: [FR-02, 聚合实现, R-01]
- evidence: 审查 review-2026-10-03-173933 X2；CLI 全量重推事实 service.py:1947-1951
- 故障面: 首水位 ctx 认领基线——若存量真实归属与重推 ctx 不同（历史换主场景），基线记给重推 ctx（与改造前整行路径行为一致，不劣化）；修剪若未豁免首水位则基线转移（已由 D-003@v2 堵死）
- 退役判据: 若 CLI 协议升级为逐调用实时上报（带 ctx），差分协议与锚定整体下线

## D-003@v2: 修剪豁免每 entry 最旧一条水位（supersedes D-003@v1 修剪语义，复审 L1）
- type: risk
- priority: P1
- status: accepted
- supersedes: D-003@v1
- source: design-grill
- question: 首水位被修剪删除后，隐式起点 0 锚定的 [0, mark_new_first) 段转移给新首水位 ctx——动机场景 200+ 上报后延迟复发
- answer: 修剪豁免每 entry 最旧一条水位行（首=锚定载体、末=待消费锚点，中段自由修剪）。v1「老水位删除不影响已消费」修正为「中段不影响；首末恒留」。@v1 的 200 行量级与同事务修剪机制不变。
- normalized_requirement: 修剪 SQL 豁免 min(seq) 与隐式末位；FR-01 加豁免断言（201 次上报后首水位仍在、归属不转移）。
- impacts: [FR-01, R-04]
- evidence: 复审 review-2026-10-03-173933 L1 推演
