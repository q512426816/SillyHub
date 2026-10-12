---
author: flow-machine-draft
created_at: 2026-10-12T07:30:00.000Z
---
# 设计记录（Design Record）— 2026-10-12-backfill-run-change-context

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

问题：2026-10-12-run-level-change-attribution 上线后，存量会话的 run 无 change_id 锚，变更列表执行用量仍按「无锚 run 经会话链接摊派」旧口径显示会话总和；用户要求把指定工作区（4e9eb05b…）的存量数据按新口径刷新。

方案：一次性运维回填（脚本 + 可测服务层）。服务层 `ChangeContextBackfillService`（change 模块）按会话重放绑定命令游标——run 时间序逐个「先打锚（仅 NULL 且游标非空）再推进游标（本 run sillyspec 命令，最后一条生效）」，与线上 run_sync 通道「命令在本轮 submit 时写上下文、下一轮 inject 才继承」的时序语义逐点对齐；结束时把游标终值写会话 current_change_id。脚本 scripts/backfill_run_change_context.py 默认 dry-run（单事务回滚），--apply 才提交，--workspace 收窄范围；会话选取限定 change_session_links 有链接者。为什么不用清库重置：该工作区是真实 dogfooding 数据，回填保数据且幂等可审。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增 `app/modules/change/backfill_service.py::ChangeContextBackfillService(db)`：`backfill_workspace(workspace_id) -> BackfillStats`、`backfill_session(session_id) -> BackfillStats`；`BackfillStats` dataclass（runs_stamped / runs_already_anchored / commands_parsed / commands_skipped_unknown_key / cursor_written / unknown_keys）。无 API/DTO 变化（不需 gen:types），无既有函数签名改动。
- 新增 `backend/scripts/backfill_run_change_context.py`：argparse（--apply / --workspace <uuid> 可多次 / --yes / 缺省全工作区），dry-run 默认（rollback），输出每会话+工作区小计+总计计数；--apply 无 --workspace（全工作区）时必须 --yes 显式确认；引擎取 get_settings().database_url 同 reset 脚本先例。
- 不改 usage_service / binding / inject——回填只写数据，聚合逻辑复用上一变更的 D-002@v2 口径。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立：回填是离线一次性重放，按 created_at,id 确定序处理，不与线上写并发竞争（见问 2）。运行时若回填后仍有旧 run 消息迟到提交（submit 重放写 current_change_id），影响与上一变更披露一致（≤短窗错锚、后续命令自愈），回填不放大该面。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

回填必须在平台低峰手动执行（文档注明），单事务逐会话处理。写集与线上在 run 锚面不相交（回填只写 NULL，运行时 inject 只读不写 run.change_id，派发锚另列）——run 锚无 lost-update 面；但 agent_sessions.current_change_id 是**同列双写点**（submit_commit 运行时回写 ∥ 回填 FR-04 终值写回），并发下存在 lost-update 窗：低峰手动执行收窄暴露面，且回填值与运行时值同源推导（同一命令历史），即使交错也被下一次回填重放幂等修正（重放种子恒 None，终值由命令历史唯一决定）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：单事务（dry-run rollback / apply commit），中断即整体回滚无半态；会话软删/归档不排除在范围外（消耗真实发生，锚照打，与 D-006@v1 口径一致）；change_key 映射不到不建 placeholder（跳过计数），避免回填时代变更行集。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会：命令 change_key 一律按（session.workspace_id, change_key）解析 Change 行；--workspace 缺省全工作区时每会话仍以自己的 workspace 解析；quicklog 链路不在写集。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：同一 submit 批次（timestamp 全同）内多条不同绑定命令时，批内消息序在 DB 无可靠序号（无 seq/created_at 列，id 为 uuid4）——「最后一条生效」在该面内取边近似随机，其后 NULL run 可错锚且被幂等固化。缓解：解析出不同绑定目标的并列组计入 ambiguous_parallel_groups 显式暴露（dry-run 报告可见、人工可查该 run 日志），真实数据面极窄（同一轮内既 done X 又 start Y 的形态罕见）；次风险：content_redacted 密钥脱敏破坏命令 JSON 可解析性（脱敏在字符串值内替换，结构破坏概率极低），解析失败静默计数（logs_parse_failed）不中断。首命令轮保持 NULL（与运行时一致）的 ≤1 轮切换误差已在上一变更裁决可接受。

试过但放弃：
- 用 change_session_links 的链接建立时间做归属——链接只有会话粒度无轮粒度，退化回旧口径；弃。
- 从 platform_agent_logs 水位差分重算——那是本地 CLI 通道，会话有 run 即被防双计谓词排除，不适用平台会话；弃。
- 回填时创建缺失 Change 的 placeholder 行——回填应无副作用超集，缺行意味着变更已删，静默跳过计数更诚实；弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | backend/app/modules/change/backfill_service.py | 回填服务（会话游标重放 + 工作区编排 + 计数） |
| 新增 | backend/scripts/backfill_run_change_context.py | 一次性运维 CLI（dry-run 默认 / --apply / --workspace） |
| 新增 | backend/app/modules/change/tests/test_backfill_run_context.py | 回填语义测试（拆分/幂等/跳过/游标/范围） |
