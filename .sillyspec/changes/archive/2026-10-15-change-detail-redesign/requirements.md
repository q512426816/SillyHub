---
author: qinyi
created_at: 2026-10-15 23:58:00
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台使用者（开发者） | 打开变更详情页查看进度、处理待办（审批/人工测试）、查阅产出与过程留痕 |
| 变更发起人 / 负责人 | 关注变更当前阶段与待办，需要一眼看到「现在要做什么」 |
| 评审/归档查看者 | 归档后回看产出（FR/决策/留档）与改动规模 |
| 前端维护者 | 需要在四 tab 结构下新增/调整展示面，且不破坏移动端复用契约 |

## 功能需求

### FR-01: 首屏按变更状态自适应
覆盖决策：D-001@v1
Given 用户打开任一变更详情页
When 页面渲染完成
Then 在途态首屏 MUST 呈现「概览」tab：待办卡（当前有待办时）+ 变更摘要（阶段/任务/已用时长/最后信号）+ 最近动态；归档态首屏 MUST 呈现成果语义（资产计数/改动规模/墙钟）+ 归档留档 + 最终动态

#### 场景：在途首屏不出现执行用量全宽卡与并列时间线
Given 变更处于在途态（`isTerminalChange` 为假）
When 用户打开详情页
Then 首屏 MUST NOT 出现全宽「执行用量」卡；MUST NOT 出现「步骤时间线」与「真实留痕时间线」两张并列卡片

### FR-02: 页面骨架 = 顶部四 tab 分区
覆盖决策：D-002@v1
承接: FR-unmapped-497, FR-styles-011
Given 用户打开任一在途变更详情页
When 页面渲染完成
Then 主体 MUST 为四个 tab（概览 / 产出 / 过程 / 文件与对账），默认停在「概览」；tab 栏 MUST 位于常驻阶段条之下；MUST NOT 再呈现「左主列 + 右侧栏」的两栏骨架

#### 场景：阶段条常驻且与过程筛选联动
Given 详情页已加载且 `current_stage` 为五阶段之一
When 用户点击阶段条上某阶段节点
Then 页面 MUST 切到「过程」tab 并只显示该阶段条目，且 MUST 提供清除筛选入口

#### 场景：阶段条对非线性阶段静默不渲染
Given 变更的 `current_stage` 不在五阶段内（如 thin / quick / blocked）
When 页面渲染完成
Then 阶段条 MUST NOT 渲染（由页头状态胶囊承载），thin 出身 MUST 显示轻量流程条

### FR-03: tab 状态写入 URL
覆盖决策：D-013@v1, D-016@v1
Given 用户处于详情页的任一 tab
When 用户切换 tab
Then URL MUST 更新为 `?tab=<值>`，MUST NOT 触发整页重载

#### 场景：深链、刷新与非法值回落
Given 用户直接访问 `.../changes/<cid>?tab=assets` / 刷新当前页 / 访问 `?tab=不存在`
When 页面渲染完成
Then 分别 MUST 停在「产出」tab / MUST 停在当前 tab / MUST 回落「概览」

#### 场景：收窄后非法 tab 值钳制
Given 归档态下 `?tab=files` 不在 `visibleTabs`（或切换变更时残留了上一变更的非法 tab 值）
When 页面渲染完成
Then MUST 以 `router.replace` 钳回 `?tab=overview`，MUST NOT 渲染空白面板

### FR-04: tab 集随状态自适应且 thin 不特判
覆盖决策：D-007@v1, D-015@v1, D-016@v1
Given 变更处于归档态（`isTerminalChange` 为真，即 status=archived 或 location=archive）
When 页面渲染完成
Then tab 集 MUST 收窄为三个（概览/产出/过程），MUST NOT 渲染「文件与对账」tab

#### 场景：归档态不残留悬空入口
Given 归档态下「文件与对账」tab 不渲染
When 概览右侧信息栏渲染范围对账计数
Then 其入口 MUST 指向「产出 · 归档留档」，MUST NOT 指向不存在的 tab

