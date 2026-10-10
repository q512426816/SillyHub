---
author: qinyi
created_at: 2026-10-10 23:02:30
generated_by: sillyspec-fourpiece-init
change: 2026-10-10-linked-repos-local-echo
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: 需求本体——本地配置上行回显（本地→平台方向）
- type: term
- priority: P0
- status: accepted
- source: user
- question: 「本地已配置好的关联仓平台页面能看到回显」指什么？
- answer: 上行方向：成员机器上手工配置的 sillyspec 两类本地配置（.sillyspec/projects/*.yaml 子项目登记与 local.yaml repos: 注册表）应能被平台读取并展示——与既有下行链路（平台登记→daemon 落盘）对偶。
- normalized_requirement: 交付=只读快照上行 + 对照展示 + 一键导入，不动既有下行链路。
- impacts: [全部]
- evidence: 用户原话轮 1；工具读取能力查证（workspace status --json / config cat）

## D-002@v1: 形态=展示对照+一键导入（用户选定）
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 回显做成纯展示 / 展示+导入 / 仅导入向导？
- answer: 展示+一键导入：卡片新增「本机已有配置」对照区（三态：两边一致/仅本地/仅平台），「仅本地有」条目可勾选导入为平台登记。
- normalized_requirement: 快照展示与导入动作都在既有「关联仓」卡片内，不做独立页面/向导。
- impacts: [FR 全部]
- evidence: AskUserQuestion 用户选定（2026-10-10）

## D-003@v1: 拉取时机=手动刷新现拉（不随 GET 自动拉）
- type: architecture
- priority: P2
- status: accepted
- source: code
- question: 快照何时拉取——列表 GET 自动拉 or 按需手动？
- answer: 手动「刷新本机现状」按钮现拉（请求-响应 RPC）。理由：daemon 离线/超时不阻塞列表加载；本地配置低频变化，conflict_snapshot 按需拉取先例同款。
- normalized_requirement: GET local-snapshot 独立端点，前端按钮触发；离线/超时返回结构化降级（不 5xx 列表）。
- impacts: [FR-01, FR-02]
- evidence: sillyspec-manager.ts conflictSnapshot 先例（按需 RPC 拉取）
- 故障面: 用户忘刷新看到旧快照——展示 fetched_at 时间戳缓解
- 退役判据: 若未来做快照增量缓存（多成员聚合视图），手动刷新可升级为缓存+手动强制刷新

## D-004@v1: 导入语义——复用平台登记建行，重名跳过
- type: boundary
- priority: P1
- status: accepted
- source: code
- question: 导入把本地条目变成什么？
- answer: 导入=调既有 create_repo 建平台登记行：projects 条目的 path 带入 rel_path（保持团队约定相对路径原样）；repos: 条目的绝对路径写入**当前用户**的 my_path（成员级语义天然对位）；与平台已有同名登记跳过（幂等，响应标 skipped）。
- normalized_requirement: 导入不新造数据模型；每条独立成败（imported/skipped/failed 三态逐条回报）。
- impacts: [FR-03]
- evidence: 既有 create_repo/upsert_my_path 语义复用

## D-005@v1: 快照不落库（实时取，只读）
- type: architecture
- priority: P1
- status: accepted
- source: code
- question: 快照要持久化吗？
- answer: 不落库。实时拉取即弃（对照视图是即时快照不是状态源）；与 sync_states（下行落盘状态）分离。
- normalized_requirement: 无新表；快照响应含 fetched_at 时间戳。
- impacts: [FR-01, design 数据模型节]
- evidence: conflictSnapshot 只读快照铁律先例（RPC 只读不写任何文件）
- 故障面: 无持久化即无历史——对照视图只有「当下」，回看历史需另行落库（v2 候选）
- 退役判据: 出现快照历史/审计需求时升表持久化（复用 sync_states 模式）


## D-006@v1: 归档期模块文档同步按先例自主推进
- type: boundary
- priority: P2
- status: accepted
- source: code
- question: 归档 Step2 模块文档同步挂起等确认时用户未答，如何处置？
- answer: 按上一变更 2026-10-10-workspec-maintenance 归档时用户明确「确认写入」的同款先例自主推进（同域同动作：三卡片各一句 bullet + _module-map 符号，MANUAL_NOTES 不碰）；非用户亲选，如实留痕。
- normalized_requirement: 同步内容同 module-impact v2 的三行 done 动作。
- impacts: [module-impact]
- evidence: 归档 wait 轮 AskUserQuestion 未答；先例 .sillyspec/changes/archive/2026-10-10-workspec-maintenance/decisions.md D-006 同款
