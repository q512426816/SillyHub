---
author: flow-machine-draft
created_at: 2026-10-16T13:19:13.371Z
---
# 任务注册表（Tasks）— 2026-10-16-change-title-condense-backfill

- [x] task-01: title_norm 新增 condense_title 纯函数并在强/弱标点截断、上限30、硬截加省略号各形态有单测（用实证坏样本做用例）
- [x] task-02: _ensure_change_row 收养口对超30字上行标题提炼后入库、不超30字原样收养，有单测
- [x] task-03: 新增一次性回填脚本 backend/scripts/backfill_change_titles.py：默认 dry-run、--apply 落库、--workspace 可定向，title 为兜底形态或超30字的行从 description 回填，服务层有单测且幂等
- [x] task-04: 本地开发库 dry-run 核对计数后 --apply，抽查回填结果为约20字短句
- [x] task-05: 提炼带宽按用户口径调整为 10-30 必须带（8~10 仅兜底）；强制 agent 命名（10-30 字）要求记录到 docs/sillyspec/change-title-not-readable.md（工具侧改进清单）
- [x] task-06: 后端 PATCH /changes/{cid}/title 改名端点——三元组权限（owner OR CHANGE_ARCHIVE）+ 10-30 校验 + rename 事件 + 单测
- [x] task-07: 前端详情页改名入口（权限可见 + 带宽校验 + 保存刷新）+ pnpm gen:types 前端/daemon 双跑
