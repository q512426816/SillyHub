---
author: flow-machine-draft
created_at: 2026-10-16T00:58:34.017Z
---
# 需求规格（Requirements）— 2026-10-15-session-turn-completion-semantics

## 功能需求

### FR-01: 活性由 working/blocked 转移到 idle 且当前不在该会话上 → 行首亮绿点+完成角标（aria-label 此会话已执行完成），点击进入后角标与绿点消失（空闲回归留白）

- use-session-liveness 的转移检测必须在活性由 working/blocked 翻转为 idle 时写完成通知标记（`sillyhub:session-completed-unread:<id>`），会话行必须随之显示绿色「执行完成」点 + 绿色完成角标；用户点击/回车/深链进入该会话（selected 边沿）后角标与绿点必须一并消失（已读空闲回归留白）。

#### 场景：主路径

- Given 会话活性上一轮为 working，When 下一轮轮询到 idle，Then 行首出现绿点（aria-label「执行完成」）与绿角标（aria-label「此会话已执行完成」），完成键落盘。
- Given 绿点+角标已亮，When selectedSessionId 置真为该会话，Then 两者消失、完成键清除、行首槽回归留白。

### FR-02: 会话终态 ended 的完成通知（上一变更 FR-06）保留，与轮次完成共用同一落盘键与同一角标

- 会话状态非终态→ended 的完成通知检测必须保留（面板层），且与轮次完成来源共用同一 localStorage 键与同一绿色角标（完成通知存储必须单一源 lib/session-completed-unread）。

#### 场景：主路径

- Given 会话 status=active 且未选中，When 列表轮询到其翻为 ended，Then 行首绿点+绿角标出现（同一键落盘）——与轮次完成来源视觉无差别。

### FR-03: 原红色「有新的空闲状态未读」角标退役——working/blocked→idle 的提醒统一为绿色执行完成语义

- 红色「空闲未读」标识管线必须整体移除（hook 的 isUnread/clearUnread 导出、面板的 livenessUnread 管线、行首槽红色角标），working/blocked→idle 的提醒必须只以绿色执行完成语义呈现。

#### 场景：主路径

- When 渲染任意会话行，Then 行首槽禁止出现 aria-label「有新的空闲状态未读」节点；hook 模块禁止再导出 isUnread/clearUnread。

### FR-04: 完成时正选中该会话不标记（两个来源一致）；历史空闲（首见即 idle 无转移基线）不误报

- 两个完成来源在「当前正选中该会话」时都必须跳过标记（hook 走 suppress 谓词、面板终态检测走 selectedSessionId 判等）；首见即 idle（无 prevState 转移基线）不得标记。

#### 场景：主路径

- Given 面板 selectedSessionId 指向会话 X，When X 的活性 working→idle 转移到达，Then 完成键不写、无角标。
- Given localStorage 无某会话 state 键，When 首轮活性数据即 idle，Then 完成键不写。

### FR-05: 相关测试更新全过（session-list-panel + use-session-liveness），lint 零告警

- 改动涉及的测试必须全部通过：session-list-panel.test.tsx、use-session-liveness.test.ts、sessions-portal.test.tsx、sessions 门户页 page.test.tsx；改动文件 ESLint 必须零告警。

#### 场景：主路径

- When 运行上述测试与 ESLint，Then 全部通过（0 failed / 0 warnings）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/hooks/__tests__/use-session-liveness.test.ts「working→idle：写轮次完成标记」+ frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「绿点+完成角标出现」「点击进入…消失（空闲回归留白）」「active + 活性 idle + 完成标记…→ 绿点 + 完成角标」
FR-02: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「执行完成通知（2026-10-15 用户补充：非终态→ended 且不在该会话上）」describe 全部用例
FR-03: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「active 空闲（无活性数据）→ 留白」等矩阵用例（无红色未读节点断言）+ use-session-liveness.test.ts 转移检测 describe（断言改完成键）
FR-04: frontend/src/hooks/__tests__/use-session-liveness.test.ts「suppress 谓词命中」「首见（无 prevState）→idle：不写完成标记」+ session-list-panel.test.tsx「首见不标」「完成时正选中该会话（用户就在其上）→ 不标记不亮角标」
FR-05: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx（113 用例）+ use-session-liveness.test.ts + sessions-portal.test.tsx + page.test.tsx；ESLint --file 改动文件零告警
