---
author: flow-machine-draft
created_at: 2026-10-22T12:10:54.410Z
---
# 决策记录（Decisions）— 2026-10-22-file-changes-card-fix

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：慢盘上从 2 条 git 命令增至 3 条，首轮仍可能超时；但 `/mnt/` 基础预算提升 + 超时后自动升级 + 超时保留清单，使「超时后整卡空白」不再发生。另一个风险是「本轮改动」口径扩大：轮内 commit 的文件现在会出现，卡片数字可能比以前大——这是修复目标（以前漏报），需在发布说明中明确。 放弃方案 A：只调大 timeout——不解决轮内 commit 漏报与 numstat 超时丢清单。 放弃方案 B：只用 `git diff --name-status` 不跑 numstat——行数全变破折号，信息退化。 放弃方案 C：忽略文件读到真实行数——`/mnt/e` 上读文件比 git 更慢，且 untracked 可能很大；保持诚实破折号。 放弃方案 D：给卡片加「重新采集」按钮——需要新增 daemon RPC 与平台端点，超出本次修复面，留作后续。
