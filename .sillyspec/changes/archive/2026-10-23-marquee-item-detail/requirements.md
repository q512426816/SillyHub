---
author: flow-machine-draft
created_at: 2026-10-23T01:35:34.775Z
---
# 需求规格（Requirements）— 2026-10-23-marquee-item-detail

## 功能需求

### FR-01: 运行中条目使用项目 UI 的 lucide 图标（禁止 emoji 字符串），右侧显示 CSS 转圈指示；条目内部文本在固定宽度窗口内持续向左滚动，展示文本的不同片段

- 每个条目**必须**按类型渲染 `lucide-react` 图标（思考 / 命令 / 读写 / 搜索 / 子代理 / 文件 / 警告 / 系统 / 压缩 / 用户 / 唤醒），**禁止**使用 emoji 或其它字符串充当图标。
- `status === "running"` 的条目**必须**在右侧显示 CSS 转圈指示（主题色圆环 `animate-spin`），完成/失败/中性条目**禁止**显示转圈。
- 运行中条目的文本区域**必须**在固定宽度窗口内持续向左滚动（双份内容无缝循环），让用户依次看到文本的不同片段；图标、耗时、状态指示**禁止**参与滚动。
- 文本滚动**必须**使用 CSS 动画，不引入逐帧 React 渲染。

#### 场景：长文本进行中

- Given 一条思考段正在流式增长，文本远长于条目窗口
- When 条目处于运行中
- Then 窗口内文本持续向左滚动，右侧转圈；图标固定在左侧

#### 场景：短文本进行中

- Given 运行中条目文本短于窗口
- When 条目渲染
- Then 双份文本仍以固定节奏循环，不出现空白闪烁

### FR-02: 条目完成后停止内部滚动，文本截断显示，并在右侧显示耗时（Timer 图标 + 1.5s 格式）；进行中条目不显示耗时

- 条目状态变为 `done` / `failed` 后**必须**停止内部滚动，文本单份截断显示（省略号）。
- 有耗时的完成条目**必须**在右侧显示 `Timer` 图标 + 格式化时长（如 `1.5s`、`820ms`、`1m 05s`）；进行中条目**禁止**显示耗时。
- 格式化**必须**稳定、单行、不抖动（等宽数字优先）。

#### 场景：完成显示耗时

- Given 一条工具段运行 1.5 秒后完成
- When 条目状态变为 done
- Then 文本停止滚动并截断，右侧显示「Timer 图标 1.5s」

#### 场景：进行中不显示耗时

- Given 条目仍在运行
- When 渲染条目右侧
- Then 只显示转圈，不显示任何时长

### FR-03: 工具/子代理优先使用段真实 startedAt/endedAt 计算耗时；思考段由客户端从首次运行到完成计时；历史已完成且无时长的条目不显示耗时，禁止伪造

- 工具 / 子代理段存在 `startedAt` 与 `endedAt` 时**必须**用二者差值作为耗时。
- 无可信开始/结束时刻的段（典型为 thinking），**必须**由组件在首次观察到 `running` 时记录起点、观察到完成时计算客户端时长；**禁止**用当前时刻减日志时间戳等方式伪造历史耗时。
- 挂载时已经完成、且没有 `startedAt`/`endedAt` 的条目**必须**不显示耗时（宁缺勿假）。

#### 场景：历史已完成无数据

- Given 页面加载时思考段已是完成态
- When 渲染该条目
- Then 不显示耗时，仅显示截断文本

#### 场景：实时思考计时

- Given 思考段从 running 变为 done
- When 组件观察到状态翻转
- Then 显示从首次观察到 running 到完成的客户端时长

### FR-04: 条目宽度适当加宽到 16rem；图标与耗时固定不滚动，仅文本区域滚动

- 条目**必须**使用固定宽度 `16rem`（比现 13rem 加宽），保证滚动轨道宽度稳定。
- 条目内部布局**必须**为：固定图标 + 可滚动文本区（`min-w-0 flex-1`）+ 固定状态/耗时区。
- 宽度**必须**在窄屏下不撑破轨道容器（轨道容器自身 `overflow-hidden`）。

#### 场景：条目布局

- Given 轨道渲染多条条目
- When 放大观察单条
- Then 图标与右侧指示固定，只有中间文本在滚动

### FR-05: prefers-reduced-motion 下不滚动、不转圈，静态展示最新状态

- `prefers-reduced-motion: reduce` 时**必须**关闭条目内部滚动与转圈动画，文本静态截断显示。
- 耗时显示与条目内容**禁止**因降级丢失。

#### 场景：减少动态效果

- Given 系统开启减少动态效果
- When 运行中条目渲染
- Then 无文本滚动、无旋转动画，仍显示图标/文本/耗时（如有）

### FR-06: 视觉走现有主题 token，三主题可读；相关测试更新并通过；lint / typecheck 通过

- 图标/转圈/耗时的颜色**必须**取自主题语义 token（`brand-*` / `muted-*` / `foreground` / `border`），**禁止**硬编码 hex。
- `lucide-react` 图标**必须**为单色（`currentColor`），不引入彩色 emoji。
- 现有 13 个跑马灯测试**必须**随新形态更新并通过；仅跑相关测试文件（全量留给 CI）。
- 前端 `lint` 与 `typecheck`**必须**通过。

#### 场景：交付核验

- Given 完成实现
- When 运行相关 Vitest 文件与 lint
- Then 全部通过，三主题截图可读

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「运行中条目渲染 lucide 图标与转圈，文本区域带滚动类」+「reduced-motion 下静态展示最新一条，不渲染滚动轨道（FR-05）」
FR-02: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「完成条目显示 Timer 图标与耗时，进行中不显示」
FR-03: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「工具段用真实 startedAt/endedAt 计算耗时」+「历史已完成且无时长的条目不显示耗时」
FR-04: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「条目固定 16rem 宽度，图标与耗时区不参与滚动」
FR-05: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「reduced-motion 下静态展示最新一条，不渲染滚动轨道（FR-05）」
FR-06: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「轨道按顺序完整渲染全部条目，不复制内容循环」（既有 13 用例全通过；lint / typecheck 另行核验）
