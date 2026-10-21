---
author: flow-machine-draft
created_at: 2026-10-20T01:13:17.189Z
---
# 需求规格（Requirements）— 2026-10-20-pill-dock-drag-align-keep

## 功能需求

### FR-01: 左停靠的组拖拽过程中内容保持左对齐,不再翻回右对齐;右停靠同理保持右对齐

- 拖拽过程中,停靠组内容必须保持拖拽前(最近吸附态)的对齐方向;拖拽中间态禁止因缺少吸附侧标记而回落为固定右对齐。对齐方向的切换只允许发生在松手吸附判定时。

#### 场景：主路径

- Given: 停靠组吸附在左边缘(内容 items-start 左对齐)
- When: 用户按住开始拖拽(位移超过阈值,组跟手移动中)
- Then: 组内 pill 保持 items-start 左对齐,不翻回 items-end

#### 场景：右停靠拖拽不受影响

- Given: 停靠组吸附在右边缘(内容 items-end 右对齐)
- When: 拖拽移动中
- Then: 保持 items-end 右对齐

### FR-02: 松手吸附后仍按吸附侧正确切换对齐(既有行为不变)

- 松手吸附(含 pointercancel 同款收尾)后,对齐方向必须由 snapPos 按吸附侧重新判定;既有吸附/持久化/刷新恢复行为必须零回归。

#### 场景：主路径

- Given: 左停靠的组被拖到右半边松手
- When: 吸附完成
- Then: 内容切换为 items-end 右对齐(对齐随吸附侧切换,拖拽中的保持不延续到松手后)

### FR-03: dock 测试全绿(新增拖拽中对齐保持断言)

- 既有 dock 全部用例必须保持通过,新增拖拽中对齐保持断言(左停靠拖拽中 items-start、右停靠拖拽中 items-end)必须通过。

#### 场景：主路径

- Given: 本变更代码就位
- When: 运行 `session-floating-pill-dock.test.tsx` 全量用例
- Then: 全部用例绿

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「左停靠拖拽过程中保持左对齐(新增:吸附左后二次拖拽中断言 items-start)」「按住拖动超过阈值…(补拖拽中 items-end 断言)」
FR-02: frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「左停靠拖拽过程中保持左对齐(用例尾段:拖回右半边松手吸附后切 items-end)」及既有吸附/恢复用例回归
FR-03: frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「全量用例(含既有 12 例回归)」
