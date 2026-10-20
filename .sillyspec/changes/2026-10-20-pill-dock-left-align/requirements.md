---
author: flow-machine-draft
created_at: 2026-10-20T00:46:19.189Z
---
# 需求规格（Requirements）— 2026-10-20-pill-dock-left-align

## 功能需求

### FR-01: 拖拽吸附到边界容器左侧后,停靠组内容左对齐;吸附右侧后保持右对齐

- 悬浮 pill 停靠组吸附到左边缘时,组内 pill 必须 items-start 左对齐;吸附到右边缘时必须保持 items-end 右对齐;吸附对齐方向必须与吸附侧由同一判据(组中心在边界左/右半边)同时确定,禁止出现贴左仍右对齐。

#### 场景：主路径

- Given: 会话页停靠组停靠在右侧(默认或吸附右缘,items-end 右对齐)
- When: 用户拖拽停靠组到边界容器左半边松手,吸附到左边缘
- Then: 组内 pill 左缘对齐(items-start),吸附动画与位置行为不变(仍吸附左缘 EDGE_GAP)

#### 场景：右吸附不受影响

- Given: 停靠组拖拽到右半边松手吸附右缘
- When: 吸附完成
- Then: 组内 pill 仍右缘对齐(items-end),与既有行为一致

### FR-02: 持久化位置重载后对齐方向与吸附侧一致

- 位置持久化存档格式必须保持 `{x, y}` 两字段不变(对齐方向不入档,由吸附判据从坐标重推导);重载存档恢复后必须立即(首个渲染帧)按吸附侧呈现正确对齐方向;旧格式存档必须无缝兼容。

#### 场景：主路径

- Given: localStorage 存有左缘吸附位存档(如 `{x:16, y:40}`)
- When: 页面刷新重载
- Then: 停靠组渲染在存档位且内容左对齐(items-start),无可见的右对齐→左对齐闪动

### FR-03: 现有 dock 测试与新增断言全绿

- 全部既有 dock 测试用例必须保持通过(位置/吸附/拖拽/吞 click/边界容器行为不回归),新增的对齐断言(左吸附 items-start、右吸附/默认 items-end、存档恢复两侧)必须通过。

#### 场景：主路径

- Given: 本变更代码就位
- When: 运行 `session-floating-pill-dock.test.tsx` 全量用例
- Then: 全部用例绿

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「按住拖动超过阈值：跟手且钳制窗内，松手吸附较近左缘并持久化(新增 items-start 断言)」「拖到右半屏松手吸附右缘(新增 items-end 断言)」
FR-02: test/frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「持久化位置恢复按吸附侧呈现对齐方向(新增两侧存档恢复用例)」
FR-03: test/frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「全量用例(含既有 11 例回归)」
