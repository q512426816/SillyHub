# 设计：共识收口超时活动感知续期 + 状态卡名单/原因修复

- change: 2026-09-13-consensus-timeout-activity-aware
- date: 2026-09-13
- created_at: 2026-09-13 14:58:30
- status: draft
- author: qinyi
- risk_level: integration-critical

## 1. 问题与证据

### 1.1 现场（用户阿里云环境 2026-09-13，群【PPDMQ平台】）

```
13:29  管理员：@SillyHuber @SillySpecer 你们都看看还有什么可以归档的变更
       [状态卡] 汇总收口 · 已中止（aborted）——汇总人 SillyHuber
       卡面成员名单：SillySpecer、SillySpecer、SillySpecer、Claude Code（异常）
13:45  SillySpecer 回复进群（16 分钟后才完成——检查归档属长任务）
```

### 1.2 机制拆解（三缺陷）

1. **超时判定只看墙钟**：`consensus_sweep_once`（backend/app/modules/daemon/group/service/consensus.py:590）扫描谓词
   `status=open AND deadline_at < now`，死线=触发+群 `consensus_timeout_seconds`
   （最小 60s）。死线到点时**不看任何成员活动信号**——正在生成/排队中的长任务
   被一刀切。本现场：60s+ 窗口内零 delivered → 任务 aborted（「无人响应无从
   收口」路径），汇总从未发生。
2. **终态不可逆吞掉迟到意见**：`mark_consensus_member_outcome`（backend/app/modules/daemon/group/service/consensus.py:380?）
   对非 open 任务「仅登记不动状态机」——13:45 迟到的意见悄悄进 members JSON，
   不触发任何汇总也不提示用户。汇总人自身无回复（触发失败/迟到）在卡面完全
   不可见（用户追问「汇总人怎么不回复我」即此）。
3. **卡面名单异常**：前端 `ConsensusCardData.members`（frontend/src/components/group-chat/group-chat-panel.tsx:517）
   直接渲染后端 `consensus_card.members` 快照——4 人名单（SillySpecer×3 +
   Claude Code）来自任务创建时的 collaborators 集合，与「仅 @ 两个名字」的
   预期不符。本地代码 `@ 解析`按 id 去重（backend/app/modules/daemon/group/service/mentions.py:112 `explicit: dict[uuid,
   Member]`）且 `by_name` 同名覆盖只留一行——理论 members 应为 2 人。真根因
   需阿里云数据佐证（群成员表同名多行/部署版本差异/消息实际内容），本地先做
   防御性修复。

## 2. 决策表（§2.0）

| # | 决策点 | 选择 | 理由 |
|---|---|---|---|
| D-1 | 活动感知实现路径 | **A 巡检侧**（sweeper 查活动信号） | 用户语义「看 agent 是否在活动」正解；改动集中 consensus.py 一处，不侵入 agent 执行链。B 成员侧心跳需跨模块挂钩子（run_sync 执行链）风险大；C 宽限期本质仍墙钟，真死的白等 |
| D-2 | 活动信号口径 | 影子最新 run status ∈ {running, queued} **或** 该 run 时间线最近 2 分钟有新行 | 排队=机器在线只是忙（也算活，否则大任务排队中被误杀）；时间线新行=流式输出中。信号全来自现有表（agent_runs/agent_run_logs） |
| D-3 | 续期步进与上限 | 每次顺延 60s；硬上限 = task.created_at + 群 timeout + 600s（10 分钟累计） | 60s 步进与 30s 巡检节奏匹配；上限用 created_at+timeout+600 计算（group 可查、无需新列、幂等） |
| D-4 | 名单修复路径 | 双轨：本地防御（快照按成员 ID 去重 + 同名成员确定性选择 + 卡面名字标注）+ 调查项（阿里云数据核对留 verify 阶段/部署后） | 真根因在远端数据，本地无法复现；防御修复保证任何数据形态下卡面不再重复 |
| D-5 | 迟到意见/aborted 复活 | **不复活**（范围外） | 终态不可逆是崩溃恢复的基石语义；复活引入复杂竞态。活动感知续期从源头防「早死」，迟到的极端残留（硬上限后才完成）属可接受损失，卡面原因文案可见 |
| D-6 | 续期可见性 | 续期时更新状态卡 content 追加「仍在工作，已延长等待」+ updated_at | 用户能区分「卡死等待」与「正常延长」 |

