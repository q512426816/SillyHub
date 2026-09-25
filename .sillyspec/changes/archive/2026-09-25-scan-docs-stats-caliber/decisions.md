---
author: flow-machine-draft
created_at: 2026-09-25T09:20:52.510Z
---
# 决策记录（Decisions）— 2026-09-25-scan-docs-stats-caliber

## D-001@v1: 风险与死路（design 槽4 收割）
- 决策：**最大风险**：`source_mtime` 在存量数据上可能为空（早期同步路径/本地 reparse 创建的行），若修改为「只认 source_mtime」会让这些行集体判陈旧（陈旧清单暴涨）。缓解：`_effective_mtime` 设计成 source_mtime 优先、**缺失回落 last_modified_at**，缺失行行为与修正前逐字一致；单测含「两列皆空 → 仍判陈旧（未知时间）」的对照行。
  **次生风险**：模块层实有分子变小（排除变更日志）会让某些工作区的模块覆盖率**下降**（例如 40/36 → 36/36），看起来像「指标退步」——这是把虚高纠正为真实值，需在汇报里说明口径变化。
  **试过但放弃的方案**：
  1. 在 `_registered_module_counts` 里反向把变更日志也算进 expected（即把分母一起虚增到 40）——把 bug 变成口径，且登记表里没有 changelog 条目，语义错。
  2. 改 `reparse` 让镜像文件的 mtime 等于源 mtime（写入侧 up-utime）——影响所有读 mtime 的消费面（含 change 卡片），面太大且与本次「读对列」的修法重叠；留作后续。
  3. 只改陈旧判定不改趋势/最近榜——四处口径不一致会让页面自相矛盾（同一文件「新鲜」却不在最近榜），必须四处同改。
