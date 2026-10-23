---
author: flow-machine-draft
created_at: 2026-10-23T03:30:49.001Z
---
# 需求规格（Requirements）— 2026-10-23-marquee-motion-polish

## 功能需求

### FR-01: 轨道推进改为接近目标时自然减速（缓出），不再线性急停；事件密集时仍能加速追赶

- 轨道速度**必须**由「基础速度 + 距离系数」改为以距离主导的缓出曲线：距离大时加速追赶，距离趋近 0 时减速吸附；**禁止**保持恒定基础速度直到目标前急停。
- 速度公式**必须**抽成可测纯函数 `marqueeSpeedForDistance(distance)`（下限约 40px/s、上限沿用 1600px/s）。
- 事件密集（距离持续增大）时**必须**仍能追平，不得因减速曲线导致永久滞后。

#### 场景：单条事件后的推进

- Given 轨道距目标约 228px（新增一条）
- When 下一帧推进
- Then 速度约 205px/s，并随距离缩小逐步减速，约 1.1s 平滑到位

#### 场景：事件爆发

- Given 追赶距离持续增大
- When 计算速度
- Then 速度升到上限附近快速追平，不产生无限积压

### FR-02: 条目内部滚动窗口左右各加约 10px 渐隐遮罩，文本进出柔和；滚动速度维持约 3s 一圈

- 运行中条目的文本窗口**必须**加左右各约 10px 的渐隐遮罩（mask gradient），让文字进出边缘柔和；完成态截断文本**禁止**加遮罩（保持可读）。
- 内部滚动**必须**维持约 3s 一圈（上次用户确认的提速后节奏）。
- 图标、转圈、耗时区**禁止**参与遮罩/滚动。

#### 场景：运行中滚动

- Given 条目 running 且文本长于窗口
- When 文本循环滚动
- Then 文字从右侧渐入、左侧渐出，不出现硬切边

#### 场景：完成后

- Given 条目变为 done
- When 渲染截断文本
- Then 文本左右边缘清晰可读，无遮罩淡化

### FR-03: 容器流光改为更窄、更低对比、带模糊、更慢（不少于 6s）的柔和扫过，消除色块感

- 流光宽度**必须**收窄至容器约 20~24%，**必须**加模糊（如 `filter: blur(6px)`），颜色透明度**必须**降低。
- 动画周期**必须**≥ 6s，并在大部分周期内保持隐藏，扫过时缓慢淡入淡出；**禁止**呈现为明显移动色块。
- 流光**禁止**影响文字可读性（位于文字下层或极低对比）。

#### 场景：空闲态

- Given 轨道已停在最新条
- When 观察容器
- Then 一道很淡的柔光缓慢扫过，不扎眼、不遮字

### FR-04: prefers-reduced-motion 下新增动效全部关闭，reduced 静态展示不变

- `prefers-reduced-motion: reduce` 下流光与条目内部滚动**必须**保持关闭；新增遮罩**禁止**影响静态可读性。
- reduced 下静态展示最新条的行为**必须**保持不变。

#### 场景：减少动态效果

- Given 系统开启减少动态效果
- When 渲染跑马灯
- Then 无流光、无内部滚动，文本静态可读

### FR-05: 现有跑马灯 22 用例通过，lint / typecheck 通过

- 现有 22 个用例**必须**全部通过；新增速度纯函数**必须**有单测。
- 前端 lint / typecheck **必须**通过。

#### 场景：交付核验

- Given 完成实现
- When 运行相关测试与 lint
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「轨道速度随距离缓出，接近目标时减速（FR-01）」
FR-02: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「运行中条目渲染 lucide 图标与转圈，文本区带内部滚动（FR-01）」+「完成条目显示 Timer 图标与耗时（FR-02）」（结构性断言：running 带滚动窗口类，完成态不带）
FR-03: 不适用：纯 CSS 流光参数调整（宽度/模糊/周期），jsdom 不渲染动画；已用真码原型目视核验
FR-04: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「reduced-motion 下静态展示最新一条，不渲染滚动轨道（FR-05）」
FR-05: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx 整文件 23 用例通过（原 22 + 新增速度用例）；lint / typecheck 另行核验
