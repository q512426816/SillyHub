---
author: flow-machine-draft
created_at: 2026-10-15T06:06:16.365Z
---
# 需求规格（Requirements）— 2026-10-15-session-status-dot-semantics

## 功能需求

### FR-01: 行首状态点单一源判定：failed→红点；ended→绿点；活性 working→动态转圈；活性 blocked→琥珀点；reconnecting→动态转圈；其余（active 空闲/pending/suspended/活性 idle/unknown/无活性数据）→零渲染留白

- 会话列表行首状态槽必须按单一源函数 `sessionStatusIndicator(status, 活性state)` 渲染：failed 显示红点（异常失败）、ended 显示绿点（执行完成）、活性 working 显示动态转圈（正在执行）、活性 blocked 显示琥珀点（在等你）、reconnecting 显示动态转圈（恢复中）；上述之外的组合（active 空闲/pending/suspended/活性 idle/unknown/无活性数据）禁止渲染任何可见标识（槽透明留白）。

#### 场景：主路径

- Given 会话 status=active 且活性推导 working，When 渲染行首槽，Then 出现带 aria-label「正在执行」的旋转图标，且无任何实心色点。
- Given 会话 status=ended，When 渲染，Then 行首出现 aria-label「执行完成」绿点。
- Given 会话 status=active 且无活性数据，When 渲染，Then 行首槽存在但内部零可见内容（留白）。

### FR-02: 终态权威：failed/ended 判定优先于活性信号，终态会话不因陈旧活性数据转圈或琥珀

- 终态会话（failed/ended）的行为标识必须优先于活性信号判定——即使活性数据仍为 working/blocked，failed 行禁止渲染转圈、ended 行禁止渲染转圈或琥珀点（活性只影响非终态会话）。

#### 场景：主路径

- Given 会话 status=failed 且活性=working，When 渲染，Then 行首为「异常失败」红点，禁止出现「正在执行」转圈。

### FR-03: 行尾活性小灯移除，悬停详情卡（Popover）与未读红角标迁移到行首点（有活性数据才可悬停出卡，未读角标挂行首槽右上角）

- 会话行必须只保留行首一个状态标识位（SessionStatusSlot）：原行尾活性小灯节点禁止再渲染；活性悬停详情卡平移至行首槽（仅活性 map 命中的行可悬停出卡）；活性未读红角标挂行首槽右上角。

#### 场景：主路径

- Given 行关联活性条目 state=working，When 悬停行首槽，Then 弹出组合悬停卡（状态名/静默时长/证据摘要/推导时间四行）。
- Given 活性发生 working→idle 转移，When 渲染，Then 行首槽右上角出现「有新的空闲状态未读」红角标；selected 置真后角标消失且落盘清除。

### FR-04: 批量多选模式行首槽仍为勾选框，状态点与悬停卡零渲染（与现状一致）

- 批量多选模式下，行首槽必须渲染勾选框并禁止渲染状态点/转圈/悬停卡（与本次改造前行为一致）。

#### 场景：主路径

- Given 面板处于批量多选态，When 渲染会话行，Then 行首为勾选框，无 session-status-indicator 节点。

### FR-05: 相关测试更新并通过（session-list-panel 测试 + 门户页测试涉及点），lint 通过

- 本次改动涉及的测试必须全部通过：session-list-panel.test.tsx（语义矩阵/悬停卡迁移/未读角标/完成通知）、sessions-portal.test.tsx、sessions 门户页 page.test.tsx、use-session-liveness.test.ts；改动文件 ESLint 必须零告警。

#### 场景：主路径

- When 运行上述测试文件与 ESLint，Then 全部通过（0 failed / 0 warnings）。

### FR-06: 执行完成通知（用户补充）：非终态→ended 且当前不在该会话上 → 绿色通知角标，点击进入后消失

- 会话由非终态翻转为 ended 且当前未选中该会话时，行首槽必须出现「此会话已执行完成」绿色通知角标并落盘 localStorage；用户点击/回车/深链进入该会话（selected 边沿）后角标必须消失且落盘清除（通知语义，仅提醒一次）；完成时正选中该会话或首载即 ended 的历史会话禁止误报。

#### 场景：主路径

- Given 会话 status=active 且未选中，When 列表轮询到其翻转为 ended，Then 行首槽右上出现绿色角标（aria-label「此会话已执行完成」）。
- Given 角标已亮，When selectedSessionId 置真为该会话，Then 角标消失、localStorage 键清除、绿点本体保留。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「行首状态槽语义（2026-10-15-session-status-dot-semantics）」describe 全部用例（failed/ended/working/blocked/reconnecting/留白矩阵）
FR-02: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「failed → 红点（异常失败）；活性 working 不覆盖（终态权威）」+「ended → 绿点；活性数据不改变终态展示」
FR-03: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「活性未读红角标（原行尾小灯迁入行首槽）」describe + 「活性命中：整槽包 Popover…」
FR-04: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx 既有批量多选用例组（批量模式行首为勾选框）——批量删除/导出 describe 内行级断言
FR-05: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx（110 用例）+ sessions-portal.test.tsx + (dashboard)/sessions/page.test.tsx + use-session-liveness.test.ts；ESLint --file 两改动文件零告警
FR-06: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「执行完成通知（2026-10-15 用户补充…）」describe 全部用例
