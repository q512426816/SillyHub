---
author: WhaleFall
created_at: 2026-10-14 06:20:49
---
# 需求规格（Requirements）— 2026-10-14-session-preview-defect-fixes

## 功能需求

### FR-01: 额度失败轮（有 prompt 无 output）点击预览卡/导航后原位展开：用户消息气泡 + 失败详情卡（error_detail 注入），预览卡被替换无双块

- 必须：单轮内容判定（anyBody/hasBody/loadedHasBody 共 5 处）把非空 prompt（用户消息气泡）计为可渲染正文；额度耗尽失败轮（日志含 user_input 无答复）点击后必须经单轮直达 prepend 装配块并由 runs 快照 error_detail 注入失败详情卡，禁止被零正文幂等黑名单拦截成无响应。

#### 场景：主路径

Given 会话大纲含未加载失败轮（run 日志仅有 user_input 行）
When 用户点击该轮预览卡或导航刻度
Then 单轮直达发起且恰一次，装配块进入消息流（用户消息气泡可见），预览卡消失无双块，重复点击不再发起请求

### FR-02: 真零正文轮（无 prompt 无 output，群聊空 user_input）幂等语义不变：首次直达后重复点击仍不重复请求不重复 prepend

- 禁止：prompt 为空串/空白时因新判定口径被放行——真零正文轮（prompt 与 output 双空）必须维持 2026-09-29 幂等语义（首次直达记标记，后续点击短路，不重复请求不重复 prepend）。

#### 场景：主路径

Given 未加载轮的日志装配产物 prompt="" 且 output="" 且无 segments
When 首次点击后再次点击
Then 该轮 run_id 请求总数保持 1，消息流无该轮重复块，预览卡保持原位

### FR-03: 已加载块 RoundDivider 轮号 = 大纲权威 seq（初始窗口/直达/预取/翻页四路径一致），与预览卡/导航轮号对齐

- 必须：归并层（mergePreviewIntoDisplayTurns）把大纲条目 seq 盖章到命中的已加载块 turn 字段（批次局部编号与权威轮序错位时以大纲为准）。

#### 场景：主路径

Given logsToTurns 批次局部编号（如初始窗口末块=12、单轮直达恒 1）与大纲 seq 不一致
When displayTurns 派生
Then 已加载块轮号 = 大纲 seq，与同屏预览卡/导航刻度轮号一致

### FR-04: 盖章不击穿 TurnRow memo（同输入重复派生保持同引用）

- 必须：盖章产物按原 turn 引用经 WeakMap 缓存（同输入重复派生保持同引用，流式期间不因盖章全量克隆击穿行 memo）；seq 已一致时必须透传原引用零克隆。

#### 场景：主路径

Given 同一已加载块引用连续两次进入归并派生
When 取输出
Then 两次输出中该块的引用相同（===）

### FR-05: 既有 preview 相关测试面复跑绿 + 新增失败轮展开/轮号盖章用例绿 + tsc 0

- 必须：preview-merge / turn-preview-card / session-preview-integration / session-history-scroll / turn-nav-list / turn-catalog / session-panel-pre-session / sessions page.test 全部复跑通过，tsc --noEmit 零错误。

#### 场景：主路径

Given 修复代码合入
When 跑上述定向测试面
Then 全部通过（含新增用例：盖章 3 例 + 失败轮展开/真零正文幂等 2 例）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx「defect-fixes：额度失败轮（仅 user_input 无答复）点导航原位展开用户消息，且重复点击不重复请求」
FR-02: frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx「defect-fixes：真零正文轮（无 user_input 无答复）幂等语义不变——不展开不重复请求」
FR-03: frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts「已加载块轮号与大纲 seq 不一致时盖章为 seq（logsToTurns 批次局部编号对齐权威轮序）」
FR-04: frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts「盖章引用稳定：同输入重复派生保持同引用（不击穿 TurnRow memo）」+「轮号已一致时透传原引用（零克隆）」
FR-05: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx「task-01/02（2026-09-29-jump-empty-turn-dup）零正文轮二次点击不重复单轮直达 prepend（口径修正后复绿）」+ vitest 定向 8 文件 162 例全绿 + tsc 0
