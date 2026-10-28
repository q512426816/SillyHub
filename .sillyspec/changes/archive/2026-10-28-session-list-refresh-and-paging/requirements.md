---
author: flow-machine-draft
created_at: 2026-10-28T04:34:47.342Z
---
# 需求规格（Requirements）— 2026-10-28-session-list-refresh-and-paging

## 功能需求

### FR-01: 会话内暂存切换（供应商/模型/档案）随消息发送生效后，左侧会话列表对应条目的配置 chips 立即刷新（不依赖轮询兜底）

- 暂存切换随消息发送受理成功后，**必须**同步触发左侧会话列表刷新（onSessionListRefresh 回调，与 onSwitched 等既有 8 个点位同款）；dialog 模式未传该回调**必须**静默跳过（零回归）。

#### 场景：主路径

- Given /sessions 会话页、会话内暂存切换了供应商（或模型/档案）并发送消息
- When 发送受理成功（直发 / 排队 / steering 任一路径）
- Then 左侧列表对应条目的供应商/模型/档案 chips 立即显示新值（不等 10s/30s 轮询）

### FR-02: 会话列表常显总数（按当前筛选口径的服务端 total，筛选/视图切换随之更新）

- 列表**必须**常显当前筛选口径下的会话总数（服务端 total，随筛选/引擎 tab/视图切换更新）；仅当已加载数 < 总数时**必须**同时显示已加载计数。

#### 场景：主路径

- Given 列表加载完成（无论是否截断）
- When 渲染树底部计数行
- Then 显示「共 {total} 条」（按当前筛选）；已加载不足时显示已加载 N/共 M 形态

### FR-03: 组内默认展示最新 10 条∪在线会话（既有语义不变），「加载更多」每次递增 20 条直至组内全部显示，全部显示后不再出现按钮

- 组内默认展示集**必须**保持「最新 10 条 ∪ 在线全显」既有语义；点「加载更多」**必须**使组内额外展示 +20 条（展示集 = 最新 10+extra ∪ 在线全显，保持服务端序）；展示集覆盖组内全量后**必须**移除该按钮；「显示全部」一次性展开的二态语义**禁止**保留。

#### 场景：主路径

- Given 某组 35 条会话（10 条最新之外另有在线会话 2 条在第 20、30 位）
- When 首次渲染
- Then 展示 10 条 + 2 条在线；组底「加载更多」按钮在场
- When 点击加载更多
- Then 展示集变为最新 30 条 ∪ 在线；再点一次覆盖全量 35 条且按钮消失

### FR-04: 已加载数 < 总数时提供数据层加载更多入口，点击按相同筛选参 offset 续拉（突破单次 500 上限），附加段按 id 去重防排序漂移重复

- 已加载数 < 服务端总数时**必须**提供数据层加载更多入口；点击**必须**以与首屏完全相同的筛选参 + offset=已加载数 续拉；附加段 append **必须**按 id 去重（翻页窗口排序漂移防御）；in-flight 守卫**必须**防连续点击双拉。

#### 场景：主路径

- Given 用户会话总数 800，首屏已加载 500
- When 点击树底部「加载更多会话」
- Then 以相同筛选参 offset=500 续拉下一批并追加展示；总数行更新已加载计数；拉完 800 后入口消失

### FR-05: 筛选/视图/scope 切换后组内递增计数与附加段自动重置

- 筛选（引擎 tab/状态/关联）、视图（active/归档）、scope（工作区/变更等）任一切换后**必须**清空组内递增计数与数据层附加段（旧口径数据不泄漏进新视图）。

#### 场景：主路径

- Given 已展开某组至 50 条且附加段已拉 100 条
- When 切换引擎 tab
- Then 组内回到默认 10∪在线、附加段清空、计数行显示新筛选口径总数

### FR-06: 触达测试文件全绿，新增用例覆盖上述各点；移动端列表（mobile-session-list）本次不动、口径差异在 design 声明

- 收口前**必须**跑触达测试文件并全绿；新增用例**必须**覆盖 FR-01~05；移动端列表**禁止**在本变更改动（口径差异已在 design 声明）。

#### 场景：主路径

- Given 触达 session-list-panel / session-panel-page 测试文件
- When vitest run 执行
- Then 全部通过且新用例在场

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/「session-panel-page 暂存切换发送后列表刷新」新增用例（setupPanel 注入 onSessionListRefresh 断言发送受理后被调）
FR-02: frontend/src/components/sessions/__tests__/「总数常显与已加载计数」新增用例（session-list-panel 树底部计数行断言）
FR-03: frontend/src/components/sessions/__tests__/「组内加载更多 +20 递增与全量收敛」新增用例（defaultVisibleGroupSessions/展示集纯函数 + 组件交互断言）
FR-04: frontend/src/components/sessions/__tests__/「数据层加载更多 offset 续拉与 id 去重」新增用例（listAgentSessions offset 断言 + 重叠 fixture 去重断言）
FR-05: frontend/src/components/sessions/__tests__/「筛选切换重置递增与附加段」新增用例
FR-06: frontend 触达测试文件 vitest 全量绿（收口实测）+ eslint 0 error
