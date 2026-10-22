---
author: flow-machine-draft
created_at: 2026-10-22T11:17:23.094Z
---
# 提案书（Proposal）— 2026-10-22-file-changes-card-fix

## 动机

任务原话转写：文件变更卡采集与展示修复

动机与背景：生产会话 bbdbecc9（工作区 /mnt/e/...，WSL 慢盘，3 会话共用）27 条快照全部 partial/timeout（collect_ms 恒 1500），卡片只剩「工作区快照未完成」；同机 NTFS 工作区 42 条 ok，证明是慢盘硬超时。另经代码走读确认：文件清单仅取 git status（轮内已 commit 的改动完全不进卡片）、numstat 超时丢弃已拿到的 status 清单、未跟踪文件显示 +0−0、status 状态在视图模型被丢弃、改N次实为工具种数、notice 不显示精确 reason、共享工作区提示在 notice 态不显示。

成功标准：
- 轮内已提交（git commit）的文件必须出现在本轮文件变更卡中；文件清单来源为 git status ∪ git diff --name-status <baselineHead>，行数取 numstat
- 慢盘工作区（/mnt/ 等）不再固定超时：自适应/放大超时预算且可配置；numstat 超时仍保留已采集的 status/name-status 文件清单（行数显示破折号）
- 未跟踪新文件、删除文件、mtime 探测行有明确状态展示；删除行不可点击；改N次=真实编辑调用次数
- notice 按精确 reason（timeout/queue_overflow/无 reason）与采集耗时生成文案，notice 态也显示共享工作区提示
- daemon/前端定向测试全绿，既有卡片与快照契约零回归

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 轮内已提交（git commit）的文件必须出现在本轮文件变更卡中；文件清单来源为 git status ∪ git diff --name-status <baselineHead>，行数取 numstat
2. 慢盘工作区（/mnt/ 等）不再固定超时：自适应/放大超时预算且可配置；numstat 超时仍保留已采集的 status/name-status 文件清单（行数显示破折号）
3. 未跟踪新文件、删除文件、mtime 探测行有明确状态展示；删除行不可点击；改N次=真实编辑调用次数
4. notice 按精确 reason（timeout/queue_overflow/无 reason）与采集耗时生成文案，notice 态也显示共享工作区提示
5. daemon/前端定向测试全绿，既有卡片与快照契约零回归

## 成功标准（可验证）

1. 轮内已提交（git commit）的文件必须出现在本轮文件变更卡中；文件清单来源为 git status ∪ git diff --name-status <baselineHead>，行数取 numstat
2. 慢盘工作区（/mnt/ 等）不再固定超时：自适应/放大超时预算且可配置；numstat 超时仍保留已采集的 status/name-status 文件清单（行数显示破折号）
3. 未跟踪新文件、删除文件、mtime 探测行有明确状态展示；删除行不可点击；改N次=真实编辑调用次数
4. notice 按精确 reason（timeout/queue_overflow/无 reason）与采集耗时生成文案，notice 态也显示共享工作区提示
5. daemon/前端定向测试全绿，既有卡片与快照契约零回归
