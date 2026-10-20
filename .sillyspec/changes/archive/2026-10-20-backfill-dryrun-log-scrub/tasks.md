---
author: flow-machine-draft
created_at: 2026-10-19T23:53:09.722Z
---
# 任务注册表（Tasks）— 2026-10-20-backfill-dryrun-log-scrub

- [x] task-01: scripts/backfill_commit_type.py 参数面翻方向（缺省 dry-run、`--apply` 落盘、`--apply` 必须带 `--yes` 否则退出码 2、移除 `--dry-run` 旗标、docstring 用法段同步）——写入逻辑零改动；sandbox 冒烟四步验证：裸跑零写 / `--apply` 无 `--yes` 退出码 2 / `--apply --yes` 按 dry-run 清单落盘 / 复跑全 unchanged
- [x] task-02: 移除 zcode-app-server-driver.ts:183-185 真机诊断 spawn 明文日志（保留脱敏 env 键日志）——grep 复核源内无 `[zcode-driver] spawn:` cwd 明文残留；跑 sillyhub-daemon zcode driver 既有测试全绿
