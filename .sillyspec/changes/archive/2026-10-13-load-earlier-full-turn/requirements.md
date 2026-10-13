---
author: flow-machine-draft
created_at: 2026-10-13T10:00:15.718Z
---
# 需求规格（Requirements）— 2026-10-13-load-earlier-full-turn

## 功能需求

### FR-01: 触顶加载一页后，若页顶边界切在轮中间，该轮被完整加载（拉全整轮行并合并装配成一个轮块，含提问）

- 翻页拉回满页且页顶最旧行的紧邻更早行（limit=1 探查）与其同 run 时，系统必须
  以 run_id 直达拉整轮行替换当页该轮行装配，使该轮以单个完整块（含提问）prepend；
  到头（不满页 / 探查无行）时禁止再发探查或直达请求。

#### 场景：主路径

Given 初始窗口满页且翻页页满页、页顶最旧行与其紧邻更早行同 run，When 触顶触发
「加载更早」，Then 该轮提问与全部输出出现在单个轮块内，页内原该轮行不双显。

### FR-02: 回到会话开头到头后，顶部第一轮完整（跨页/跨窗口边界的轮合并为单块显示）

- 「回到会话开头」循环翻页复用同一轮边界对齐链路（loadEarlierOnce →
  handleLoadEarlier），到头（hasEarlier=false）后顶部最早轮必须为完整单块；
  循环页数上限（50 页）与 toast 口径保持既有行为不变。

#### 场景：主路径

Given 会话历史跨多页且存在跨边界轮，When 点击「回到会话开头」到头，Then 顶部
第一轮含提问完整呈现，无同轮分裂双块。

### FR-03: 跨「已加载窗口与翻页页」边界的轮同样合并，不再出现同轮分裂双块

- 翻页页轮集合与已加载窗口终态轮集合有交集时，系统必须对交集中的每个轮执行整轮
  直达替换并摘除窗口内同轮终态旧块；运行中（非终态）轮禁止进入合并集合。

#### 场景：主路径

Given 轮 A 的后半段在已加载窗口（终态块）、前半段在翻页页内，When 触顶加载，
Then A 收敛为单个完整块，窗口内 A 旧块不再渲染（文本单显不双条）。

### FR-04: 直达请求失败时静默降级为现状行为（照常 prepend 当页），不报错不卡死

- run_id 直达请求失败或返回空时，系统必须只降级该轮（当页该轮行原样装配 prepend、
  不摘窗口旧块），禁止向上抛错或中断本次翻页链路。

#### 场景：主路径

Given 跨界轮的直达请求 reject，When 触顶加载完成，Then 当页内容照常渲染（现状
分裂显示），无报错提示、翻页游标正常推进。

### FR-05: 运行中的轮（当前 currentRunId）不做合并重建，保持现状路径

- 合并集合收集（collectCrossBoundaryRuns）必须只收终态块（TERMINAL_TURN_STATUSES），
  运行中轮禁止被直达替换或摘块，SSE 实时增量链路（upsertTurn 按 realRunId 取最末
  块）零改动。

#### 场景：主路径

Given 当前轮超长横跨窗口最旧行边界（历史段在翻页方向），When 触顶加载，Then 该轮
不进合并集合，保持现状「页内更早段独立块 prepend」行为，实时输出继续写入最末块。

### FR-06: 既有翻页/跳转/回到开头相关测试全部保持通过

- 本次变更后，既有历史翻页 / 换会话竞态 / 跳转链路 / 回到会话开头等测试套件必须
  全部通过（测试 mock 按新增 limit=1 探查请求形态适配不算行为变更）。

#### 场景：主路径

Given main 基线测试状态，When 应用本次变更，Then 除基线存量失败外无新增失败，
新增轮边界对齐用例全部通过。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/session-panel-load-earlier-full-turn.test.tsx「窗口跨界 + 页顶跨界轮直达整轮合并：提问出现、旧行单显、窗口同轮旧块被摘」
FR-02: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx「回到会话开头（2026-10-10-single-turn-nav-and-jump-head）」两用例 + FR-01 同文件合并用例（同链路轮对齐）
FR-03: frontend/src/components/daemon/__tests__/session-panel-load-earlier-full-turn.test.tsx「窗口跨界 + 页顶跨界轮直达整轮合并：提问出现、旧行单显、窗口同轮旧块被摘」（A-窗口尾部单显断言）
FR-04: frontend/src/components/daemon/__tests__/session-panel-load-earlier-full-turn.test.tsx「直达失败 → 静默降级：当页原样 prepend，不报错不卡死」
FR-05: 实现层终态闸由代码审查覆盖（collectCrossBoundaryRuns 的 TERMINAL_TURN_STATUSES 判定），无独立 GUI 用例——不适用：jsdom 模拟运行中轮跨窗口边界的 SSE 竞态夹具复杂度高，终态闸为纯函数一行判定，由 FR-01/03 用例间接覆盖装配链路
FR-06: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx（11 用例）+ session-panel-history-race.test.tsx（3 用例）+ session-panel-variant.test.tsx / turn-timeline-scroll.test.tsx（21 用例）+ src/app/(dashboard)/sessions/__tests__/page.test.tsx（47/47——基线存量失败「右击插入引用后发送」为 emoji 内嵌格式断言同步债，随本变更补齐修复，独立提交 4b969b5a5）
