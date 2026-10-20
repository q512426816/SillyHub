---
author: flow-machine-draft
created_at: 2026-10-19T23:53:09.722Z
---
# 提案书（Proposal）— 2026-10-20-backfill-dryrun-log-scrub

## 动机

任务原话转写：回填脚本改缺省dry-run并移除诊断日志

动机与背景：24 小时风险审查（2026-10-20 会话）发现两条高置信中危：① scripts/backfill_commit_type.py 裸跑即落盘改写各变更目录 flow-state.yaml 且无确认门，与同仓 backend/scripts/backfill_change_titles.py 的缺省 dry-run + --yes 口径相反；② sillyhub-daemon/src/interactive/zcode-app-server-driver.ts:185 真机诊断 console.log 残留，每次 zcode 会话 spawn 把用户 cwd 明文记入 daemon 日志（187 行 env 值已走 redactEnvValueForLog 脱敏，185 行未脱敏）。

成功标准：
- python scripts/backfill_commit_type.py 裸跑零落盘（输出计划写入与汇总）；--apply 不带 --yes 拒绝执行退出码 2；--apply --yes 落盘行为与原执行路径一致（幂等 unchanged 不写、CRLF 保留）
- zcode-app-server-driver.ts 不再输出含 cwd 的 spawn 明文日志；daemon 既有 zcode 相关测试全绿

## 变更范围

按成功标准机械推导，共 2 条验收面：
1. python scripts/backfill_commit_type.py 裸跑零落盘（输出计划写入与汇总）；--apply 不带 --yes 拒绝执行退出码 2；--apply --yes 落盘行为与原执行路径一致（幂等 unchanged 不写、CRLF 保留）
2. zcode-app-server-driver.ts 不再输出含 cwd 的 spawn 明文日志；daemon 既有 zcode 相关测试全绿

## 成功标准（可验证）

1. python scripts/backfill_commit_type.py 裸跑零落盘（输出计划写入与汇总）；--apply 不带 --yes 拒绝执行退出码 2；--apply --yes 落盘行为与原执行路径一致（幂等 unchanged 不写、CRLF 保留）
2. zcode-app-server-driver.ts 不再输出含 cwd 的 spawn 明文日志；daemon 既有 zcode 相关测试全绿
