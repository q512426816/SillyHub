---
author: qinyi
created_at: 2026-08-24 17:05:00
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 用户 | 在会话中派团队、选范围/主 agent、与主控对话的人 |
| 主控（orchestrator） | 会话自身 agent 升任的团队项目经理，经 MCP 工具派 worker/收敛 |
| worker（分身） | 独立 lease+会话+目录的任务执行 agent（git 隔离或直通两种模式） |
| daemon（守护进程） | 本地机器上的会话/任务执行器，host_fs RPC 执行方 |

## 功能需求

### FR-01: 主控首轮任务简报
覆盖决策：D-001@v1, D-002@v1, D-004@v1, D-013@v1

Given 会话已预建活跃 mission（弹层或 create 携带）且本轮 prompt 非空
When 该 mission 不存在 status ∈ {pending, running, completed} 的 orchestrator run（failed 不算已消耗）
Then 本轮 SESSION_INJECT/create 首 prompt = `简报 + "\n\n---\n\n" + 用户消息`；简报含 mission_id、锚点工作区、scope 清单（每工作区一行：名称/id/类型/机器名/daemon 在线/git 模式）、dispatch_worker 用法（target_workspace_id）、mission_status 提示、禁越权约束

Given 同一 mission 已有非 failed 的 orchestrator run
When 后续任意 inject
Then 不再注入简报（一次性；在线时效靠 FR-02）

Given 本轮为纯配置切换轮（空 prompt）
When inject 发生
When 该轮即使被双标记也不注入简报、不消耗一次性名额

Given 首个主控轮派发失败（run→failed）
When 用户发送下一条带文本消息
Then 简报重新注入

Given 前端会话消息流与 AgentRunLog(user_input)
When 简报被注入
When 展示与落库保持干净用户消息（不含简报文本）

### FR-02: mission_status 常驻查询工具
覆盖决策：D-005@v1, D-012@v1

Given Claude 主 agent 会话（非分身）
When 调用 mission_status MCP 工具
Then 返回 active/mission_id/派生状态/objective/锚点工作区/scope_workspaces（含 daemon_online/daemon_name/git_mode）/workers 概要/budget_usd

Given 会话无活跃 mission
When 调用 mission_status
Then 返回 `{active: false, hint}` 200（不 404 不报错），hint 引导先配置派团队

Given daemon 未升级（旧版本）
When 新 backend 运行
Then 简报/直通/新会话派团队不依赖该工具仍生效（工具缺失仅损失按需查询）

### FR-03: 弹层工作区探测
覆盖决策：D-008@v2

Given 派团队弹层打开
When 前端调用 `POST /api/workspaces/probe`（候选工作区 id 列表）
Then 返回每工作区 `{git_mode, daemon_name, daemon_online}`（后端任一成员 binding 口径，与简报/mission_status 同源）

Given 弹层工作区行渲染
When daemon_online=true/false/未绑定
Then 分别显示 机器名+绿点 / 机器名+灰点 / 「未绑机器」；git_mode 显示「git 隔离/直通·非 git/未知」标签

### FR-04: 非 git 工作区直通
覆盖决策：D-006@v2, D-007@v1

Given worker 派发目标工作区
When 后端探测（非降级 RPC 通道 stat `<root>/.git` 绝对路径）
Then 三态：exists=True→git；daemon 真答 False→direct；transport 异常/未绑 daemon/超时→unknown

Given 探测=git
When worker 派发
Then per-worker worktree 隔离链路逐字节不变

Given 探测=direct
When worker 派发
Then 跳过 worktree：root_path=工作区根、run.worktree_branch 保持 None、lease 不写 branch、worker prompt 用直通约束变体（无 commit 指令；明示改动即时生效+同目录并发风险）

Given 探测=unknown
When worker 派发
Then 走现状 worktree 尝试（失败按 worktree_create_failed 既有语义，不降级直通）

Given mission 收敛
When 直通 worker 存在
Then finalizer 合并/清理天然跳过（只处理 worktree_branch 非空者），产物照常收集，converge 不报错

### FR-05: 新会话派团队可用
覆盖决策：D-009@v2

Given 预会话（未发送首句）且引擎=claude 且所选机器在线
When 用户点击派团队并确认
When 弹层正常可用（不再置灰），payload 暂存

When 用户发送首句
Then createSession 请求携带 team_mission 块；后端在首 run 创建前 flush-only 同事务预建 mission；objective=block.objective‖首句 prompt；首 run 双标记 mission_id+role=orchestrator；首轮 prompt 携简报前缀

Given create 过程任意步骤失败
When 事务回滚
Then session 与 mission 一并回滚，无孤儿数据

### FR-06: 主 agent 选择器（仅预会话）
覆盖决策：D-010@v1, D-014@v1

Given 预会话弹层
When 渲染主 agent 选择器
Then 默认「当前会话」+ scope 内各工作区（显示机器名+在线状态；离线/未绑禁选）；落 orchestrator_workspace_id（null=默认）

Given 选择工作区 W（∈ scope）
When 创建会话
Then session.workspace_id=W；机器钉定 (W, 创建者) 的 WorkspaceMemberRuntime binding——**缺失 422「该工作区未绑定你的机器」**；cwd=W.root_path；智能体=W 默认（用户显式选 agent_profile_id/llm_provider_id/runtime_id 时显式优先）

Given 既有会话（已存在）派团队弹层
When 渲染
Then 不提供主 agent 选择器（主 agent 恒=当前会话；进程 cwd/机器创建时钉定）

### FR-07: 存量零回归
覆盖决策：D-003@v1

Given 无 mission 普通会话 / 既有会话预建路径 / 懒建路径 / 存量 external-team mission / patrol 重派
When 本变更上线
When 行为全部不变（懒建不补简报不增强响应；patrol 的 render_orchestrator_prompt 输出结构等价+新增机器名字段，不引入探测 RPC）

## 非功能需求

- 兼容性：见 FR-07 与 design §9 六场景（含旧 daemon 双向兼容）；Windows/Linux/macOS 通用（路径经 resolve_root_path_for_daemon 归一）。
- 可回退：未上线，revert + 重置开发数据；每层（A-E）独立可回退。
- 可测试：三态探测/一次性判定/事务回滚/边界轮（空 prompt/failed）均有单测锚点；简报 token 量级有量化测试（R-01）。
- 性能：probe/status 每调用 N（scope 规模，个位数）次 RPC，弹层打开时一次不轮询；简报仅首轮一次。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01~06 | 五层方案总纲 |
| D-002@v1 | FR-01, FR-02 | 简报仅首轮一次 |
| D-003@v1 | FR-07 | 懒建不补不增强 |
| D-004@v1 | FR-01 | prompt 前缀机制 |
| D-005@v1 | FR-02 | active=false 优雅返回 |
| D-006@v2 | FR-04 | 三态探测（非降级通道+绝对路径） |
| D-007@v1 | FR-04 | worktree_branch=None 路径A 语义 |
| D-008@v2 | FR-03 | 后端统一 probe 端点 |
| D-009@v2 | FR-05 | flush-only 同事务预建+objective 直取 |
| D-010@v1 | FR-06 | 主 agent 选择器边界 |
| D-011@v1 | — | C 层主体拆分（非目标） |
| D-012@v1 | FR-02 | status 定位不走 _resolve_session_mission |
| D-013@v1 | FR-01 | 一次性判定边界（空轮/failed 重注） |
| D-014@v1 | FR-06 | binding 归属=(W, 创建者) 缺失 422 |
