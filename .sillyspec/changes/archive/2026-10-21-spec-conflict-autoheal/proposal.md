---
author: flow-machine-draft
created_at: 2026-10-21T04:36:02.759Z
---
# 提案书（Proposal）— 2026-10-21-spec-conflict-autoheal

## 动机

任务原话转写：spec推送冲突自动自愈与日志修整

动机：用户拍板「以本地为准」且要求部署即生效、零手工动作——现行 SpecPushConflict 升级人工裁决（删 manifest/resolve --keep-local）违反此诉求；另收口评审遗留两条 P3（event-loop abort 误报 loop_crashed、关闭日志未标来源）随本次一并修，凑一次 bundle 重打部署全量生效。

成功标准：
- 同一工作区连续 2 次推送冲突（rebase 重试仍败）时 daemon 自动备份并删本地 manifest、立即走全量 tar 重推（本地为准），全程零人工
- 自愈可 env 关闭（SILLYHUB_DAEMON_CONFLICT_AUTOHEAL=0），默认开启
- 推送成功清自愈计数；全量重推仍失败按既有传输失败语义落 pending_push
- event-loop 循环 abort 退出不再被 _fire 误记 loop_crashed
- off 开关命中日志标明来源（env 或 flag）

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 同一工作区连续 2 次推送冲突（rebase 重试仍败）时 daemon 自动备份并删本地 manifest、立即走全量 tar 重推（本地为准），全程零人工
2. 自愈可 env 关闭（SILLYHUB_DAEMON_CONFLICT_AUTOHEAL=0），默认开启
3. 推送成功清自愈计数；全量重推仍失败按既有传输失败语义落 pending_push
4. event-loop 循环 abort 退出不再被 _fire 误记 loop_crashed
5. off 开关命中日志标明来源（env 或 flag）

## 成功标准（可验证）

1. 同一工作区连续 2 次推送冲突（rebase 重试仍败）时 daemon 自动备份并删本地 manifest、立即走全量 tar 重推（本地为准），全程零人工
2. 自愈可 env 关闭（SILLYHUB_DAEMON_CONFLICT_AUTOHEAL=0），默认开启
3. 推送成功清自愈计数；全量重推仍失败按既有传输失败语义落 pending_push
4. event-loop 循环 abort 退出不再被 _fire 误记 loop_crashed
5. off 开关命中日志标明来源（env 或 flag）