#### 场景：thin 出身不特判 tab 集
Given 变更为 thin 出身（无五阶段、`change.steps` 恒空）
When 用户在途打开详情页
Then tab 集 MUST 与完整流程在途态一致（四个），MUST NOT 因 thin 收窄而隐藏「过程」（thin 的主线叙事由观测事件流承担）

### FR-05: 知识图谱独立成区
覆盖决策：D-003@v1, D-016@v1
承接: FR-build-133
Given 变更存在知识图谱邻域数据（`neighbors` 查询以 `change_key` 为锚命中）
When 用户进入「产出」tab
Then 知识图谱 MUST 渲染为资产清单之外的独立分区（画布 + 节点详情栏），画布高度 MUST 不再受资产卡内嵌的 280px 约束

#### 场景：图谱不可用时呈现分区级空态
Given 图谱查询失败 / `available=false` / 节点为空
When 「产出」tab 渲染
Then 图谱分区 MUST 保留容器并呈现三态各自的说明文案（「图谱数据不可用」/「暂不可用，稍后自动重试」/「暂无图谱邻域」），MUST NOT 整区消失、MUST NOT 造成大面积无解释空白

#### 场景：资产卡失败与归档保底渲染
Given 资产主查询 `isError`（`change-assets-card.tsx:181` 现为整卡 `return null`）
When 「产出」tab 渲染
Then 资产卡 MUST 保留卡头并给出一行分区级错误说明；归档态下「归档留档」MUST 保底渲染（走其自身 patch 摘要取数），MUST NOT 因主查询失败而整体缺失

### FR-06: 资产分组形态（自然高度 + 上限折叠）
覆盖决策：D-001@v1
承接: FR-auto-frontend-087
Given 「产出」tab 渲染六组资产（需求规则 / 决策蒸馏 / 知识触达 / 测试绑定 / 模块触达 / 归档留档）
When 某组条目数超过 5
Then 该组 MUST 直接显示最多 5 行并提供「展开全部 N 条」（展开后 MUST 可收起）；MUST NOT 使用固定高度 + 组内独立滚动的分组形态

#### 场景：在途态不出现归档留档组
Given 变更处于在途态
When 「产出」tab 渲染
Then MUST NOT 渲染「归档留档」分组（MUST NOT 以空态或占位形态出现）

### FR-07: 范围对账下沉至「文件与对账」
覆盖决策：D-004@v1
承接: FR-auto-frontend-090, FR-auto-frontend-021, FR-lib-changes-030
Given 用户打开详情页
When 页面渲染完成
Then 范围对账卡 MUST NOT 挂载于任何常驻侧栏位置；其挂载点 MUST 为「文件与对账」tab

#### 场景：既有对账能力零损失
Given 范围对账卡被挂载于「文件与对账」tab
When 用户查看对账区
Then 三态计数（计划内/计划外/计划未动）、分仓分段、锚点、明细弹窗（含单文件 diff）、折叠的本地命令、归档态降级指路 MUST 全部保持可用

### FR-08: 概览右侧信息栏承载元信息
覆盖决策：D-006@v1
承接: FR-auto-frontend-038
Given 用户在「概览」tab
When 页面渲染完成
Then 右侧信息栏 MUST 呈现：基本信息（key/类型/创建/负责人）、执行用量（7 项指标，含按模型明细展开入口）、会话（最近若干条 + 工作台入口）、范围对账计数（含入口）、产出速览（计数 + 入口）；执行用量与会话 MUST NOT 需要切到「过程」tab 才能看到

#### 场景：窄栏文本不溢出
Given 信息栏宽度受限（约 288px）
When 值文本超长（变更 key / 会话名 / 模型名）
Then 文本 MUST 单行截断且 MUST 提供悬浮全文

### FR-09: 两条时间线合并为一条统一时间线
覆盖决策：D-005@v1, D-014@v1, D-016@v1
承接: FR-auto-frontend-056, FR-build-134
Given 变更同时存在 steps（步骤）与 timeline 端点数据（事件/诞生锚）
When 用户进入「过程」tab
Then MUST 只渲染一条统一时间线；MUST NOT 同时挂载「步骤时间线」与「真实留痕时间线」两张卡

