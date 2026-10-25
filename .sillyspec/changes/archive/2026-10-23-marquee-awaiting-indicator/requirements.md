---
author: flow-machine-draft
created_at: 2026-10-25T01:40:31.608Z
---
# 需求规格（Requirements）— 2026-10-23-marquee-awaiting-indicator

## 功能需求

### FR-01: 最新条目非运行中时，追加「等待模型响应 · 耗时」合成条目：带转圈、计时每秒递增

- 当且仅当最新真实条目状态为 `done` / `failed` / `neutral`（组件仅在运行中轮次被渲染，该状态即「工具已完成、下一段未到」的 LLM 生成间隙）时，**必须**在轨道末尾追加一个合成条目：lucide 图标（Sparkles）+「等待模型响应 · 耗时」+ 转圈，耗时从进入等待态起每秒递增（复用 `formatMarqueeDuration`）。
- 等待条目**必须**带 `data-testid="marquee-awaiting"` 以便测试与核验。
- 组件为空（无真实条目）时**禁止**渲染等待条目（整体仍不渲染）。

#### 场景：工具完成后的间隙

- Given 最新条目为已完成的 Bash 工具（done），轮次仍在运行
- When 渲染跑马灯
- Then 末尾出现「等待模型响应 · 1s/2s/…」条目，带转圈，每秒刷新

#### 场景：思考进行中

- Given 最新条目为 streaming 思考（running）
- When 渲染跑马灯
- Then 无等待条目（思考本身在转圈滚动）

### FR-02: 新事件到达或最新条目回到运行中时，等待条目立即消失；不进入事件队列、不影响窗口滑动

- 等待条目**必须**仅存在于渲染层（拼接在 entries 之后），**禁止**写入 `entries` / 计时 Map / 窗口滑动检测。
- 最新条目回到 running 或新的 running 条目到达时，等待条目**必须**立即消失，等待计时清零；再次进入等待态时从头计时。

#### 场景：新事件到达

- Given 等待条目正在显示
- When 新的工具段（running）到达
- Then 等待条目消失，轨道平滑推进到新条目

### FR-03: 最新条目运行中时不显示等待条目；reduced-motion 下显示静态文本（转圈静止）

- 最新条目为 running 时**必须**不渲染等待条目。
- `prefers-reduced-motion` 下等待条目**必须**仍显示（静态文本 + 静止圆环），耗时文本照常更新。

#### 场景：减少动态效果

- Given 系统开启减少动态效果且处于等待态
- When 渲染
- Then 显示「等待模型响应 · 耗时」静态条目，圆环不旋转

### FR-04: 新增出现/消失/计时断言测试，全部用例通过；lint与typecheck通过

- **必须**新增：等待条目出现（最新条 done）、不出现（最新条 running）、消失（rerender 后新 running 条目到达）。
- 全部用例（现有 26 + 新增）**必须**通过；lint / typecheck **必须**通过。

#### 场景：回归核验

- Given 完成实现
- When 运行测试与 lint
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「最新条目非运行中时出现等待模型响应条目」
FR-02: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「新事件到达后等待条目消失」
FR-03: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「最新条目运行中时无等待条目」
FR-04: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx 整文件 29 用例通过；lint / typecheck 另行核验
