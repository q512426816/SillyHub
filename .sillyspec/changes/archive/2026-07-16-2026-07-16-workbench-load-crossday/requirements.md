---
author: qinyi
created_at: 2026-07-16 10:55:00
---

# 需求规格（Requirements）— 工作台日历负载修正 + 执行流程重设计

## 角色

- **填报人**（task 负责人 / problem 责任人）：启动任务、填报执行（提交/完成）、多次填报、查看历次执行记录。
- **查看人**：通过工作日历查看负载饱和度、通过列表详情查看执行记录。

## 功能需求

### FR-01 task 执行流程（启动/提交/完成）
- FR-01.1：未开始状态任务显示「启动」按钮；点击后任务→进行中，记录 actual_start_time，创建 in-flight TaskExecute。
- FR-01.2：进行中状态任务显示「执行」按钮；弹窗填【本次耗时(人天) + 执行情况说明】。
- FR-01.3：弹窗「提交」按钮：保存执行记录（actual_end_time + 耗时 + 说明），任务**回未开始**（可再次启动=多次填报）。
- FR-01.4：弹窗「完成」按钮：保存执行记录，任务→已完成（终结）。
- FR-01.5：多次填报：每次启动→执行产生 1 条 TaskExecute（1:N）。

### FR-02 跨天禁止 + 前端拆分
- FR-02.1：一条执行记录的 actual 起止必须在同一天（后端校验，跨天 422）。
- FR-02.2：前端检测跨天（in-flight actual_start 与 now 不同天）→ 按日期边界生成多行，每天单独填耗时+说明。
- FR-02.3：前端循环单条提交（每条单日 actual）。

### FR-03 problem 处置镜像
- FR-03.1：problem done_task（提交 completed=false / 完成 completed=true）额外创建 TaskExecute（problem_task_id 关联）。
- FR-03.2：完成→待验证；提交→保持处置中。保留 handle_info 追加兼容。

### FR-04 workbench 过去侧负载求和
- FR-04.1：过去日期左点负载 = 当天涉及的 TaskExecute.time_spent×8 求和（覆盖日累加，不平摊）。
- FR-04.2：<8h 有空余(黄) / 8-10h 饱和(绿) / >10h 过载(红) / 0 无(灰)。
- FR-04.3：新录入记录（有 actual 区间）正常显示。

### FR-05 执行记录详情可见
- FR-05.1：task-plans 任务详情列出历次 TaskExecute（开始/结束/耗时/说明/结果）。
- FR-05.2：problem-list 问题详情列出历次处置 TaskExecute（同构，结果映射完成→待验证 / 提交→处置中）。

## 非功能需求

- **NFR-01 兼容**：未上线项目，允许数据重置（规则11）；删 submit bool 不做反向兼容，前端+测试同步改。
- **NFR-02 数据模型**：无表结构变更、无 migration。
- **NFR-03 约束**：backend ruff line-length=100 / pytest asyncio auto / 覆盖率≥60%；改 router 必跑 test_router；双层 commit hook。
- **NFR-04 跨平台**：兼容 Windows/Linux/macOS。
- **NFR-05 国际化**：UI/文档中文。
