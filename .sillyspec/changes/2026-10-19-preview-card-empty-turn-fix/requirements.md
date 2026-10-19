---
author: flow-machine-draft
created_at: 2026-10-19T05:48:31.294Z
---
# 需求规格（Requirements）— 2026-10-19-preview-card-empty-turn-fix

## 功能需求

### FR-01: preview-merge 归并层对「started_at 为空 + 无 error_code + previewTurnStatusOf 映射终态完成/中止族」的大纲条目不再合成预览卡：命中已加载轮/孤儿配置行时原引用透传并盖 seq，未命中时不生成条目

- 归并层必须把「started_at 为空 + error_code 为空 + 摘要双空 + previewTurnStatusOf 映射为 completed/killed 终态」的大纲条目识别为无内容终态轮（纯切换档案轮，backend inject.py silent_config_switch 建 run 刻意零日志）：命中 turns 中已加载轮/孤儿配置行时必须原引用透传并盖大纲 seq（紧凑配置行语义保留，2026-10-14 design 非目标），未命中时必须不生成任何条目；禁止为该类条目合成 preview 预览条目。

#### 场景：纯切换轮命中孤儿配置行（用户实测主路径）

- Given：会话大纲含无内容终态条目（started_at 空、摘要双空、completed），enrich 孤儿补建已为其生成带 whoLine 的紧凑配置行
- When：displayTurns 派生走 mergePreviewIntoDisplayTurns
- Then：该轮位置输出孤儿配置行原引用（盖 seq），无 preview 字段、无双块，消息流不出现 data-testid="turn-preview-card" 的该轮卡片

#### 场景：纯切换轮未命中（深历史静默轮）

- Given：会话大纲含无内容终态条目，turns 中无该 run 的任何条目（无孤儿、未加载）
- When：displayTurns 派生走 mergePreviewIntoDisplayTurns
- Then：输出列表不含该 run 的任何条目（无预览卡、无空行）

### FR-02: 失败族（status failed/error 或 error_code 非空）与活跃族（running/pending 等）大纲条目仍照旧合成预览卡，展开/跳转/预取链路行为不变

- 非无内容终态轮的大纲条目必须保持既有归并行为逐字节不变：失败族（error_code 非空或 status failed/error——失败卡是真实内容）、活跃族（running/pending 等——后续可能产出内容）、started_at 有值但摘要双空的零正文轮（群聊空 user_input 轮，2026-09-29 幂等语义）必须照旧合成预览卡；展开（handleExpandPreview）、跳转直达（handleJumpToTurn）、附近预取（prefetchNearbyTurns）链路行为禁止变化。

#### 场景：三类轮不受影响

- Given：大纲分别含 failed/error 失败条目、running 活跃条目、started_at 有值且摘要双空的 completed 条目
- When：displayTurns 派生
- Then：三者均照旧合成预览条目（preview 字段存在，状态映射不变）

### FR-03: handleExpandPreview 对 empty 结果给出 notify 轻提示（该轮无对话内容），不再纯静默；failed 提示语义不变

- handleExpandPreview 收到 fetchAndAttachTurn 的 "empty" 结果时必须调用 notify.warning 给出「该轮无对话内容」轻提示；"failed" 结果的 notify.error 语义禁止变化；幂等标记与在飞去重行为禁止变化（重复点击仍短路不重复请求）。

#### 场景：零正文轮点击有反馈

- Given：预览卡对应轮的单轮加载返回日志装配后无正文（empty）
- When：用户点击该预览卡
- Then：出现 warning 轻提示「该轮无对话内容」，预览卡保持，再次点击不重复发起请求（既有幂等语义）

### FR-04: 新增单测覆盖无内容终态条目透传与跳过两分支、error_code 轮仍出卡、running 轮仍出卡

- 必须在 preview-merge 单测新增覆盖：无内容终态条目「命中透传盖 seq」与「未命中跳过」两分支、error_code 非空轮仍出预览卡、running 轮仍出预览卡、started_at 有值零摘要轮（群聊空轮）仍出预览卡；既有 outlineItem fixture 必须对齐真实数据契约（正常轮默认带 started_at，纯切换轮显式传 null）。

#### 场景：主路径

- Given：上述五类大纲条目构造
- When：调用 mergePreviewIntoDisplayTurns
- Then：断言分别命中透传/跳过/出卡三组预期（含 seq 盖章与引用稳定性）

### FR-05: 既有 preview-merge / turn-preview-card / session-preview-integration 相关测试面全部通过，零回归

- 必须全量通过既有相关测试面：frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts、frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx、frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx（含本次新增用例）；因 fixture 补 started_at 缺省而对既有用例的调整仅限数据构造对齐，禁止改动既有断言语义。

#### 场景：主路径

- Given：本变更代码合入后
- When：运行上述三个测试文件
- Then：全部用例通过（含既有用例零语义变化）

### FR-06: 导航刻度点击无内容终态轮直接定位既有配置行（不发请求不报错）；三处固定文案 toast 改 warning 通道不再显示为「操作失败」

- handleJumpToTurn 对命中 isContentlessTerminalItem 的大纲条目必须在发起直达请求前短路：直接定位高亮既有孤儿配置行并记零正文幂等标记，禁止发起单轮请求、禁止弹任何错误/警告；「该轮次日志不存在（可能已被清理）」（直达零日志与回退翻页到头两处）与「该轮加载失败，请稍后重试」三条固定文案必须改走 notify.warning 原文展示——notify.error 收纯字符串会被 errMessage 吞成「操作失败」（errors.ts misuse guard），禁止再用字面量调 notify.error；prefetchNearbyTurns 必须跳过无内容终态邻居（不发无效请求）。

#### 场景：导航点击静默切换轮

- Given：会话大纲含无内容终态条目（started_at 空、摘要双空、completed），消息流已渲染其孤儿配置行
- When：用户点击左侧导航该轮刻度
- Then：滚动定位并高亮该配置行（双 rAF + 2.2s 自清），不发起 run_id 请求，不出现任何 toast；再次点击走幂等短路同径定位

#### 场景：真缺失日志轮（started_at 有值但查回 0 条）

- Given：大纲条目 started_at 有值（正常轮形态），run_id 直达查回 0 条日志
- When：用户点击该轮导航刻度
- Then：toast 显示「该轮次日志不存在（可能已被清理）」原文（warning 通道），不显示「操作失败」

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts「纯切换轮命中孤儿配置行原引用透传并盖 seq，不出预览卡」「纯切换轮未命中不生成条目」
FR-02: frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts「error_code 轮（started_at 空）仍出预览卡」「running 轮（started_at 空）仍出预览卡」「started_at 有值零摘要轮（群聊空轮）仍出预览卡」
FR-03: frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx「真零正文轮点击出轻提示且幂等语义不变」
FR-04: frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts「无内容终态轮」describe 块五用例（含 fixture started_at 缺省对齐）
FR-05: frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts + frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx + frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx 全量通过
FR-06: frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx「纯切换轮导航刻度点击直接定位配置行不报错不发请求」「真缺失日志轮导航点击报原文 warning 而非操作失败」
