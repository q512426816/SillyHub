---
author: flow-machine-draft
created_at: 2026-10-21T04:36:02.760Z
---
# 任务注册表（Tasks）— 2026-10-21-spec-conflict-autoheal

- [x] task-01: 同一工作区连续 2 次推送冲突（rebase 重试仍败）时 daemon 自动备份并删本地 manifest、立即走全量 tar 重推（本地为准），全程零人工
- [x] task-02: 自愈可 env 关闭（SILLYHUB_DAEMON_CONFLICT_AUTOHEAL=0），默认开启
- [x] task-03: 推送成功清自愈计数；全量重推仍失败按既有传输失败语义落 pending_push
- [x] task-04: event-loop 循环 abort 退出不再被 _fire 误记 loop_crashed
- [x] task-05: off 开关命中日志标明来源（env 或 flag）
