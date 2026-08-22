---
author: qinyi
created_at: 2026-08-23 04:27:30
---

# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 在会话门户浏览/新建/继续智能体会话的开发者 |

## 功能需求

### FR-01: 左侧工作区树列表
覆盖决策：D-103@v1, D-105@v1
Given 会话门户已打开且列表已加载（listAgentSessions limit≤500，客户端按 workspace_id 分组）
When 用户查看左侧列表
Then 工作区按分组手风琴展示（组头=名称+会话数+「＋」+展开箭头），组内按机器分小节（标题=机器名+在线状态点），「非工作区」固定为末尾分组且组头同样有「＋」；条目含状态点/标题/相对时间/引擎 chip/创建人 chip；某工作区分组会话数为 0 时该组仍显示（组头计数 0）。

Given 列表数据一次拉取
When 会话总数超过组内展示上限（50）
Then 组内显示最近 50 条+「显示全部」展开（R-03 兜底）。

### FR-02: 两层筛选 tab（机器>智能体）
覆盖决策：D-107@v1
Given 用户未选筛选（默认「全部」）
When 点击第一层某机器 tab
Then 出现第二层智能体 tab；列表条目按该机器过滤、机器小节标题隐藏（已隐含）；再点智能体 tab 后按引擎过滤。
When 点击「全部」（第一层）
Then 两层筛选清空、智能体 tab 收起、列表恢复全量分组视图。

### FR-03: 预会话态（新建即聊天界面）
覆盖决策：D-101@v1, D-102@v1, D-104@v1
Given 用户点击某分组组头「＋」（上下文已解析：工作区=分组、机器+智能体按 FR-04）
When 右侧渲染
Then 显示与正常会话完全同构的 SessionPanel 空态（同面板头/时间线/输入区），无独立新建页面；顶部一行锁定上下文（📂工作区·🖥机器·⚡智能体 + "创建会话后不可更换"标识），不可编辑（D-104）。
When 用户输入第一句并点发送
Then 此刻调 createSession（runtime_id+prompt+可选 workspace_id/change_id；请求体与现行契约一致）；成功后同一界面原地开聊（SSE 接管），该会话出现在左侧对应分组顶部。
When 用户不发言离开预会话态（切会话/切路由）
Then 不产生任何会话（零残留）。
When createSession 失败
Then 输入内容保留、显示内联错误、可重试；不切换到真会话态。

### FR-04: 新建上下文解析与两步选择浮层
覆盖决策：D-107@v1, D-105@v1
Given 筛选 tab 已选具体机器+智能体，用户点组头「＋」
Then 直接带 tab 上下文进入预会话（不再选择）。
Given 筛选为「全部」，用户点组头「＋」
Then 弹出两步轻选择浮层：①仅在线机器 ②该机器可用智能体（claude/codex，默认 Claude Code）；两步完成即进入预会话（浮层关闭，非配置表单）。
Given 分组为「非工作区」或工作区无绑定机器
Then 机器上下文走 D-005 三级回退（localStorage→最近会话在线机器→最新心跳）；上下文优先级恒为：tab 筛选 > 工作区绑定在线机器 > D-005 回退。

### FR-05: 创建人 chip
覆盖决策：D-108@v2
Given 列表 DTO 含 owner_name（后端 join users，缺失 null）
Then 条目 chips 显示创建人（当前本人隔离视图下恒为"我"；null 显"—"）。

### FR-06: 入口收敛与 NewSessionForm 退役
覆盖决策：D-106@v1, D-109@v1
Given 三入口路由 /sessions、/workspaces/[id]/sessions、/workspaces/[id]/changes/[cid]/sessions
When 分别访问
Then 全局=完整工作区树；workspace=深链预展开并滚动到该分组；change=独立页（预会话上下文行加显变更名；调用方显式双传 workspaceId+changeId）。
Given 门户处于未选中会话态
Then 右侧为空门户态（不再渲染 NewSessionForm）；组件及其测试全量退役，bind 语义由 preContext 继承。
Given URL 带 ?session=<id>
Then 深链直达该会话（验证有效）；无效 id 静默落空门户态。

## 非功能需求
- 兼容性：后端列表 owner_name 可空新字段旧客户端无感；limit 上限放宽向后兼容；daemon 协议与 createSession 请求体零变化。
- 可回退：预会话态为纯前端新增分支，回退=恢复 NewSessionForm 渲染分支（git revert 单提交粒度）。
- 可测试：SessionPanel 预会话 null 守卫逐 effect 断言（R-01 专项测试）；分组/筛选/创建流均可组件级测试。

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-101@v1 | FR-03 | SessionPanel 同构空态载体 |
| D-102@v1 | FR-03 | 首句发送即创建，零协议改动 |
| D-103@v1 | FR-01 | 一次拉取客户端分组 |
| D-104@v1 | FR-03 | 上下文行完全锁定 |
| D-105@v1 | FR-01/FR-04 | 非工作区分组可新建（D-005 回退） |
| D-106@v1 | FR-06 | 变更入口独立 |
| D-107@v1 | FR-02/FR-04 | 两层筛选 tab+两步浮层 |
| D-108@v2 | FR-05 | 创建人 chip（信息完备预留） |
| D-109@v1 | FR-06 | NewSessionForm 退役 |