## 3. 方案设计

### §3.1 sweeper 活动感知续期（consensus.py）

`consensus_sweep_once` 扫描到 `deadline_at < now` 的 open 任务后、进入收口前，
插入续期判定：

```
hard_cap = task.created_at + group.consensus_timeout_seconds + 600s
if now < hard_cap and 任一 pending 成员 is_active(member):
    task.deadline_at = min(now + 60s, hard_cap)
    write_consensus_card(phase=collecting, content 追加「仍在工作，已延长等待」)
    commit; continue  # 本轮不收口
# else 走原收口路径（有 delivered → inject_converge_directive(timed_out=True)；
#                      零 delivered → aborted + 原因文案）
```

`is_active(member)`（新增 helper，模块内私有）：
1. 查 member.shadow_session_id 的**最新一条** agent_runs（按 created_at/id 倒序
   取一）：`status IN ('running', 'queued', 'pending')` → 活动；
2. 或该 run 的时间线 `max(agent_run_logs.timestamp) >= now - 120s` → 活动；
3. run 不存在（触发从未成功）/ 查询异常 → 不活动（fail-closed，防 sweeper
   单任务异常连坐——沿用现有 per-task try/except 吞错语义）。

成员集合=members JSONB 中 `state == pending` 的行（failed/timeout/已终态不查）。

