---
author: flow-machine-draft
created_at: 2026-10-10T00:49:23.984Z
---
# 需求规格（Requirements）— 2026-10-10-att-ref-badge-hover

## 功能需求

### FR-01: 输入框内引用标签的×角标默认隐藏，鼠标移动到该标签上时才淡入显示（单聊+群聊）

- 编辑态引用标签的 × 删除角标必须默认隐藏（透明且不接收指针事件），仅当鼠标指针悬停在该标签文字区域时淡入显示；单聊输入栏与群聊输入区行为一致。

#### 场景：悬停显示

- Given 正文含引用标签且 × 角标处于隐藏态
- When 鼠标指针移到该标签文字上
- Then 该处 × 角标淡入显示，其它标签的角标保持隐藏

### FR-02: 隐藏态不拦截点击（标签区域下方 textarea 的光标定位/选字不受影响），显示态可正常点击删除

- 隐藏态的 × 角标必须不接收指针事件（pointer-events: none）——标签区域下方的 textarea 光标定位、文字选择不受任何影响；显示态角标必须可正常点击删除该处引用。

#### 场景：隐藏态点击穿透

- Given × 角标处于隐藏态
- When 用户点击标签文字区域
- Then 点击落入 textarea（光标定位正常），不触发删除

### FR-03: 指针离开标签/输入区后角标隐藏；原×删除、退格整删、删附件联动行为零回归

- 指针离开标签或整个输入区后 × 角标必须隐藏；既有交互（× 点击删除、退格整删标签、删附件联动剥离、右击插入、失焦记忆光标位）必须零回归。

#### 场景：移出隐藏

- Given 某标签 × 角标因悬停处于显示态
- When 指针移出该标签区域或整个输入区
- Then 角标隐藏

### FR-04: 相关测试全绿+tsc 零错

- 本变更全部测试必须通过且 tsc --noEmit 零错；可以只跑变更相关测试（仓库规则 0：全量留给 CI）。

#### 场景：验证通过

- Given 实现与测试就绪
- When 运行 overlay/单聊/群聊相关 vitest 与 tsc
- Then 全绿零错

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx「角标默认隐藏、visibleBadgeIndex 命中才显示」
FR-02: frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx「隐藏态角标不拦截命中测试（pointer-events 语义）+hitTest 命中展开区」
FR-03: frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx「既有×删除回调行为不变」+ session-input-bar-upload.test.tsx「× 角标删除该处一次出现；点 X 删附件联动剥离全部引用」
FR-04: frontend/components 相关 vitest 全绿 + pnpm exec tsc --noEmit 零错（verify 实测）
