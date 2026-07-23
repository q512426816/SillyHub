---
author: qinyi
created_at: 2026-07-16 10:55:00
---

# 决策记录（Decisions）— 工作台日历负载修正 + 执行流程重设计

## D-001 过去侧负载改「求和」推翻平摊
- **决策**：workbench 过去日期左点负载 = 当天涉及的 TaskExecute.time_spent×8 直接求和（覆盖日累加），不再按 actual 区间天数平摊。
- **理由**：平摊导致跨多天记录稀释 <8h 标黄；与详情显示原始整条工时口径打架（标黄根因）。用户确认求和口径。
- **替代**：平摊+统一详情显示（数字变小仍标黄，不符直觉）/ 平摊+单条封顶（口径分叉）。均否决。
- **映射**：design §5.4；修正 07-15 D-001~005 平摊方案。

## D-002 task 执行状态机：启动/提交/完成，1:N TaskExecute
- **决策**：未开始→(start)→进行中→(execute.submit 回未开始 | execute.complete 转已完成)；每次 start→execute 产生 1 条单日 TaskExecute，1 plan : N execute。
- **理由**：用户期望多次填报 + 跨天拆分粒度为单日记录。
- **映射**：design §5.1。

## D-003 删 submit bool 改 action 枚举，不做反向兼容
- **决策**：ExecutePlanReq 删 `submit: bool`，加 `action: "submit"|"complete"` + `task_execute_id`(必填)。前端 + test_task.py 同步改，不兼容旧 submit。
- **理由**（P0-3）：旧 `submit=True`=完成 vs 新 `action="submit"`=重置未开始，语义相反；兼容映射会埋坑（前端漏改一处行为相反且无报错）。规则11 允许重置数据，无兼容负担。
- **替代**：新枚举换名（save/complete）—— 但 "提交/完成" 是用户原话，保留语义。兼容映射——否决（埋坑）。
- **映射**：design §5.1、§7.2、§9。

## D-004 跨天校验位置：service 内部 + Create/Update validator
- **决策**：execute_plan service 内部读 `exc.actual_start_time` 比 `actual_end_time`（强制回填后）跨天抛 422；TaskExecuteCreate/Update 加 model_validator（看板 CRUD 路径）；ExecutePlanReq **不加** validator（无 actual_start_time 字段，加了是死代码）。
- **理由**（P0-2）：execute_plan 内部直构 TaskExecute（service.py:261）不经 schema；start/end 跨两次请求，ExecutePlanReq 看不到 actual_start_time。
- **映射**：design §5.1、§7.3。

## D-005 action 分支强制回填 actual_end_time=now
- **决策**：execute_plan 的 action=submit/complete 分支强制 `exc.actual_end_time = req.actual_end_time or now`（不再只在 req 带时才写）。
- **理由**（P1-2 关键）：当前 service.py:264-267 只在 req 带时写，前端不传则 actual_end 永远空 → 新录入 TaskExecute 无 actual 区间 → _covers_date 双 None 返 False → 日历左侧不显示 → 标黄修不干净。强制回填让新录入有 actual 区间。
- **映射**：design §5.1、§7.2。

## D-006 跨天前端拆分（每天单独填）+ 循环单条提交
- **决策**：前端检测跨天（in-flight actual_start 与 now 不同天）→ 按日期边界生成多行（每天：耗时+说明输入，留空用户单独填）→ 循环单条调 /start.../execute。
- **理由**（P1-5）：用户确认"每天单独填"；YAGNI 批量端点（避免新端点契约+事务复杂度）。
- **替代**：批量 /execute/batch 端点 —— 否决（YAGNI）；自动均分 —— 否决（用户要单独填）。
- **映射**：design §5.2；失败处理 R-03。

## D-007 problem done_task 创建 TaskExecute（actual 单点 now）
- **决策**：done_task 额外创建 TaskExecute（problem_task_id, execute_user_id, actual_start_time=now, actual_end_time=now, time_spent, execute_info=handle_info, status=90）。不取 real_start_time。
- **理由**（P0-1）：PpmProblemList **只有 real_end_time，无 real_start_time**（已核实 model.py）；单点 now 同日，跨天校验天然不触发；problem 处置无独立"启动"，单点语义合理（一次 done=一次处置）。
- **映射**：design §5.3、§7.5。

## D-008 执行记录详情：task 复用 /task-execute/page；problem 扩 problem_task_id
- **决策**（P1-4）：task 侧复用现有 `GET /task-execute/page?plan_task_id`；problem 侧扩 `TaskExecutePageReq` 加 `problem_task_id` 过滤（schema+service+router）。不新增端点。
- **理由**：task 侧已有现成分页端点（router.py:348）；避免重复造轮子。
- **映射**：design §5.5、§7.6。

## D-009 work-calendar-panel.tsx 零改动
- **决策**（P1-1）：前端日历组件不动。load_level 字符串契约（none/leisure/full/over）不变，颜色映射不变；仅后端 daily_actual 求和值变。
- **映射**：design §6 零改动声明。

## D-010 历史跨天数据不清理
- **决策**：若依迁移的历史跨天 TaskExecute 不清理。求和后覆盖日全计入可能虚高饱和。
- **理由**：规则11 允许不兼容；用户确认接受脏数据；仅约束新录入。
- **映射**：design §3、R-01。

## 关联
- 修正前序变更 [[2026-07-15-workbench-calendar-load-actual]] 的 D-001~005 平摊方案。
- P0-1/P0-2/P0-3 为 Design Grill 子代理交叉审查发现的技术硬伤。
