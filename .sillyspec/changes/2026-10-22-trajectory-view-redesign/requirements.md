---
author: qinyi
created_at: 2026-10-22 11:36:51
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 会话使用者 | 在会话面板「轨迹」视图中查看一轮对话的输入 / 模型 / 工具时间分布与逐条记录 |
| 排障者 | 通过搜索、折叠和详情标签快速定位失败调用或长耗时步骤 |

## 功能需求

### FR-01: 顶部固定布局

- 轨迹视图 **必须** 独占会话面板可用高度，内部为纵向结构：工具栏 + 时间线固定，账本 **必须** 是唯一滚动区域；滚动账本时工具栏与时间线 **禁止** 移出可视区。

#### 场景：主路径

Given 轨迹视图有足够多的账本行；When 向下滚动到底部；Then 工具栏与三泳道时间线仍在原位，仅账本内容滚动。

### FR-02: 工具栏四项

- 轨迹视图 **必须** 渲染工具栏（`role="toolbar"`）：时长开关、轮次展开/收起、调用展开/收起、搜索输入。时长开关 **必须** 在实际时长与等宽两种时间线投影间切换并记住偏好（全局偏好，key `sillyhub.trajectory.scaleMode`，D-020）；等宽模式为只读概览——**禁止** 缩放、平移、刷子与时间刻度，且 **禁止** 拦截滚轮默认滚动（D-016）。轮次/调用控件 **必须** 分别折叠或展开全部对应行；搜索 **必须** 按文本 AND 分词过滤账本，有查询时折叠整体失效并显示全部命中行（D-013）；零命中 **必须** 显示「没有匹配的记录」空态；时间线 **禁止** 随搜索改变。

#### 场景：主路径

Given 轨迹视图已打开；When 输入搜索词；Then 账本只显示命中行且折叠被绕过；When 清空搜索；Then 恢复原折叠状态。

#### 场景：时长切换

Given 默认实际时长；When 切到等宽；Then 时间线条块按等宽排列，账本结构不变；刷新后仍为等宽。

### FR-03: 两列账本

- 账本 **必须** 渲染为无表头两列结构：事件列（轮次起始标签、轮次竖线）与内容列（类型标签、摘要、可选结果摘要）。产品路径无请求边界数据，**禁止** 渲染 request 圆点或伪造边界（D-019）。行高 **必须** 约为 30px 并带下边框；行内 **禁止** 显示耗时、token 或状态文字；子工具行 **必须** 相对父行缩进 26px。

#### 场景：主路径

Given 一轮包含助手、工具、子工具记录；When 查看账本；Then 首行显示该轮起始标签，后续行共用竖线，子工具缩进，行内只有类型与摘要。

### FR-04: 折叠摘要行

- 折叠一个轮次时 **必须** 只保留该轮首个内容行，其余替换为一条摘要行（步骤数 · 工具调用数）；折叠一组连续工具调用时 **必须** 合并为一条「N 个工具调用 · 名称列表」摘要行；摘要行高 **必须** 约为 20px，点击可展开恢复。

#### 场景：主路径

Given 某轮有 5 条记录；When 点击「轮次 → 收起」；Then 该轮只剩 1 条内容行 + 1 条摘要行；再次展开恢复 5 条。

### FR-05: 多标签详情

- 轨迹视图 **必须** 在右侧渲染详情面板（默认宽度 `clamp(320px, 38%, 440px)`，可拖拽范围 320–720px；≤760px 改抽屉）；无选中行时 **禁止** 渲染面板。工具行 **必须** 提供四标签：概述 / 参数 / 结果 / 计时；参数取工具段 `raw`、结果取配对的 `result`（缺失时退回 `primary` 并注明「未捕获结果」，D-015）；计时的 TTFT / 生成 / 吞吐按设计字段表取值，缺失时显示「未记录 / 不可用」固定文案，**禁止** 估算伪造。其它行 **必须** 提供概述 + 原始内容两档；工具行 **禁止** 出现 Schema 标签。折叠或搜索导致选中行不可见时 **必须** 清空选中并关闭详情（D-014）。

#### 场景：主路径

Given 选中一条工具行；When 查看详情；Then 出现四个标签，参数/结果可 JSON 美化与复制，计时显示开始/总时长；When 选中一条助手行；Then 只有概述与原始内容。

### FR-06: 数据边界与空态

- 账本行类型 **必须** 按数据源分档：产品会话路径只呈现可派生的「用户 / 助手 / 思考 / 工具 / 系统 / 压缩」六类（错误是行状态而非行类型，工具结果不单列行）；dev 预览路径可按 `build-trajectory` 现有能力呈现更多类型。产品路径 **禁止** 为不存在的数据构造行或标签；无可绘制时序时轨迹视图 **必须** 保留显式空态（`data-testid="trajectory-empty"`）。

