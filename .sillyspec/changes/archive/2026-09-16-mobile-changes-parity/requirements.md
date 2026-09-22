---
author: qinyi
created_at: 2026-09-16 21:14:20
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 工作区成员（手机端） | 通过 /m/ 路由在手机上查看变更中心、审批、执行兜底操作的用户 |
| 工作区所有者 / 平台管理员 | 额外可删除变更（后端组合权限为权威） |

## 功能需求

### FR-01: 列表页重新扫描
覆盖决策：D-003@v1
Given 用户在移动变更列表页（任一变更 tab）
When 点击工具栏「重新扫描」按钮
Then 调用 reparseChanges(workspaceId)，成功后显示「已重新扫描：解析 N，新增 N · 更新 N · 删除 N。W 个警告。」反馈条（文案与桌面逐字一致），并失效 ["changes", workspaceId] 前缀刷新列表
Given 重新扫描返回警告列表
When 警告数 > 0
Then 反馈条下追加警告卡（[code] change_key: detail 列表）
Given 重新扫描请求失败
When 返回 ApiError
Then 页面显示中文错误（ApiError.message，兜底「重新解析失败」），不白屏

### FR-02: 列表卡片信息补齐
覆盖决策：D-003@v1
Given ChangeSummary.owner_name 非空
When 渲染卡片元信息行
Then 显示负责人名（owner_name）
Given owner_name 空且 owner_id 有值
When 渲染元信息行
Then 显示 owner_id 前 8 位（mono 弱化色）
Given owner_name 与 owner_id 均空
When 渲染元信息行
Then 负责人段显示「—」
Given affected_components 为空数组
When 渲染元信息行
Then 影响组件段省略（不占位）
Given change.usage === null
When 渲染执行用量行
Then 显示「—」占位
Given change.usage === undefined
When 渲染执行用量行
Then 整行不渲染
Given usage.started_at 有值且 finished_at 缺失
When 渲染执行用量行
Then 耗时旁显示「进行中」pill
Given 卡片有 step_progress.current_step_status 或 last_pushed_at
When 渲染徽标行
Then 追加 ChangeActivityBadge（进行中/停滞/空闲/不渲染，组件内真值表决定，与桌面同源）

### FR-03: 列表排序切换与 URL 参数
覆盖决策：D-003@v1
Given 用户打开筛选抽屉
When 切换「排序」chip（↓ 最近优先 / ↑ 最早优先）并确定
Then sortDir 生效进主列表 query key，列表按所选方向请求
Given URL 含 ?tab=quicklog 或 ?tab=archive（合法值）
When 页面初始加载
Then 初始 tab 为该值（非法值回 active）
Given URL 含 ?search=词
When 页面初始加载
Then 搜索词初始化为该值（输入框与已提交 state 同步）
Given 未操作任何筛选、URL 无参数
When 页面加载
Then 全部请求参数与改造前默认值逐字相同（兼容基线）

### FR-04: quicklog tab 筛选
覆盖决策：D-003@v1
Given 用户在快速修复 tab
When 打开筛选抽屉
Then 可见状态 4 态 chips、作者 chips、显示空壳占位开关
Given 用户选择状态=疑似中断并确定
When quicklog 列表请求发出
Then query key 与请求参数带 status="stale"（槽位与桌面 QuicklogTable 同构）
Given 作者选项数据
When quicklog 列表响应到达
Then 作者 chips 从响应 items 按 owner_name→author_name→author_raw 去重聚合（口径与桌面 frontend/src/components/changes/quicklog-table.tsx:197-203 一致）
Given 用户关闭「显示空壳占位」并确定
When 请求发出
Then include_placeholder 收窄（false 时请求不带占位）
Given quicklog tab 处于抽屉筛选状态
When 点击重置
Then 搜索词/状态/作者/占位全部回默认（占位回默认=true）

### FR-05: 详情页三卡挂载
覆盖决策：D-004@v1
Given change.steps 存在且至少一步有 completed_at
When 详情页渲染
Then StageStepper 下方显示 ChangeLastSignal（最后信号相对时间）
Given change.steps 无 completed_at（或 steps 缺失）
When 详情页渲染
Then 最后信号行不渲染
Given 任意变更详情页
When 渲染
Then 挂载 ChangeUsageCard(kind="change", refKey=changeId)（组件自取数）与 ScopeAuditCommandCard(kind="change", changeKey)（三卡位置对齐 design 总体方案 6）

### FR-06: 详情页阶段-时间线联动
覆盖决策：D-004@v1
Given steps 中某阶段有条目
When 点击步骤条该阶段节点
Then 时间线仅显示该阶段步骤，卡头出现「阶段名 ✕」清除 chip
Given 时间线处于阶段筛选态
When 再次点击同阶段节点或点清除 chip
Then 取消筛选恢复全量
Given 某阶段在 steps 中无条目
When 渲染步骤条
Then 该节点不可点（无筛选效果）

### FR-07: 详情页删除入口
覆盖决策：D-004@v1
Given 用户对目标变更有删除权限（canDeleteChange 启发式通过）
When 打开 ⋯ 菜单
Then 出现 danger 项「删除变更」
Given 用户无权限
When 打开 ⋯ 菜单
Then 不出现删除项（其余动作不受影响）
Given change 尚在加载（null）
When 渲染 ⋯ 菜单
Then 不出现删除项
Given 用户点击删除并确认
When deleteChange 成功
Then toast「变更 {change_key} 已删除」+ 失效 ["changes", workspaceId] 前缀 + 跳回移动变更列表
Given deleteChange 失败（403/404/409 等）
When mutation onError
Then 中文 toast（ApiError.message 兜底「删除变更失败」），留在详情页不白屏

## 非功能需求
- 兼容性：usage undefined/空值、旧响应缺字段全部有降级路径（FR-02）；默认参数与改造前逐字一致（FR-03 基线）。
- 可回退：纯前端新增渲染分支与入口，git revert 单 commit 回退。
- 可测试：全部 FR 有 GWT 用例；query key 同构有断言（R-03）。

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | 全部 | 范围=两页，所有 FR 落在两页内 |
| D-002@v1 | （非目标） | 任务域不移植，无 FR；剩余风险记汇报 |
| D-003@v1 | FR-01, FR-02, FR-03, FR-04 | 列表页五项 |
| D-004@v1 | FR-05, FR-06, FR-07 | 详情页五项（三卡/联动/删除） |
| D-005@v1 | 全部 | 复用挂载路线（三卡/徽标/数据函数全复用） |
