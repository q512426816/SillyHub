---
author: flow-machine-draft
created_at: 2026-10-20T00:11:44.197Z
---
# 决策记录（Decisions）— 2026-10-20-backfill-dryrun-log-scrub

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：已习惯旧口径（裸跑即写）的使用者肌肉记忆被翻转——首次 `--apply` 忘带 `--yes` 得到退出码 2。缓解：docstring 用法段与 `--yes` 报错信息都给出明确指引；且 261a33367 提交信息记载本仓已回填完毕（复跑应全 unchanged），日常无人需要再跑 `--apply`。 试过但放弃的方案：① 交互式确认提示（裸跑问 y/N）——破坏可脚本化性，CI/批处理无法应答，flag 门（`--yes`）是 backfill_change_titles.py 已验证先例；② 连同 :187 env 键日志一并删除——该行已脱敏且承载 provider 路由排障信息，删除超出审查发现的事实面。
