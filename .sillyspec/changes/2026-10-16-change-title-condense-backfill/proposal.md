---
author: flow-machine-draft
created_at: 2026-10-16T13:19:13.371Z
---
# 提案书（Proposal）— 2026-10-16-change-title-condense-backfill

## 动机

任务原话转写：变更中心标题提炼与存量回填
动机：变更中心完整变更标题恒为变更名兜底、轻量变更标题为50字截断长句，用户要求约20字可读短标题。平台侧做两件事：收养口对超长标题防御性提炼、存量行从description按同规则回填；提炼规则在自然标点处截断，目标20字、上限30字，无边界才硬截加省略号。
成功标准：
- title_norm 新增 condense_title 纯函数并在强/弱标点截断、上限30、硬截加省略号各形态有单测（用实证坏样本做用例）
- _ensure_change_row 收养口对超30字上行标题提炼后入库、不超30字原样收养，有单测
- 新增一次性回填脚本 backend/scripts/backfill_change_titles.py：默认 dry-run、--apply 落库、--workspace 可定向，title 为兜底形态或超30字的行从 description 回填，服务层有单测且幂等
- 本地开发库 dry-run 核对计数后 --apply，抽查回填结果为约20字短句

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. title_norm 新增 condense_title 纯函数并在强/弱标点截断、上限30、硬截加省略号各形态有单测（用实证坏样本做用例）
2. _ensure_change_row 收养口对超30字上行标题提炼后入库、不超30字原样收养，有单测
3. 新增一次性回填脚本 backend/scripts/backfill_change_titles.py：默认 dry-run、--apply 落库、--workspace 可定向，title 为兜底形态或超30字的行从 description 回填，服务层有单测且幂等
4. 本地开发库 dry-run 核对计数后 --apply，抽查回填结果为约20字短句

## 成功标准（可验证）

1. title_norm 新增 condense_title 纯函数并在强/弱标点截断、上限30、硬截加省略号各形态有单测（用实证坏样本做用例）
2. _ensure_change_row 收养口对超30字上行标题提炼后入库、不超30字原样收养，有单测
3. 新增一次性回填脚本 backend/scripts/backfill_change_titles.py：默认 dry-run、--apply 落库、--workspace 可定向，title 为兜底形态或超30字的行从 description 回填，服务层有单测且幂等
4. 本地开发库 dry-run 核对计数后 --apply，抽查回填结果为约20字短句
