---
author: qinyi
created_at: 2026-07-14 09:13:35
change: 2026-07-13-ppm-personal-workbench-prototype
---

# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| PPM 用户（登录人） | 查看自己的工作台：个人信息、本月指标、任务、待办、日历 |
| 平台管理员 | 维护 organizations 组织数据（部门来源）、用户 employee_no（工号来源） |

## 功能需求

### FR-01: 工作台页面与入口
覆盖决策：D-001@v1
Given 用户已登录且持有 PPM_TASK_READ 权限
When 访问 `/ppm/workbench` 或点击 PPM 菜单「个人工作台」
Then 渲染三栏布局工作台页面；`/ppm` redirect 行为不变（仍 → /ppm/projects）

### FR-02: 个人信息·工号
覆盖决策：D-002@v1
Given users 表已通过 migration 加 `employee_no` 列
When 工作台请求 `/api/ppm/workbench/profile`
Then 返回 `employee_no`；当前用户未录工号时返回 null，前端显示「—」；不影响登录与其他 UserRead 消费方

### FR-03: 个人信息·部门
覆盖决策：D-003@v1
Given `user_organizations` + `organizations` 表存在
When 查询当前登录人部门
Then 经 `user_organizations` JOIN `organizations` 取主部门（首个 active 组织）name；无关联则 null，前端显示「—」

### FR-04: 个人信息·角色
覆盖决策：D-004@v1
When 查询当前登录人角色
Then 取 `MeResponse.workspaces[0].role_name`（工作区角色），首个非空；全空则 null

### FR-05: 本月指标聚合
覆盖决策：D-008@v1, D-010@v1
Given 范围参数 range ∈ {week, month, all}
When 请求 `/api/ppm/workbench/summary?range=month`
Then 统一按 `ppm_plan_task.start_time` 区间过滤（week=本周一~周日，month=当月1日~月末，all=不限）返回：
- task_count = 范围内任务总数（分母）
- completion_rate = status="已完成" 数 / task_count（task_count=0 返回 0.0）
- delay_rate = (end_time<now AND status!="已完成") 数 / task_count
- work_hours = SUM(task_execute.time_spent) where execute_user_id=me（复用 stat-by_user 口径）
- defect_count = count(ppm_problem_list where duty_user_id=me AND status!="4")，此项不受 range 影响

### FR-06: 待办派生
覆盖决策：D-006@v1
Given `now_handle_user` 存储格式为 `str(user.id)` 逗号分隔（已验证 problem/service.py:433/459/610/703）
When 派生当前人待办
Then 合并：① `ppm_problem_list` / `ppm_problem_change` 的 `now_handle_user` 包含 str(me.id) 的在办项；② `ppm_plan_task` where user_id=me AND status!="已完成"；每条带 type 标签（任务/缺陷/计划）；service 层 Python 端 split 过滤，不依赖 SQL like

### FR-07: 任务操作表
覆盖决策：D-005@v1
When 工作台展示任务表
Then 复用 `GET /api/ppm/personal-task-plan/page`（已有，按当前登录人过滤）；列显示 序号/项目名(project_name)/模块(module_name 近似平台)/任务内容(content)/状态/操作；不依赖 PlanTask 不存在的 project_code/plan_type 字段；操作「执行」走任务执行表单（共享 ExecuteTaskDialog，填本次耗时 + 执行情况说明 + 勾选提交到已完成）→ 调用 execute-plan（复用现有，携带 execute_info/time_spent/submit）。**reverse sync 2026-07-15**：原型 modal 文案自身写「真实实现阶段应同步工时或执行记录」，真实实现用执行表单取代原简单二次确认（用户决策 A），避免 submit=true 空提交不留记录

### FR-08: 工作日历
覆盖决策：D-010@v1
When 请求 `/api/ppm/workbench/calendar?year_month=2026-07`
Then 返回当月每日：task_count（按 `start_time` 落在该日计数，跨多日只计 start_time 当日）。**reverse sync 2026-07-15（注意事项 2 精确口径）**：
- `load_level`（左点·任务饱和）：当日所有任务 `work_load`（计划工时，解析为小时，1d=8h）累加分档 —— 0→none(灰无计划) / <8→leisure(黄有空余) / 8-10→full(绿饱和) / >10→over(红过载)。（原实现误用任务数分档，已改）
- `alert_level`（右点·任务进度）：当日任务取最严重 —— none(灰无任务) / normal(绿正常) / late(黄临期) / over(红延期)。临期：周期≤3日→截止前 1 天临期（含 1 日任务），周期>3日→截止前 2 天临期；延期：`end_time<now` 且未完成。（原实现仅 end_time<now，缺临期，已改）

### FR-09: 工时统计口径
覆盖决策：D-008@v1
When 计算 work_hours 指标
Then 数据源为 `ppm_task_execute.time_spent`（`ppm_work_hour` 表当前为空）；按 execute_user_id=me + 日期范围 SUM；允许为 0

### FR-10: 缺陷统计
When 计算 defect_count
Then count(`ppm_problem_list` where `duty_user_id`=me AND status!="4"已关闭)；不受 range 影响（当前人名下全部未关闭缺陷）

### FR-11: 占位区块
覆盖决策：D-007@v1
When 渲染消息通知 / 绩效考评
Then 显示 EmptyState 空状态（「功能开发中」），不报错、不建后端表；快捷入口「绩效考评」点击提示未开放；「问题清单」「知识库」跳转已有页面

### FR-12: 接口权限
覆盖决策：D-009@v1
When 请求 workbench 三个接口
Then 要求 `PPM_TASK_READ` 权限（复用 `require_permission_any(Permission.PPM_TASK_READ)`，不新建权限）

## 非功能需求
- **兼容性**：`employee_no` nullable，未录入老用户显示「—」，不影响登录/其他 UserRead 消费方；新接口只读不写；personal-task-plan 契约不变
- **可回退**：workbench 接口异常时前端各区块独立 try/catch + EmptyState，不整页崩
- **可测试**：聚合查询有 backend 单测（SQLite in-memory，注意 PG 方言分支，参照 backend-test-sqlite-vs-pg）；指标边界（task_count=0 → rate=0.0）有断言；now_handle_user 派生匹配有钉死测试
- **跨平台**：周/月区间计算本地时区，兼容 Windows/Linux/macOS
- **迁移链**：新 migration down_revision = `20260713_fix_session_zombie`（单 head），revision id ≤32 字符

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 页面路由 /ppm/workbench 独立子路径 |
| D-002@v1 | FR-02 | 工号 = users 加 employee_no 列 |
| D-003@v1 | FR-03 | 部门 = user_organizations 关联 organizations |
| D-004@v1 | FR-04 | 角色 = workspaces[0].role_name |
| D-005@v1 | FR-07 | 任务表字段缺口不扩接口，前端兜底 |
| D-006@v1 | FR-06 | 待办从 now_handle_user + 非终态 plan_task 派生 |
| D-007@v1 | FR-11 | 消息/绩效占位空状态 |
| D-008@v1 | FR-05, FR-09 | 工时数据源 = task_execute.time_spent |
| D-009@v1 | FR-12 | 权限复用 PPM_TASK_READ |
| D-010@v1 | FR-05, FR-08 | 延期口径（plan_task end_time<now；problem is_delay_plan） |

全部 D-001~D-010@v1 已被 FR 覆盖，无剩余未覆盖决策。
