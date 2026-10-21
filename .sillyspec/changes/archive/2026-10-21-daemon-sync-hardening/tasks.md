---
author: flow-machine-draft
created_at: 2026-10-21T03:38:36.354Z
---
# 任务注册表（Tasks）— 2026-10-21-daemon-sync-hardening

- [x] task-01: daemon spec 自动推送支持整机关闭（env）与按工作区关闭（flag 文件），关闭态为 no-op（返回 null、不动 pending_push），knowledge hits 上行不受影响
- [x] task-02: status 采集超时支持 SILLYHUB_DAEMON_STATUS_TIMEOUT_MS env 覆盖
- [x] task-03: status 采集对连续失败目标自动退避降频，成功即复位
- [x] task-04: 登记根带 .git/sillyspec-crossrepo.json 的工作区采集自动跳过并一次性提示
- [x] task-05: hub-client 全部 fetch 带显式 AbortSignal 超时
- [x] task-06: daemon 具备事件循环 lag 周期监控，超阈值留 warn 证据
