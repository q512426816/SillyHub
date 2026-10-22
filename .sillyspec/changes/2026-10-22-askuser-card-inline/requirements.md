---
author: flow-machine-draft
created_at: 2026-10-22T04:04:55.020Z
---
# 需求规格（Requirements）— 2026-10-22-askuser-card-inline

## 功能需求

### FR-01: 会话页 pending AskUser 提问卡嵌入内容流渲染（非 sticky 钉顶悬浮），随日志上下滚动

- 会话页（TurnTimeline）pending AskUser 提问卡容器必须以普通文档流渲染（禁用 sticky 钉顶、悬浮背景条与 backdrop-blur 视觉框），容器位于错误横幅与轮次列表之间，随滚动容器内容上下滚动；卡片本体样式（border/bg-card/shadow）不变。

#### 场景：长日志滚动

- Given 会话存在 pending AskUser 提问且日志内容超出滚动视口
- When 用户向下滚动日志
- Then 提问卡随内容一起滚出视口（不再悬浮钉在顶部）

#### 场景：卡片位置

- Given 会话存在 pending AskUser 提问且渲染错误横幅
- When 时间线渲染
- Then 提问卡容器位于错误横幅之后、轮次列表之前（内容流顶部），无 sticky/z-10/indigo 背景条类名

### FR-02: 全部最小化时容器仍仅作挂载占位（无视觉框），右下角胶囊行为不变

- 全部 pending 卡最小化时，容器必须仅作挂载占位（className 为 undefined、无视觉框），右下角浮动胶囊的展示/点击还原/角标计数行为保持不变。

#### 场景：全部最小化

- Given 1 张 pending AskUser 提问卡展开
- When 点击卡头「最小化提问卡片」
- Then 卡片渲染 null、胶囊出现角标 1、容器无任何视觉类（既有断言 bg-indigo-50 不存在继续成立）

### FR-03: 待决策 pill 定位还原（滚顶+ring 闪烁）功能不回退

- 点击待决策 pill 还原最小化卡时，必须保持既有三步行为：无条件还原（删最小化集合）→ 滚动容器滚顶 → 容器 ring-2 ring-brand-500 闪烁 1.2s 自清；本逻辑本次仅 ref 命名与注释同步，行为零变化。

#### 场景：pill 定位还原

- Given 一张已最小化的 pending 卡与待决策 pill
- When pill 点击该 requestId（nonce 递增）
- Then 卡片还原、滚动容器滚到顶部、容器出现 ring 闪烁后 1.2s 自清

### FR-04: 受影响测试通过，tsc 零错

- 本次改动触及的测试套件必须全部通过（含本次新增/更新的容器类名断言），`tsc --noEmit` 必须零错误；禁止跑全量测试。

#### 场景：验证

- Given 改动完成
- When 运行 turn-timeline 相关受影响测试与 tsc
- Then 全绿/零错

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-timeline-dialog-minimize.test.tsx「默认展开：卡头有最小化按钮，无胶囊」（新增非 sticky 容器类名断言）
FR-02: frontend/src/components/daemon/__tests__/turn-timeline-dialog-minimize.test.tsx「最小化：卡片消失、胶囊出现角标 1、视觉框移除」
FR-03: frontend/src/components/daemon/__tests__/turn-timeline-dialog-minimize.test.tsx「还原保留已填内容：选项 + 手动输入原样恢复」（滚顶+闪烁 effect 无独立用例属既有状态，本次仅改 ref 名，行为零变化）
FR-04: frontend/src/components/daemon/__tests__/turn-timeline-dialog-minimize.test.tsx 全套件 + tsc --noEmit（命令实测）