查询预算：每 open+过期任务 ≤ (#pending) 次索引查询（agent_runs 按
agent_session_id 已有索引；agent_run_logs 按 run_id 已有索引）；sweeper 30s
一轮、活跃任务量级个位数——可忽略。

### §3.2 名单防御修复（consensus.py + mentions.py）

1. **快照去重**：`create_consensus_task` 构造 members 明细时按 member id 去重
   （dict 保序），任何上游集合形态重复行不进快照；
2. **同名成员确定性**：`_parse_group_mentions` 的 `by_name` 同名覆盖改为确定性
   选择——同 display_name 多行时取 joined_at 最早（稳定、与 broadcast 成员表
   序一致）；被 @ 解析跳过的同名其余行不触发（避免一台机器干三份活）；
3. **卡面标注**：`_card_content` 成员段遇同名成员（不同 id 同名）显示
   `名字(前6位id)` 区分；正常场景零变化。

### §3.3 卡面原因文案（consensus.py `_card_content` / `write_consensus_card`）

终态卡 content 从「汇总收口 · 已中止」扩展为带原因摘要（截断 200 字符内）：

- aborted：「已中止——{逐成员结局}」：`SillyHuber 触发失败(机器不可用)；
  SillySpecer 超时未响应`；
- timeout：「超时收口——已收 {n} 份意见，{未响应名单} 未响应」；
- coordinator 自身结局始终在卡面（汇总人=第一个被 @ 成员，其触发结果与
  collaborator 同源记录——触发失败/超时/已交卷）。

成员结局数据源：members JSONB 的 state + 触发侧 `triggered` 结果（failed 时
已有 error 信息收集在发送响应，任务侧重落 members[].error 摘要——发送侧
`_trigger_member_isolated` 失败路径补记 `state=failed, error=<一句话>`）。

### §3.4 不改的边界

- 不动 `mark_consensus_member_outcome` 终态不可逆语义（D-5）；
- 不动消息投影/影子会话/daemon 触发链（2026-09-12 锁降级语义保持）；
- 不新增迁移（无 schema 变更——续期复用 deadline_at，上限用 created_at 推算）。

## 4. 验收标准

- AC-1：死线到点且 pending 成员有活动（run 运行中/时间线 2min 内有新行）→
  任务不收口，deadline 顺延，卡面出现「仍在工作，已延长等待」；
- AC-2：续期累计达硬上限（原始死线+10min）后仍在活动 → 不再顺延，走原收口
  （有意见→timeout 收口注入；零意见→aborted+原因文案）；
- AC-3：全员无活动（run 终态且时间线 2min 无新行）→ 立即原路径收口，无额外
  等待（回归 2026-09-10 收口语义）；
- AC-4：members 快照无重复 id；同名成员 @ 解析确定性命中一行；卡面同名显示
  可区分；
- AC-5：aborted/timeout 卡面含逐成员结局原因（含汇总人自身状态）；200 字符
  截断；
- AC-6：真实集成复验（uvicorn+PG）：长任务成员（>60s 才回复）在续期下任务
  存活至意见交回并完成汇总收口；无活动场景回归原收口时序。

## 5. 生命周期契约（本变更涉及——续期事件新增，其余契约保持）

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 死线续期 | consensus_sweep_once | 任务行+状态卡 | member 活动信号查询结果、hard_cap | open→open（deadline_at 顺延；卡面 collecting+延长提示） |
| 硬上限到顶收口 | consensus_sweep_once | coordinator 影子/任务行 | delivered 集合、未响应名单 | open→timeout（有意见）/aborted（零意见） |
| 无活动收口 | consensus_sweep_once | 同上 | 同上 | 同上（回归原契约，无额外等待） |
| 成员交卷 | mark_consensus_member_outcome | 任务行+状态卡 | opinion、delivered_at | pending→delivered；全员终态时 open→closing（不变） |
| 迟到意见登记 | mark_consensus_member_outcome | 任务行 | opinion | 终态仅补登记不动状态机（D-5 保持） |
| 触发失败落快照 | 发送侧触发循环 | 任务行 | error 摘要 | pending→failed（新增 FR-5 落地路径） |

## 6. 文件变更清单

| 文件 | 变更 |
|---|---|
| backend/app/modules/daemon/group/service/consensus.py | sweeper 续期判定+is_active helper+卡片文案+快照去重 |
| backend/app/modules/daemon/group/service/mentions.py | 同名成员确定性选择（joined_at 最早） |
| backend/app/modules/daemon/group/service/messages.py | 触发失败路径补记 error 摘要到任务快照 |
| NEW:backend/app/modules/daemon/tests/test_group_consensus_activity.py | 新增：续期/硬上限/无活动/去重/文案用例 |

## 7. 风险

- 活动信号误判（agent 卡死但 run 状态残留 running）→ 硬上限 10min 兜底，
  最坏多等 10 分钟（可接受；比早杀汇总丢失轻）；
- 阿里云名单真根因未定（数据 vs 版本）→ D-4 双轨，防御修复保底 + verify
  阶段部署后核对；
- sweeper 单轮变慢（活动查询）→ 查询全索引命中+量级个位数，可忽略；
  per-task 异常吞错不连坐（既有语义）。

## 8. 自审

- 硬上限计算依赖 group.consensus_timeout_seconds 可查：群存活场景成立；群解散走既有 aborted 分支不进续期——安全；
- is_active 查「成员最新 run」为成员级信号（非本任务 run）：与用户「agent 是否还在活动」语义一致；他任务占用导致的误续期由 10min 硬上限兑底；
- 续期与 2026-09-12 FK 降级路径无冲突：降级时 consensus_task=None 不涉快照/续期；
- 无迁移（deadline_at 复用+created_at 推算）；无前端改动（卡面数据后端生成）；
- 名单真根因在远端数据，本地防御修复+部署后核对（D-4 双轨诚实）。