#### 场景：主路径

Given 会话没有时间锚点；When 打开轨迹；Then 显示「没有可绘制的时间数据」提示，不渲染账本与时间线。

### FR-07: 主题、入口与回归

- 所有颜色 **必须** 走 Tailwind 语义类 / `themes.ts` token（三主题可切换，禁止硬编码 hex）；三态入口与视图持久化 **必须** 保持现状；新增用例 **必须** 全绿，既有轨迹与会话面板用例 **禁止** 被放宽或删除来通过；`frontend` 的 `tsc --noEmit` **必须** 退出 0。

#### 场景：主路径

Given 变更落盘；When 跑轨迹、会话面板相关测试与 tsc；Then 全部通过，三态切换行为不变。

## 非功能需求

- 兼容性：保留 `TrajectoryView` / `TrajectoryTimeline` 既有 props 的向后兼容（只增不改）；dev 预览路由自动受益。
- 性能：千行级账本滚动保持可用（content-visibility + memo）；搜索为纯函数、不触发网络。
- 可维护性：展示层按组件族拆分（toolbar / ledger / detail-panel / view-model），单文件不继续膨胀。

## 决策覆盖矩阵（如存在 decisions.md）

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01/02/03/05 | 以 dsh 为视觉与交互基准 |
| D-002@v1 | FR-01 | 顶部固定、账本唯一滚动 |
| D-003@v1 | FR-02 | 工具栏四项语义 |
| D-004@v1 | FR-03 | 两列账本结构 |
| D-005@v1 | FR-05 | 详情多标签与可调宽 |
| D-006@v1 | FR-06 | 行类型限定与不伪造 |
| D-007@v1 | FR-05 | 隐藏 Schema 标签 |
| D-008@v1 | FR-05 | 工具行完整标签、其它行简化 |
| D-009@v1 | FR-01~FR-05 | 组件族拆分 |
| D-010@v1 | — | 否决原地重构（落选记录） |
| D-011@v1 | — | 否决直接移植 dsh（落选记录） |
| D-012@v1 | 全部 | 设计/原型定稿 |
| D-013@v1 | FR-02 | 搜索时折叠失效、时间线不降透明 |
| D-014@v1 | FR-03/FR-05 | 隐藏选中行清空、键盘只遍历可见行 |
| D-015@v1 | FR-03/FR-05 | 工具行参数/结果字段映射 |
| D-016@v1 | FR-02 | 等宽模式只读概览 |
| D-017@v1 | FR-01 | 时间线 50px 与说明区裁剪 |
| D-018@v1 | FR-05 | D-007 覆盖 D-005 的 Schema 子项 |
| D-019@v1 | FR-03 | 账本不渲染请求边界点 |
| D-020@v1 | FR-02 | 时长偏好为全局偏好 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: `frontend/src/components/daemon/trajectory/__tests__/trajectory-redesign.test.tsx`「轨迹视图独立占满高度：工具栏与时间线在账本滚动容器之外」
FR-02: `frontend/src/components/daemon/trajectory/__tests__/trajectory-view-model.test.ts`「搜索 AND 分词过滤，命中时忽略折叠」+ `frontend/src/components/daemon/trajectory/__tests__/trajectory-redesign.test.tsx`「工具栏四项：时长切换/轮次收起/调用收起/搜索」+「等宽模式禁用缩放手势」
FR-03: `frontend/src/components/daemon/trajectory/__tests__/trajectory-redesign.test.tsx`「两列账本：轮次标签与竖线、类型标签与摘要、无请求边界点、行内无耗时/token」
FR-04: `frontend/src/components/daemon/trajectory/__tests__/trajectory-view-model.test.ts`「轮次/调用折叠摘要统计」+ `frontend/src/components/daemon/trajectory/__tests__/trajectory-redesign.test.tsx`「折叠摘要行点击展开恢复」
FR-05: `frontend/src/components/daemon/trajectory/__tests__/trajectory-redesign.test.tsx`「工具行四标签（无 Schema）/参数取 raw/结果取 result/缺失空态」+「折叠隐藏选中行后清空选中并关闭详情」
FR-06: `frontend/src/components/daemon/trajectory/__tests__/trajectory-view-model.test.ts`「产品路径只派发六类行型」+ `frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx`「无时间锚点 → 轨迹视图显式空态」
FR-07: `frontend/src/components/daemon/trajectory/__tests__` + `frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx`（零回归）+ 不适用类型检查无测试面，`pnpm exec tsc --noEmit` 直接验证退出码