#### 场景：源内去重（稳定键）
Given 同一源内存在重复条目
When 合并执行
Then 步骤 MUST 以 `stage + ordering` 为键去重、事件 MUST 以 `ts + kind + label` 为键去重；MUST NOT 使用名称相似度或时间窗口做近似匹配

#### 场景：task-done 事件折叠进任务清单
Given 事件流中存在 `kind="task-done"` 且 detail 为「checked N→M」（tasks 域）
When 合并执行
Then 该事件 MUST NOT 作为时间线行出现（其信息由 FR-10 任务清单承载）
Given 存在非 tasks 域的同形态事件（如 `design · checked 0→6`）
When 合并执行
Then 该事件 MUST 保留为普通时间线行

#### 场景：三个边界输入类的显式取舍
Given 输入含 ①`completed_at` 为非 ISO 残留原串 ②同 `ts`+同 `kind`+同 `label` 的重复事件 ③task-done 推断断裂（`checked` 游标不连续）
When 合并执行
Then ① MUST 先做可解析判定，不可解析者与无时间戳者同置末尾（MUST NOT 混入字典序比较）；②MUST 按同键去重（同秒同类型同文本视为同一观测重复上报）且该取舍 MUST 在口径说明中声明；③ 折叠照旧但该任务行 MUST 显示「时刻不可推断（观测断链）」，MUST NOT 显示裸 `?`

#### 场景：两源独有信息不丢
Given 合并后的统一时间线
When 用户查看任一行
Then 步骤侧 MUST 保留阶段归属、等待原因、输出全文；事件侧 MUST 保留提交短哈希与标题、文件/配置变更类事件与墙钟统计

### FR-10: 任务进度清单独立承载任务面
覆盖决策：D-014@v1
Given 变更 `tasks.md` 存在任务行（`- [x]/- [ ] task-NN: desc`）
When 用户进入「过程」tab
Then MUST 呈现任务进度清单：勾选态 + task id + 描述 + 推断勾选时刻（MUST 标 `≈` 以表推断值）+ 提交锚（有则显）+ 勾选比（checked/total）

### FR-11: 变更文件在 tab 内直接内嵌
覆盖决策：D-012@v1
Given 用户进入「文件与对账」tab
When 页面渲染完成
Then MUST 直接渲染文件树与预览区（左侧点文件、右侧看内容/diff）；MUST NOT 以「打开」按钮 + 弹窗作为文件树的唯一入口

### FR-12: 实现按批准原型接线
覆盖决策：D-008@v1
Given 已批准的原型（`prototype-change-detail-v2.html` 及其源码）在场
When 实施各面板
Then 实现结构 MUST 以批准稿为基准逐面板对照；发现结构无法对齐时 MUST 停机带截图裁决并留痕，MUST NOT 静默降级

#### 场景：原型与实现分家防护
Given 实施期需要修改原型源码
When 修改完成
Then MUST 重跑 `pnpm prototype:build` 并复核产物 diff（对账门），MUST NOT 手改产物 HTML

### FR-13: 冲突活需求显式取代并落盘
覆盖决策：D-009@v1
Given 本变更与 6 条活需求冲突（左主右辅布局 / 两时间线共存 / 图谱内嵌资产卡 / 主栏顺序 / 资产卡固定高度网格 / 详情页重排）
When 交付本变更
Then MUST 在 requirements/decisions 中以承接行引用被取代的全局 FR id，并 MUST 由归档链路将其翻为 superseded 建取代链

### FR-14: 改造边界与移动端契约兼容
覆盖决策：D-011@v1, D-016@v1
Given 移动端详情页直接引用桌面侧组件符号与**页模块导出**
When 桌面页重构完成
Then `frontend/src/components/mobile/mobile-change-detail.tsx:66-82` 的 import 面 **MUST 逐符号**仍可解析且行为不变（含组件符号 7 项、页模块导出 `isTerminalChange`、列表页 `PENDING_REVIEW_LABEL`）；被引用组件文件 MUST NOT 被删除

