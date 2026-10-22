---
author: flow-machine-draft
created_at: 2026-10-21T03:38:36.353Z
---
# 提案书（Proposal）— 2026-10-21-daemon-sync-hardening

## 动机

任务原话转写：执行端同步加固与状态采集治理

动机：2026-10-21 实测 daemon 宿主冻结约 5 分钟致任务中断（daemon_interrupted）且无现场证据可查；另有工作区 sillyspec status 每分钟 exit 2 刷屏、/mnt/e 采集 30s 超时；daemon 自动同步与 CLI platform sync 双写者致 SpecPushConflict 反复（runbook 钉死根因）。用户已拍板：A 平台侧加固、C 由 agent 酌情处置、单写者优先 CLI。

成功标准：
- daemon spec 自动推送支持整机关闭（env）与按工作区关闭（flag 文件），关闭态为 no-op（返回 null、不动 pending_push），knowledge hits 上行不受影响
- status 采集超时支持 SILLYHUB_DAEMON_STATUS_TIMEOUT_MS env 覆盖
- status 采集对连续失败目标自动退避降频，成功即复位
- 登记根带 .git/sillyspec-crossrepo.json 的工作区采集自动跳过并一次性提示
- hub-client 全部 fetch 带显式 AbortSignal 超时
- daemon 具备事件循环 lag 周期监控，超阈值留 warn 证据

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. daemon spec 自动推送支持整机关闭（env）与按工作区关闭（flag 文件），关闭态为 no-op（返回 null、不动 pending_push），knowledge hits 上行不受影响
2. status 采集超时支持 SILLYHUB_DAEMON_STATUS_TIMEOUT_MS env 覆盖
3. status 采集对连续失败目标自动退避降频，成功即复位
4. 登记根带 .git/sillyspec-crossrepo.json 的工作区采集自动跳过并一次性提示
5. hub-client 全部 fetch 带显式 AbortSignal 超时
6. daemon 具备事件循环 lag 周期监控，超阈值留 warn 证据

## 成功标准（可验证）

1. daemon spec 自动推送支持整机关闭（env）与按工作区关闭（flag 文件），关闭态为 no-op（返回 null、不动 pending_push），knowledge hits 上行不受影响
2. status 采集超时支持 SILLYHUB_DAEMON_STATUS_TIMEOUT_MS env 覆盖
3. status 采集对连续失败目标自动退避降频，成功即复位
4. 登记根带 .git/sillyspec-crossrepo.json 的工作区采集自动跳过并一次性提示
5. hub-client 全部 fetch 带显式 AbortSignal 超时
6. daemon 具备事件循环 lag 周期监控，超阈值留 warn 证据
