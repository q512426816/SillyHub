---
author: flow-machine-draft
created_at: 2026-10-15T02:17:20.398Z
---
# 需求规格（Requirements）— 2026-10-15-graph-type-cluster

## 功能需求

### FR-01: 切片力场新增同类型内聚力——同类聚簇、异类分块

- stepForceLayout 每步必须对每个有限坐标节点施加朝向其同类型节点组质心的弱牵引（增益为具名导出常量 TYPE_COHESION_PULL），收敛后同类型节点的类内最大离质心距离必须小于 150（世界系像素），且不同类型质心两两间距必须大于 150（聚簇可辨）。

#### 场景：交错网格收敛聚簇

- Given 18 节点按 3 类型（各 6 个）交错铺满 800×600 网格、无边；
- When stepForceLayout 快进 4000 步；
- Then 每类型成员聚为一簇（类内离质心最大距离 < 150）且三类型质心两两间距 > 150。

### FR-02: 内聚力豁免面——单成员类型与 NaN 坐标零受力

- 仅含单一成员的类型（质心=自身）与坐标非有限的节点禁止被内聚力路径产生位移增量；既有单测口径（两节点异类弹簧收敛带、NaN 一步自愈中心 160 圆环、空集/dt=0 无操作）必须保持绿且断言不得修改。

#### 场景：异类两节点与 NaN 自愈不受扰

- Given 一个 module 节点与一个 project 节点（异类）外加一个 NaN 坐标 file 节点；
- When 步进力场；
- Then NaN 节点复位到中心半径 160 圆环，异类两节点不受任何内聚力影响（两者各自为单成员类型），既有断言原样通过。

### FR-03: 既有交互与引擎语义不变

- 本变更禁止改动拖拽钉位、forceSettled 收敛截止、shouldAutoRefit 自动 re-fit、FORCE_NODE_LIMIT>200 静态降级与 full 模式（不跑力场）的既有行为与导出签名；变化仅限 stepForceLayout 内部力的组成。

#### 场景：回归面全绿

- Given graph-canvas.test.ts 与 knowledge-graph-page.test.tsx 既有用例不改断言；
- When 实现落地后运行两文件；
- Then 全部用例通过。

### FR-04: 常量导出与聚簇断言单测

- 内聚力增益必须以具名导出常量 TYPE_COHESION_PULL 提供（单测消费面）；聚簇断言单测必须同时包含类内紧（spread 上限）与类间分（质心间距下限）双断言；本次仅运行本改动相关测试（graph-canvas.test.ts + knowledge-graph-page.test.tsx），全量留给 CI。

#### 场景：单测钉死

- Given 新增单测文件用例组；
- When 运行；
- Then 常量导出断言、聚簇双断言、豁免断言全部通过。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「类型内聚力：交错网格收敛后类内紧+类间分」
FR-02: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「类型内聚力：单成员类型与 NaN 坐标豁免（既有自愈口径不变）」
FR-03: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts 全部既有用例（不改断言）+ frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx
FR-04: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「类型内聚力：增益常量具名导出」
