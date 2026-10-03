---
author: flow-machine-draft
created_at: 2026-10-03T06:18:22.539Z
---
# 提案书（Proposal）— 2026-10-03-usage-backfill-script

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:769242580fd51433a142912695e6fd63741b3c175d5d75d1487183aea69b616f:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-usage-backfill-script 留痕重锚 -->
任务原话转写：历史变更的本地 CLI 用量不显示：2026-10-02 摄取功能上线前的存量上报无快照（624 条 zcode 日志仅 7 条有快照，173 个历史变更可回填），原设计「由下次上报自然补齐」对不再活跃的历史日志永不触发。用户要求历史数据也显示。历史日志文件仍在本地磁盘、daemon 解析器现成——新增一次性回填脚本 backend/scripts/backfill_agent_log_usage.py（dry-run/--apply 两段式，复用 AgentLogUsageIngestService._locate_row/_ingest_one 摄取链路，历史数据自动落 caliber-fix 新口径）。
成功标准：
- 候选筛选与聚合消费口径一致（白名单 format + 已关联会话 + 无快照幂等 + 无 runs 会话）
- dry-run 只打印影响计数不落库；--apply 逐条 RPC 解析覆盖写、末尾 commit、每 50 条进度回报
- 复用既有摄取方法（归一口径/全降级/幂等零重复实现）
- ruff 通过；服务器 dry-run 实测候选数与 DB 直查一致（173 变更口径）
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:a4b7435af199a713fe5058ca5d017c91159817907f04a069cca109dac80a3b9a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-usage-backfill-script 留痕重锚 -->
按成功标准机械推导，共 6 条验收面：
1. 候选筛选与聚合消费口径一致（白名单 format + 已关联会话 + 无快照幂等 + 无 runs 会话）
2. dry-run 只打印影响计数不落库
3. --apply 逐条 RPC 解析覆盖写、末尾 commit、每 50 条进度回报
4. 复用既有摄取方法（归一口径/全降级/幂等零重复实现）
5. ruff 通过
6. 服务器 dry-run 实测候选数与 DB 直查一致（173 变更口径）
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:a7d8ca94ce0a69b6222516c176c8e7cdc5036422b7b99b60cab33c053c571cc0:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-usage-backfill-script 留痕重锚 -->
1. 候选筛选与聚合消费口径一致（白名单 format + 已关联会话 + 无快照幂等 + 无 runs 会话）
2. dry-run 只打印影响计数不落库
3. --apply 逐条 RPC 解析覆盖写、末尾 commit、每 50 条进度回报
4. 复用既有摄取方法（归一口径/全降级/幂等零重复实现）
5. ruff 通过
6. 服务器 dry-run 实测候选数与 DB 直查一致（173 变更口径）
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
