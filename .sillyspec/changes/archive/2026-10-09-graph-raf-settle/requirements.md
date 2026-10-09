---
author: flow-machine-draft
created_at: 2026-10-09T19:50:00.000Z
---
# 需求规格（Requirements）— 2026-10-09-graph-raf-settle

## 功能需求

### FR-01: 力场收敛后停止 stepForceLayout 步进（连续帧守卫防转折点误判）

- force 引擎的 rAF 循环在「连续 FORCE_SETTLE_FRAMES（30）帧全节点位移低于 FORCE_SETTLE_EPSILON（0.25 世界像素/帧）」后必须停止调用 stepForceLayout（forceLiveRef 置 false）；单帧位移达标禁止立即判停（弹簧转折点瞬时零速误判防线）；拖拽活跃期间（dragRef 非空）禁止判静止——被拖节点步内钉死在指针处位移恒零，误停会让节点冻结不跟指针（评审 P1）。

#### 场景：页面开着不再恒耗 CPU

- Given ≤200 节点力场图布局已静止
- When 连续 30 帧位移低于阈值
- Then 步进停止（rAF 循环保留纯渲染职责，非 dirty 帧零 O(n²) 工作）

### FR-02: 收敛定格终局 fitView + tick 语义承接

- 判定收敛的那一帧，若用户未交互（userTouchedRef=false）必须执行一次终局 fitView；力场 tick 计数随步进停止不再推进（收敛跟随语义由终局 fit 承接，不缺帧）。

#### 场景：未交互的收敛定格

- Given 力场收敛且用户从未滚轮/拖拽
- When 收敛生效帧
- Then 视口适配最终布局

### FR-03: 数据重建与节点拖拽重启力场

- 数据重建 effect 与 onPointerDown 命中节点的分支必须复位 forceLiveRef=true 与连续帧计数（新布局重新演化、拖放后重收敛）；平移/缩放禁止重启力场（纯视口操作）。

#### 场景：拖放节点后重收敛

- Given 布局已静止（力场已停）
- When 用户拖起某节点
- Then 力场重启，松手后布局重新演化至再次收敛

### FR-04: 判定提取导出纯函数 forceSettled 供测试；恢复被冲掉的 shouldAutoRefit 用例

- 收敛判定必须为导出纯函数 forceSettled(nodes, maxDisp=FORCE_SETTLE_EPSILON)（NaN 坐标防御性判未静止）；测试含纯函数三态 + 与真实积分器联测（两节点弹簧步进至收敛、初期位移显著不得误判）；另恢复 knowledge-graph-fullmap 重写测试文件时丢失的 shouldAutoRefit 两个用例（组件函数仍在，钉回覆盖）。

#### 场景：相关面全绿

- Given 实现完成
- When 运行 graph-canvas.test.ts
- Then 33 用例全绿（含新增 4 + 恢复 2），tsc 0 error、eslint 0 error

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「与真实积分器联测：两节点弹簧系统步进至收敛（无截止恒耗场景可判停）」
FR-01: test/frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「收敛帧数守卫常量：连续帧数 ≥30（转折点零速误判防线）」
FR-02: test/frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「全节点位移为零（x==px）判静止；单节点位移超阈值判未静止」（判定纯函数供定格接线消费）
FR-03: test/frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「阈值参数生效：位移恰在阈值内/外两态；NaN 坐标防御性判未静止」
FR-04: test/frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「shouldAutoRefit 两用例（恢复）」
