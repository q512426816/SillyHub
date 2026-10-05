# observation-events-v3-r16sf 废弃留档（被 r18-full + 观测卡移除裁决取代）

- 日期：2026-10-02
- 处置：`sillyspec change-delete --confirm`（DB status=deleted，目录移除，git 历史可回溯）
- 用户裁决：废弃（AskUserQuestion 2026-10-02，三选一：废弃/重新规划/保留）

## 为何废弃

r16sf（2026-09-25 规划）针对 v2 批量通道的五缺口做原地演进，但其设计基线在
2026-09-26~28 被三个已落地决策整体取代：

| v3 五缺口 | 现状（2026-10-02 主仓） |
|---|---|
| ① 批量上限 200 偏小 | 已消解：r18-full 将端点重写为**单事件推送**（`push_change_event`，窗口 5000、响应 `{stored,deduplicated,truncated}`），无批量端点 |
| ② since 基于 ts 乱序丢 | 后端语义未变（GET since=ts 字典序），但该端点已无 UI 消费方 |
| ③ 读缺省无截断标记 | 同②，端点仅剩 CLI/调试面 |
| ④ detail 2000 截断 | 已解决：列已 Text、落库不截断（迁移链 9adc7bf4d 修复对齐） |
| ⑤ 前端无告警一次决策 | 已被产品裁决否决：2026-09-28-drop-observation-card 将观测卡从详情页整体移除，事件显示由主栏时间线卡独家承担（走 `/changes/{cid}/timeline` 聚合端点） |

CLI watcher 已按 r18-full 契约单条上行（sillyspec 仓 src/watcher.js:774 注释）。
plan 所引符号（`append_events`/`ChangeEventPushRequest.events` 列表/`{accepted,deduplicated}` 响应）
在当前主仓已不存在，按原计划执行不可行；剩余缺口（②③）无消费方，价值不足。

## 附带发现：r18-full 是幽灵归档

r18-full（2026-09-26-change-events-r18-full）代码已进 main（router/schema/service 带
其 task 注释），但其归档提交 `516cf7926` 不在 main 历史、`.sillyspec/changes/archive/`
下也无其变更包——并行会话收尾时归档丢失。若需补档，可从 git 历史（`git log --all
--grep=r18-full`）与 304eba982/83bde5d52 的夹带修复提交重建四件套。

## 教训（流程改进点）

并行会话在同一模块域开工前，应先核对 `.sillyspec/changes/` 活跃变更是否已触碰
同组端点/组件（本例 r16sf 规划于 9-25，r18-full 于次日重写同一通道，互不知情）。
平台侧「进行中」列表 + daemon 投影可作为开工前检查面。

## 处置记录（2026-10-03）

定性：本文件是**已执行完毕的废弃留档**（change-delete 已跑、用户三选一裁决已记、五缺口
去向逐条对账完成）——非活跃缺陷，按处置完成归档。

**附带发现处置**：r18-full 幽灵归档（代码进 main、归档件丢失）维持「按需补档」不主动
重建——重建材料与路径已在本文件记录（git log --all --grep=r18-full + 夹带修复提交），
真需要审计件时按此操作；教训条目（并行会话开工前核对活跃变更触达面）已在平台「进行中」
列表 + daemon 投影面具备检查条件，属流程纪律非代码缺口。归档。