#### 场景：页模块导出不得随重写迁走
Given `isTerminalChange` 由 `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:64` 导出并被移动端消费
When 该页面被重写为 tab 容器
Then `isTerminalChange` MUST 保留在同一文件同一语义（`status === "archived" || location === "archive"`）；MUST NOT 只在新模块导出而被移动端指向的路径缺失

#### 场景：桌面卸载不等于删除
Given `ChangeStepTimeline` 不再挂载于桌面页
When 检查交付物
Then 该组件文件与其导出 MUST 仍在场（移动端与既有测试仍引用），MUST NOT 以「清理死代码」名义删除

### FR-15: 一次性完整交付
覆盖决策：D-010@v1
Given 本变更包含四个面板 + 合并算法 + 状态自适应
When 提交验收
Then 四 tab 与两态自适应 MUST 全部可用；MUST NOT 交付「骨架已改、面板仍为旧卡」的中间态

## 非功能需求

- **兼容性**：本变更 MUST NOT 新增或修改后端端点/DTO；前端 MUST NOT 引入新的全局状态或路由；`?tab=` 缺省与非法值 MUST 回落「概览」；移动端复用契约 MUST 保持（见 FR-14）。
- **可回退**：tab 容器为纯展示编排；需回退时 MUST 可通过恢复旧挂载顺序实现（旧组件 MUST 未被删除）。
- **可测试**：合并口径 MUST 以纯函数实现并可独立单测（零取数）；tab 集判定 MUST 可由 `isTerminalChange` 单一布尔驱动并可单测；页面级 MUST 有 `?tab=` 驱动的测试。
- **性能**：tab 内重内容（文件树、图谱）SHOULD 采用切到该 tab 才挂载的懒挂载，避免首屏多余请求；时间线在本 tab 内 SHOULD 限高并可折叠超量条目。
- **可维护**：面板 MUST 拆分为独立组件（每面板一文件 + 其测试），页面组件 MUST 只承担取数、状态分叉与编排。
- **可观测/无回归**：既有 10s 轮询与终态停轮、删除入口权限启发式、审批四分支与通知降级文案 MUST 行为不变。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-06 | 首屏分阶段自适应 + 在途不渲染归档留档组 |
| D-002@v1 | FR-02 | 顶部四 tab 骨架（取代左主右辅） |
| D-003@v1 | FR-05 | 知识图谱独立分区（取代图谱内嵌资产卡） |
| D-004@v1 | FR-07 | 范围对账下沉至「文件与对账」 |
| D-005@v1 | FR-09 | 两条时间线合并为一条 |
| D-006@v1 | FR-08 | 用量与会话入概览右侧信息栏 |
| D-007@v1 | FR-04 | 归档态 tab 集收窄（含不残留悬空入口） |
| D-008@v1 | FR-12 | 原型驱动实现与接线对照 |
| D-009@v1 | FR-13 | 冲突活需求显式取代并落盘 |
| D-010@v1 | FR-15 | 一次性完整交付 |
| D-011@v1 | FR-14 | 边界=桌面页 + 移动端契约兼容 |
| D-012@v1 | FR-11 | 变更文件 tab 内直接内嵌 |
| D-013@v1 | FR-03 | tab 状态写入 URL |
| D-014@v1 | FR-09, FR-10 | 合并三层口径 + 任务面由清单承载 |
| D-015@v1 | FR-04 | thin 不特判 tab 集 |
| D-016@v1 | FR-03, FR-04, FR-05, FR-09, FR-14 | Grill 首轮修订补录：移动端页模块导出 / 三输入类取舍 / 错误分支与归档保底 / 深链钳制 |
| D-008-rejected-B@v1 | — | 落选方案（直接改正式页面）：不作为需求，仅存档防复潮 |
| D-008-rejected-C@v1 | — | 落选方案（双轨新路由并行）：不作为需求，仅存档防复潮 |

**剩余风险（未被任何 D-xxx@vN 覆盖的项）**：无——D-008-rejected-B/C 为落选归档条目，不产生需求面。

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-06: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-07: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-08: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-09: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-10: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-11: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-12: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-13: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-14: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-15: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
