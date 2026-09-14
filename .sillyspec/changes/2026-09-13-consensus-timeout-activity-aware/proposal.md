# 提案：共识收口超时活动感知续期 + 状态卡名单/原因修复

- change: 2026-09-13-consensus-timeout-activity-aware
- date: 2026-09-13
- created_at: 2026-09-13 14:58:30
- author: qinyi

## 问题

用户阿里云环境（群【PPDMQ平台】2026-09-13 13:29）@ 两个 agent 发起汇总收口，
任务在固定死线（60s+）到达时因零意见被**中止**——被 @ 的 agent 实际在干长活
（13:45 才完成回复），迟到意见被终态语义吞掉，汇总从未发生。同时状态卡成员
名单异常（SillySpecer×3 + Claude Code，与仅 @ 两人预期不符）且终态卡无原因
说明（「汇总人怎么不回复」不可见）。

根因（详见 design.md §1.2）：
1. `consensus_sweep_once` 超时判定只看墙钟（`deadline_at < now`），不看成员
   活动信号；
2. 终态不可逆语义下迟到意见仅登记不救活、卡面不可见；
3. 名单异常真根因需远端数据佐证，本地缺防御。

## 方案（用户选定：方案 A·巡检侧活动感知）

死线到点时巡检查未交卷成员的活动信号（影子最新 run 运行中/排队中，或时间线
最近 2 分钟有新输出）→ 有活动则死线顺延 60s（硬上限=原始死线+10 分钟，超限
走原收口）；全员无活动走原收口/中止。配套：members 快照按 ID 去重+同名确定性
选择+卡面同名标注；终态卡补逐成员结局原因（含汇总人自身状态）。终态复活不
做（范围外，D-5）。

## 影响面

- backend/app/modules/daemon/group/service/consensus.py（sweeper 续期+is_active
  helper+卡片文案+快照去重）
- backend/app/modules/daemon/group/service/mentions.py（同名成员确定性选择）
- backend/app/modules/daemon/group/service/messages.py（触发失败路径补记
  error 摘要到任务快照）
- 新增/扩展测试（daemon tests 共识收口用例）

无迁移、无前端改动（卡面数据后端生成）、不触碰 agent 执行链与 2026-09-12
锁降级语义。

## 验收

见 requirements.md FR/AC（含真实集成复验：长任务成员续期存活至收口完成）。

## 不在范围内（Non-Goals）

- 终态复活/迟到意见补偿（D-5 明确范围外）；
- agent 执行链改造（方案 B 否决）；
- 前端渲染改动（卡面数据后端生成，前端零改动兼容）；
- 阶里云名单真数据核对（部署新版后另行为之，本地仅防御修复）。
