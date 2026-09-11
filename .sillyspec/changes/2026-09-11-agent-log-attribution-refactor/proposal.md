---
author: qinyi
created_at: 2026-09-11 23:25:46
---
# 提案书（Proposal）

## 动机

本地 agent 日志上报链路（sillyspec CLI → POST /api/agent-logs → platform_agent_logs →
会话/变更/quicklog 视图）在多窗口并行 + daemon junction 共享留底的真实用法下，归属大面积
错配：未跑过 sillyspec 的对话窗口被标上变更、父子会话拆进不同变更、quick 日志落进变更会话、
hub 平台会话把本地无关日志整批挂走。两份实证（docs/sillyspec/agent-log-ctx-attribution-
mismatch.md、agent-log-hub-attribution-cross-session-contamination.md）指向同一根因：**归属
锚点是「检测时 cwd 活跃窗口」而非「会话身份 + 变更上下文」**。

## 关键问题

1. **ctx 抢标**：每次 `sillyspec run --change X` 给 cwd 下 15 分钟窗口内所有活跃日志文件打
   ctx=X（last-wins），多窗口并行互相覆盖；quick/change 双键并存与协议互斥承诺背离。
2. **hub 全量重推污染**：推送=共享留底 top-10 全量，daemon 派发的平台会话把留底里别人的
   条目连同归属一起挂走（pi 会话名下挂 zcode IDE 日志，e3d7ddfa/d4c29d95 实证）。
3. **平台归属缺乏语义**：hub 分支只做时间重叠过滤；ctx 分组按 harness|ctx 切桶且 change
   优先——同变更跨 harness 无法聚合，quick 会话建了也被掏空。

## 变更范围

- sillyspec 仓：agent-session-log.js 会话身份锚定（zcode 读 db.sqlite 父子链）+ 打标/推送
  收敛为 own 条目 + quick/change 双向互斥 + 协议文档更新；
- 本仓 backend：platform_sync 归属段重写为 ctx-owner 两级解析（links → 聚合键兜底 →
  find-or-create），分组 quick 优先；存量四条清理数据迁移（归属列/自动会话/两张 links 表）。

## 不在范围内（显式清单）

- 不做 M:N 归属链接表/行级多挂（D-005 否决）
- 不做 harness↔provider 一致性拦截（D-009 否决——跨 harness 同变更挂接是需求）
- 不改 daemon、不改 frontend（零文件改动，无 API schema 变化）
- 不动 liveness states 链路与日志内容解析

## 成功标准（可验证）

- 一个从未跑 sillyspec 的本地会话日志不再出现在任何平台会话/变更名下（FR-06）
- 平台 pi 会话干变更 X 时，本地 zcode 干 X 的日志挂进该会话；X 无主时自动建会话（FR-03）
- quick 执行的日志落在 quick 聚合会话并关联 quicklog，change run 不再漏进旧 quick 会话（FR-02）
- hub 会话只收到自己 agent（含子代理）产生的日志（FR-04）
- 存量错挂数据清零并靠重推重建（FR-05）
