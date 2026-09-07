---
author: qinyi
created_at: 2026-09-07 10:35:00
---

# 需求规格（Requirements）— Agent 会话活性状态推导

## 角色

| 角色 | 说明 |
|---|---|
| 用户（多会话管理者） | 工作台/会话视图一眼看出每个 agent 会话死活，收到 blocked 提醒 |
| 编排 agent | 派发 worker 后经 list_workers 知情决策（升级/等待而非盲杀） |
| daemon | 推导主体：自发现 + tail + 上报 |
| backend | 状态落库、通知、liveness 字段供给 |

## 功能需求

### FR-01: daemon 活性推导器（tailer + deriver 注册表）
覆盖决策：D-003@v1
Given 已发现的会话日志（watch list 内，format 已知）
When tailer 周期（10s）对每路径 offset 差量续读尾部
Then 经 format→deriver 注册表推导出 5 态之一 + 证据摘要（zcode：completedAt 新鲜/toolCalls 未配对→working；codex：task_complete→idle、function_call 配对差分→working；claude：tool_use 未配对→working、纯文本→idle）
Given deriver 抛错或行解析失败
When 本轮推导
Then 落 unknown 并保留登记，下一轮重试（R-02 fail-open，不影响登记与对话视图链路）
Given 日志文件 size 变小或消失（轮转/上下文压缩，E-03 实证常态）
When 下一周期
Then offset 重置 + 证据标记 reset；消失超 15min 窗 → ended 并移出 watch（重扫兜底可重新 join）
Given watch 数超 16 或单轮读取超 4MB
When 周期执行
Then 按 last_seen_at 新者优先挤出；超预算部分下轮再读，不拖垮周期

### FR-02: daemon 自发现通道（双源汇聚）
覆盖决策：D-003@v1
Given daemon spawn 记录 / sessions.json 重启恢复 / 15min 窗口重扫兜底（三层数据源）
When 定位会话日志（claude/pi 直算路径先行；codex/zcode 窄扫+标记匹配）
Then 与 SillySpec 登记源按 (workspace, log_path) 汇聚去重进 watch list；裸 agent 会话（全程不调 sillyspec）同样被发现
Given 守卫铁律 R-01
When 无日志正向等待人类证据
Then 绝不以"长时间没动静"推断 blocked（只能落 working/idle/ended/unknown）

### FR-03: backend 状态落库与上报端点
覆盖决策：D-001@v1
Given daemon 鉴权通道（与 /api/agent-logs 同分流规则）
When POST /api/agent-logs/states 批量上报 (log_path, state, evidence, derived_at, last_event_at?, 元信息?)
Then platform_agent_logs 行 upsert（state/state_derived_at/state_evidence/last_event_at 四列）；行不存在时按元信息 create（origin=liveness-discovered），后续 CLI 登记融合不覆盖状态列
When GET /agent-logs 列表
Then 响应透传状态四字段；旧行无状态显示 unknown（零迁移兼容）

### FR-04: blocked 主动通知（第一方事件汇聚 + E-01 门控）
覆盖决策：D-002@v1, D-003@v1
Given 会话进入 blocked（主源=第一方 PERMISSION_REQUEST 事件，D-012 优先级；日志推导仅裸 claude CLI 候选）
When blocked 持续 ≥120s 未消解
Then Notification type=agent_blocked（dedupe_key=(session, blocked 段序号) 同段只发一次；站内 + Redis 实时推）；与既有 5min auto-deny timer 同源分级（120s 提醒 / 5min 拒绝照旧）
Given E-01 实证（裸 claude transcript 是否记 permission 等待）
When 证伪
Then 日志推导侧 blocked 关闭并如实定稿（托管会话不受影响）；通过则实现 claude deriver blocked 分支

### FR-05: 前端展示（D-004@v1 两层）
覆盖决策：D-001@v1, D-004@v1
Given 会话列表 / 工作台首页 / 会话详情 agent 日志面板
When 状态四字段可用（api-types 经 pnpm gen:types 重新生成）
Then ①会话列表每行行尾 ~18px 状态小灯（五态色 + 工作/阻塞呼吸闪烁，不新增列不改布局），悬停弹小卡（状态全名/静默时长=now-last_event_at/关联 ctx/证据摘要/推导时间）；②工作台首页新「Agent 状态总览」卡片（按状态分组计数，"在等人"组列会话名+等待时长+跳转入口）；③会话详情 agent 日志面板逐行状态徽章+推导时间；④idle 未读小红点（working/blocked→idle 转移边+已读状态）；⑤agent_blocked 通知渲染与跳转

### FR-06: 编排知情决策（P1e）
覆盖决策：D-001@v1
Given worker 处于 running
When 编排 agent 轮询 list_workers
Then 返回值附 liveness{state, evidence, derived_at}（daemon 推导经 mission 状态链路汇入；链路过重时降级为 backend 直查 platform_agent_logs 最新状态，R-03）
Given 派发模板（sillyspec 仓）决策规则
When worker blocked 超阈值 / working 久无终态
Then blocked→升级给人（通知+待办）不 kill（D-010 绝不自动批）；working→按既有超时再等不抢跑 kill

## 非功能需求

- 兼容性：CLI 上报契约零变更；旧落库行/旧 CLI 天然兼容（无状态列显示 unknown）；既有登记与对话视图链路零回归
- 可回退：四列可空迁移，回滚迁移即恢复；tailer 独立 try 包裹可整体停用
- 可测试：每 deriver fixture 单测；tailer 轮转/预算/fail-open 单测；R-01/R-02 回归项；双端 fixture 对拍（P2 时）
- 安全：日志内容不出本机（上报仅枚举级数据）；blocked 只升级不自动批

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01~FR-06 | 范围=P1 全量 a-e |
| D-002@v1 | FR-04 | E-01 纳入本期，证伪即定稿关闭 |
| D-003@v1 | FR-01, FR-02, FR-04 | 方案 1：daemon 自发现+日志推导+第一方汇聚（D-012 优先级） |
| D-004@v1 | FR-05 | 状态展示两层：会话列表小灯+悬浮卡（不新增列），完整总览放工作台首页卡片 |
