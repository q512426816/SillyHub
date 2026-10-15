---
author: flow-machine-draft
created_at: 2026-10-14T12:28:03.940Z
---
# 需求规格（Requirements）— 2026-10-14-session-bottom-resize-observer

## 功能需求

### FR-01: ResizeObserver 观察滚动容器内容高度：任何来源的高度变化（图片/视图/懒渲染/注入）且用户在底部（isNearBottomRef=true）→ rAF 合帧 scrollTo 底，delta 保持 0

- 必须：ResizeObserver 观察滚动容器内容子元素——任何来源的内容高度变化（懒加载图片/markdown 迟渲染/content-visibility 真实化/DOM 注入）且用户在底部（isNearBottomRef=true）时，rAF 合帧 scrollTo 底保持 delta=0；禁止在重申窗（2.5s）过期后出现无修正源的高度变化。

#### 场景：主路径

（场景已并入行为句；主场景：贴底完成后 ≥6s 向容器注入 2000px 占位 → delta 保持 0）

### FR-02: 用户上滚读历史时高度变化不拉底（isNearBottomRef=false 守卫）

- 禁止：用户上滚读历史（isNearBottomRef=false）时因内容高度变化被拉回底部——守卫必须原样保持。

#### 场景：主路径

（场景已并入行为句；主场景：贴底完成后 ≥6s 向容器注入 2000px 占位 → delta 保持 0）

### FR-03: 注入复现脚本在修复后 delta 保持 0（部署前后对照取证）

- 必须：ResizeObserver 回调经 rAF 合帧去重（高频撑开风暴合并为一帧一滚），cleanup 取消挂起帧并 disconnect。

#### 场景：主路径

（场景已并入行为句；主场景：贴底完成后 ≥6s 向容器注入 2000px 占位 → delta 保持 0）

### FR-04: rAF 合帧防布局风暴（2026-10-13 layout-storm 教训：高频回调去重为一帧一滚）

- 必须：无 ResizeObserver 环境（jsdom/极旧浏览器）优雅降级不挂观测（行为回到既有重申窗兜底），不得抛错。

#### 场景：主路径

（场景已并入行为句；主场景：贴底完成后 ≥6s 向容器注入 2000px 占位 → delta 保持 0）

### FR-05: 兼容无 ResizeObserver 环境（jsdom/旧浏览器优雅降级不挂观测）

- 必须：注入复现脚本修复后 delta 保持 0（部署前后对照取证）；既有测试面复跑绿 + tsc 0。

#### 场景：主路径

（场景已并入行为句；主场景：贴底完成后 ≥6s 向容器注入 2000px 占位 → delta 保持 0）

### FR-06: 既有测试面复跑绿 + tsc 0

- 必须：审查 P2 补口——turns 空态（length=0）→非空翻转时 ResizeObserver 观察集合重快照（冷加载首挂空态 div 被内容容器替换后新容器必须落入观察，禁止死观测盲区）。

#### 场景：主路径

（场景已并入行为句；主场景：贴底完成后 ≥6s 向容器注入 2000px 占位 → delta 保持 0）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：jsdom 无 ResizeObserver 且无真实滚动布局——真浏览器注入对照取证（部署前 delta=2000 复现 / 部署后 delta=0 修复）
FR-02: frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx（上滚不拉底既有用例全绿——isNearBottomRef 守卫路径回归）
FR-03: 代码走查（rAF 合帧句柄去重 + cleanup 取消；turn-timeline.tsx ResizeObserver effect 段）
FR-04: vitest 全套在 jsdom（无 ResizeObserver）跑通即降级路径实证（96 例绿无抛错）
FR-05: vitest 定向 6 文件 96 例全绿 + tsc 0（/tmp/vitest-ro.log）+ 真浏览器注入对照
FR-06: 真浏览器冷加载注入取证（部署后：settled delta=0 + 注入 2000px 后 delta=0）；effect deps [hasTurns] 代码锚 turn-timeline.tsx ResizeObserver effect 段
