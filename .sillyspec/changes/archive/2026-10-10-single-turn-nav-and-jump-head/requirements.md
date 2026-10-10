---
author: flow-machine-draft
created_at: 2026-10-10T09:06:23.767Z
---
# 需求规格（Requirements）— 2026-10-10-single-turn-nav-and-jump-head

## 功能需求

### FR-01: 单轮会话（1 条轮目）左侧轮次导航可见，显示该轮并可点击定位

- 桌面端 `TurnNavList` 与回退组件 `TurnCatalog` 的隐藏阈值必须从「entries < 3 整条不渲染」放宽为「entries < 1（空）不渲染」——单轮会话也能看到「第 1 轮」导航并可点击触发既有 `onJump` 跳转定位。

#### 场景：单轮会话导航可见

- Given 一个只有 1 个 run 的会话，轮次大纲返回 1 条
- When 打开会话详情页
- Then 左侧轮次导航渲染，显示「第1轮」（含运行中状态点），点击触发跳转定位，不再整条隐藏

#### 场景：空轮次仍不渲染

- Given 轮次大纲与本地 runs 均为空（tool_report 未接手会话等）
- When 打开会话详情页
- Then 桌面端窄轨导航保持不渲染（空壳无导航价值），移动端 Drawer 显示既有「暂无轮次」空态

### FR-02: 桌面 TurnNavList 与移动端 Drawer 轮次导航行为一致（空态文案不回归）

- 移动端 Drawer 轮次列表数据源与桌面同源（navEntries），本次不得引入新的分叉；移动端「暂无轮次」空态文案与出现条件必须保持不变。

#### 场景：移动端一致性

- Given 同一单轮会话
- When 移动端打开轮次导航 Drawer
- Then Drawer 内显示与桌面相同的那 1 条轮目（第1轮 + 摘要），点击走同一 `handleJumpToTurn`

### FR-03: 时间线顶部在还有更早历史时提供「回到会话开头」入口，点击后程序化连续翻页直至游标到头，并定位到最早内容

- `hasEarlier=true` 时时间线顶部必须显示「回到会话开头」入口；点击后必须以既有 `loadEarlierOnce` 翻页链路连续加载更早历史（40ms 轮询推进，单次在途不重发），直至游标到头（`hasEarlier=false`）或达到既有 `JUMP_LOAD_EARLIER_MAX_PAGES=50` 页上限（toast 提示可再点继续）；完成后必须清除 prepend 滚动锚并定位滚动到时间线最顶部。

#### 场景：点击直达开头

- Given 会话总日志 3 页（首屏 1 页已加载，`hasEarlier=true`）
- When 点击「回到会话开头」
- Then 以 before 游标连续发起 2 次翻页请求且游标单调递减，`hasEarlier` 翻 false 后滚动容器 `scrollTo(0)`，更早内容在时间线顶部可见

#### 场景：页上限兜底

- Given 会话历史超过 50 页
- When 点击「回到会话开头」
- Then 连续加载 50 页后停止并 toast「可再次点击继续加载」，不无限请求

### FR-04: 连续加载期间有可见 loading 状态；到头后入口消失

- 连续加载期间入口必须显示加载中状态（转圈 + 文案），完成后恢复；`hasEarlier=false`（已到头）时入口必须整体消失；换会话/组件卸载时加载状态必须复位，不得残留。

#### 场景：loading 可见与消失

- Given 点击「回到会话开头」后翻页请求在途
- Then 入口显示「正在加载」态；全部到头后入口不再渲染（`hasEarlier=false`）

### FR-05: 既有触顶翻页/跳转/贴底跟随相关测试全部保持通过

- 必须保持 `session-history-scroll.test.tsx`、`turn-nav-list.test.tsx`、`turn-catalog.test.tsx` 等既有用例通过；`turn-catalog` 的「短会话隐藏」用例随阈值放宽同步改写（0 条隐藏 / 1 条起出现），其余断言不得改动。

#### 场景：回归

- Given 本次改动合入
- When 运行上述测试文件
- Then 除按 FR-01 明确改写的隐藏阈值用例外全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「单轮（1 条）entries 渲染导航并可点击跳转」
FR-02: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「0 条 entries 不渲染导航（空态语义保持）」
FR-03: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx「点击回到会话开头：连续 before 翻页到头并定位顶部」
FR-04: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx「回到会话开头 loading 态与到头后入口消失」
FR-05: frontend/src/components/sessions/__tests__/turn-catalog.test.tsx「隐藏阈值改写：0 条隐藏 / 1 条起出现」
