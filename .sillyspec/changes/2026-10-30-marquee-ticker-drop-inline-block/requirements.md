---
author: flow-machine-draft
created_at: 2026-10-30T00:34:57.675Z
---
# 需求规格（Requirements）— 2026-10-30-marquee-ticker-drop-inline-block

## 功能需求

### FR-01: turn-live-marquee.tsx 中 marquee-ticker span 的 className 不再包含 inline-block，其余 class（sh-live-marquee-ticker whitespace-nowrap font-medium text-foreground）保持不变

- frontend/src/components/daemon/turn-live-marquee.tsx 中 data-testid="marquee-ticker" 的运行态 ticker span，其 className 必须为 "sh-live-marquee-ticker whitespace-nowrap font-medium text-foreground"，禁止再包含 inline-block。

#### 场景：主路径

- Given 会话页对话 tab 底部进度跑马灯处于运行态（running 且未 reduced motion）
- When 组件渲染 ticker span
- Then 该元素 class 列表不含 inline-block，其余四个 class 逐字保留

### FR-02: frontend 现有 turn-live-marquee 相关测试不回归

- 本改动合入后 frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx 全部现有用例必须保持通过（现有断言不感知 inline-block 的存在与否，不得因删 class 而回归）。

#### 场景：主路径

- Given main 分支上 turn-live-marquee.test.tsx 全绿
- When 删除 ticker className 中的 inline-block
- Then 同一测试文件全部用例仍通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「运行中条目渲染 lucide 图标与转圈，文本区带内部滚动（FR-01）——补 ticker class 不含 inline-block 断言」
FR-02: test/frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「turn-live-marquee.test.tsx 全量用例（本文件）回归」
