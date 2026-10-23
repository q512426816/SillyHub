---
author: flow-machine-draft
created_at: 2026-10-23T02:13:53.695Z
---
# 需求规格（Requirements）— 2026-10-23-marquee-ticker-speed

## 功能需求

### FR-01: .sh-live-marquee-ticker 单圈时长由 8s 缩短到 3s，内部文本滚动速度明显提升

- `.sh-live-marquee-ticker` 的 animation-duration **必须**由 `8s` 改为 `3s`，内部文本滚动速度约提升到原来的 2.7 倍。
- 仅调整条目内部文本滚动；轨道整体推进速度、追平即停、只流到最新等行为**禁止**变化。
- `prefers-reduced-motion: reduce` 下**必须**继续保持 `animation: none`，不恢复滚动。
- 现有跑马灯测试**必须**不回归；lint / typecheck **必须**通过。

#### 场景：运行中条目

- Given 条目处于 running，文本长于窗口
- When 观察条目内部文本
- Then 文本明显更快地向左循环，约 3 秒一圈

#### 场景：减少动态效果

- Given 系统开启减少动态效果
- When 渲染 running 条目
- Then 文本仍静态截断，无滚动动画

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「运行中条目渲染 lucide 图标与转圈，文本区带内部滚动（FR-01）」+「reduced-motion 下静态展示最新一条，不渲染滚动轨道（FR-05）」（纯 CSS 时长调整，用例不依赖具体秒数；整文件 22 用例回归通过）
