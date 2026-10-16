---
author: flow-machine-draft
created_at: 2026-10-16T06:31:11.228Z
---
# 需求规格（Requirements）— 2026-10-16-session-pill-dock-drag

## 功能需求

### FR-01: 待决策 pill 与变更文件 pill 渲染在同一悬浮组内竖向排列，各自空数据不渲染的显隐契约不变

- 会话面板必须把待决策 pill 与变更文件 pill 渲染在同一 portal 悬浮停靠组内竖向排列（flex-col 右对齐，fixed 定位）；两 pill 空数据时必须维持各自「不渲染零占位」契约，且 children 全空时组容器必须整组隐藏不占位不拦点击。

#### 场景：主路径

- Given 真会话（sessionId 非空）且两 pill 数据就绪 / When 会话面板渲染 / Then 两 pill 在同一 `session-pill-dock` 容器内上下堆叠、右对齐，fixed 挂 body。
- Given 待决策三类信息全空或变更文件无关联变更（data 未就绪/空） / When 对应 pill 渲染 / Then 该 pill 返回 null 零占位；两 pill 皆空时 dock 以 empty:hidden 整组不占位。

### FR-02: 两 pill 的下拉均为点击展开（hover 不触发）、再点或点外部收起

- 两 pill 的下拉必须仅由点击触发器展开（禁止 hover 触发）；展开后必须支持再点触发器或点击外部收起。

#### 场景：主路径

- Given pill 已渲染 / When 鼠标移入触发器 / Then 下拉不弹出。
- Given pill 已渲染 / When 点击触发器 / Then 下拉展开（待决策分组/变更分组内容可见）；再点触发器或点击外部 / Then 下拉收起。

### FR-03: 悬浮组按住可在 viewport 范围内拖动，松手自动吸附较近的左右边界，纵向钳制在窗口内，位置 localStorage 持久化

- 悬浮组必须支持按住拖动，拖动位置必须钳制在边界范围内；松手时必须吸附到较近的左右边缘（留白 EDGE_GAP=16px）、纵向仅钳回边界内；吸附位必须持久化到 localStorage 键 `sillyhub:session-pill-dock`，刷新后必须恢复该位置；视口缩放时必须钳回并保持吸附侧。**边界范围（2026-10-16 用户追加）**：会话页必须以聊天时间线容器（`[data-testid="turn-timeline-scroll"]` 矩形）为拖拽/钳制/吸附边界，贴边禁止越过聊天区（压到侧栏/输入条/页头）；边界元素未挂载时逐次回落视口口径，元素出现后自动收敛回容器内。

#### 场景：主路径

- Given dock 已渲染（聊天区矩形 100..500×50..350）/ When 按住拖动超过阈值到左半屏松手 / Then 位置吸附容器左缘（left=116px=100+16）并写入 localStorage；刷新页面后仍在容器左缘同位。
- Given dock 停靠容器右缘 / When 侧栏开合/视口变化使容器变宽（resize） / Then 钳回容器内且仍吸附容器右缘。

### FR-04: 位移小于阈值视为点击不触发拖拽，拖拽结束后的残余 click 被吞掉，pill 按钮点击行为不受影响

- 按压位移小于 6px 必须视为点击（不进入拖拽、click 正常放行给 pill 按钮）；拖拽结束后 250ms 内的残余 click 必须被吞除，不得误开 pill 下拉。

#### 场景：主路径

- Given pill 按钮 / When 按下后位移 2px 松开再点击 / Then 按钮 onClick 正常触发。
- Given 刚结束一次拖拽（250ms 内） / When 松手后的残余 click 到达 / Then click 被捕获阶段拦截，下拉不弹；时间窗外点击恢复正常。

### FR-05: 相关组件测试与 tsc 通过

- 本变更触及的三个组件测试文件（session-floating-pill-dock / session-decisions-hover / session-change-files-hover）必须全绿，`pnpm -C frontend typecheck` 必须零错误。

#### 场景：主路径

- Given 代码改动完成 / When 运行 `pnpm -C frontend vitest run <三个测试文件>` 与 `pnpm -C frontend typecheck` / Then 全部通过、tsc 无输出退出。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「竖排停靠组：children 渲染成组（flex-col 右对齐），portal 挂 body」；显隐契约回归 test/frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx「三类全空（pending 空 + 历史空/未加载）不渲染入口（FR-01）」、test/frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「无关联变更（data 空数组/未就绪）不渲染入口」
FR-02: test/frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx「点击弹下拉（hover 不再触发）：待决策置顶（提问/Plan 徽标），已答历史默认折叠（FR-02）」；test/frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「点击弹下拉（hover 不再触发）：进行中置顶（轻量徽标+阶段），已归档默认折叠」（点外收起由 antd click trigger 内建，浏览器实测过）
FR-03: test/frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「按住拖动超过阈值：跟手且钳制窗内，松手吸附较近左缘并持久化」「拖到右半屏松手吸附右缘」「拖拽越界钳回窗内：y 不出上下边」「持久化位置恢复；损坏存档静默回落默认右下」「视口缩放：钳回窗内并保持吸附侧」（视口口径）；「默认位 / 拖拽钳制 / 松手吸附全部以边界容器矩形为准，不贴视口边」「右缘吸附同样是容器右缘（拖出容器右侧被钳回）」「边界元素不存在时回落视口口径，不报错（元素后挂载可自愈）」（边界容器口径，2026-10-16 用户追加）
FR-04: test/frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「位移小于阈值不算拖拽：click 放行给 pill 按钮」「拖拽结束后的残余 click 被吞；时间窗外恢复点击」
FR-05: test/frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx 全文件（8 用例）+ session-decisions-hover.test.tsx（12 用例）+ session-change-files-hover.test.tsx（10 用例）+ `pnpm -C frontend typecheck`（零错误）+ 浏览器实测（dev 3100 端口：竖排/点击展开/点外收起/拖拽双向吸附/刷新恢复/拖后不误弹全过）
