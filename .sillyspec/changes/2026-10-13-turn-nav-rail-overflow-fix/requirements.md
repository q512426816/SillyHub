---
author: flow-machine-draft
created_at: 2026-10-13T06:32:14.177Z
---
# 需求规格（Requirements）— 2026-10-13-turn-nav-rail-overflow-fix

## 功能需求

### FR-01: 轮次很多(内容高超过面板高)时窄轨刻度不再溢出面板,超出部分在轨内滚动(turn-nav-rail 去掉 shrink-0,nav flex-1+overflow-y-auto 真正生效)

- 轮次条目内容总高超过窄轨可视高度时，刻度轨必须随面板高度收缩、刻度禁止溢出窄轨边界（禁止叠加到输入区/底部配置条上），超出可视区的刻度必须经轨内滚动可达。

#### 场景：主路径

Given 53 轮长会话（刻度内容高 > 面板剩余高） / When 打开会话页 desktop 面板 / Then 刻度止于聊天区底缘，全部刻度可在轨内滚动查看，输入区与底部配置条上无刻度叠加。

### FR-02: 轨内滚动不显示滚动条(与 turn-catalog 同款 scrollbar-width:none + webkit hidden)

- 刻度轨 nav 容器必须声明 `scrollbar-width:none` 与 `::-webkit-scrollbar` 隐藏（与 turn-catalog 同款），轨内滚动时禁止显示可见滚动条。

#### 场景：主路径

Given 轮次超出可视高度触发轨内滚动 / When 用户在窄轨滚动查看 / Then 轨道右缘不出现可见滚动条（44px 窄轨视觉不变）。

### FR-03: 少量轮次时形态不变(44px 窄轨+把手+居中刻度,浮层行为不受影响)

- 轮次内容总高不超过可视高度时，窄轨形态必须与修复前一致（44px 宽、把手 h-9、居中刻度、hover/pin 展开浮层行为不变）。

#### 场景：主路径

Given 3 轮短会话 / When 打开会话页 / Then 窄轨高度=内容高、刻度居中，悬停/pin 展开浮层（top-0 bottom-0 absolute）行为与修复前一致。

### FR-04: turn-nav-list 单测补齐布局契约断言(rail 无 shrink-0、nav 可滚动+滚动条隐藏),既有测试全绿

- `turn-nav-list.test.tsx` 必须包含窄轨布局契约断言（`turn-nav-rail` 无 `shrink-0`、`turn-nav-rail-ticks` 含 overflow-y-auto 与滚动条隐藏类、密集刻度阈值契约），且该文件全部既有用例保持通过。

#### 场景：主路径

Given 修复后的 turn-nav-list.tsx / When 运行 `pnpm vitest run src/components/sessions/__tests__/turn-nav-list.test.tsx` / Then 含新增 3 条契约用例在内 23/23 通过。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「turn-nav-rail 不带 shrink-0（长会话轨道可随面板高度收缩，不溢出叠到输入区）」
FR-02: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「turn-nav-rail-ticks 轨内滚动且隐藏滚动条（与 turn-catalog 同款）」
FR-03: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「密集刻度契约：>60 轮刻度 mini（h-1.5），≤60 轮常规（h-2.5）」+ 既有 hover/pin 浮层用例全绿
FR-04: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx 全文件 23 用例（20 既有 + 3 新增）
