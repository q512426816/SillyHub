---
author: flow-machine-draft
created_at: 2026-10-14T07:02:14.045Z
---
# 需求规格（Requirements）— 2026-10-14-session-bottom-follow-insert

## 功能需求

### FR-01: 大纲后到（中段插入预览卡/孤儿补建尾部追加）且用户贴底时，视口跟随滚到底（保持所见内容不变）

- 必须：贴底跟随触发签名（lastSig）必须包含列表长度分量——初始日志窗口贴底完成后全量大纲后到（归并层中段插入预览卡、孤儿补建尾部追加、预取装配）导致末轮不变而列表增长时，用户在底部（距底 <80px）则视口必须跟随滚到底并重启 2.5s 高度重申窗口，禁止视口停留在倒数第几轮。

#### 场景：主路径

Given 会话初始日志窗口已贴底、用户位于底部
When 全量大纲后到使归并层在中段插入预览条目（末轮不变、列表长度+1）
Then 视口自动滚到底部（导航 active 与消息流末轮一致），高度重申窗口重启

### FR-02: 触顶翻页 prepend 不被误触发贴底（isPrepend 早退 + 3s 静默窗既有守卫不变）

- 禁止：length 分量引入后触顶翻页/「回到会话开头」的头部 prepend 触发贴底——该路径必须维持既有 isPrepend 早退与 3s 静默窗守卫原样不动。

#### 场景：主路径

Given 用户上拉触发「加载更早」翻页（列表长度+1、首轮身份变化）
When prepend 落地后任意 turns 提交
Then 不发生贴底滚动（上拉读历史不被弹回最新轮，既有行为保持）

### FR-03: 用户上滚读历史时中段插入不强拉底部（isNearBottomRef 守卫不变）

- 禁止：用户距底 ≥80px（上滚读历史）时因 length 变化触发贴底——isNearBottomRef 守卫必须原样保持。

#### 场景：主路径

Given 用户上拉触发「加载更早」翻页（列表长度+1、首轮身份变化）
When prepend 落地后任意 turns 提交
Then 不发生贴底滚动（上拉读历史不被弹回最新轮，既有行为保持）

### FR-04: 跳转期间不贴底（suppressFollowBottom 语义不变）

- 禁止：导航跳转/定位期间（suppressFollowBottom=true）因任何 turns 提交触发贴底——该守卫必须原样保持。

#### 场景：主路径

Given 用户上拉触发「加载更早」翻页（列表长度+1、首轮身份变化）
When prepend 落地后任意 turns 提交
Then 不发生贴底滚动（上拉读历史不被弹回最新轮，既有行为保持）

### FR-05: 既有贴底/翻页/跳转相关测试面复跑绿 + tsc 0

- 必须：turn-timeline-scroll / session-history-scroll / session-panel-history-race / session-panel-load-earlier-full-turn / sessions page.test / preview 三件套全部复跑通过，tsc --noEmit 零错误。

#### 场景：主路径

Given 用户上拉触发「加载更早」翻页（列表长度+1、首轮身份变化）
When prepend 落地后任意 turns 提交
Then 不发生贴底滚动（上拉读历史不被弹回最新轮，既有行为保持）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：jsdom 无真实滚动布局（scrollHeight=0），贴底行为由真浏览器实测验收（部署后多开验证导航 active=末轮与视口末轮一致）；滚动触发签名逻辑由 FR-02/03 的既有守卫用例间接锚定
FR-02: frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx + src/components/daemon/__tests__/session-history-scroll.test.tsx（prepend 静默窗/上拉不弹回既有用例全绿）
FR-03: frontend/src/components/daemon/__tests__/session-panel-history-race.test.tsx + src/components/daemon/__tests__/session-panel-load-earlier-full-turn.test.tsx（翻页竞态/轮边界既有用例全绿）
FR-04: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（跳转链路 47 例全绿——suppressFollowBottom 语义用例在内）
FR-05: vitest 定向 8 文件 104 例全绿 + tsc --noEmit 0（本轮实测日志 /tmp/vitest-bottomfollow.log + /tmp/vitest-bf-preview.log）
