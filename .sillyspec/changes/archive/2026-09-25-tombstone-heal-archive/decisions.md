---
author: flow-machine-draft
created_at: 2026-09-25T05:10:58.695Z
---
# 决策记录（Decisions）— 2026-09-25-tombstone-heal-archive

## D-001@v1: 风险与死路（design 槽4 收割）
- 决策：最大风险：误复活真删除行——防线是判据只认「行 location=='deleted' 且载荷终态 'archived'」（真删除链本地 status='deleted' 不会再发 archived 终态；行缺失/兜底判据命中不建行）。放弃的方案：让 _apply_cli_tombstone 认 archived 置 location——与 D-002@v1 冲突（reparse 是 location owner，抢先置位会被回翻抖动），坑文档原提议已在 dfdeedf27 否决；本复活通道是拒收分支内的唯一例外写点且单向。
