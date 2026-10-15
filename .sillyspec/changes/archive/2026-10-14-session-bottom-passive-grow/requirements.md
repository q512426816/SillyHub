---
author: flow-machine-draft
created_at: 2026-10-14T07:14:18.840Z
---
# 需求规格（Requirements）— 2026-10-14-session-bottom-passive-grow

## 功能需求

### FR-01: 被动增高（scrollHeight 增长且 scrollTop 未减少）不改变贴底判定——handleScroll 跳过 near 清零与新消息计数锚设置，仅更新基线

- 必须：handleScroll 区分被动增高（scrollHeight 增长 ≥50px 且 scrollTop 未减少 >4px）与用户上滚——被动增高不得改变贴底判定（isNearBottomRef 保持原值）、不得设置新消息计数锚，仅更新滚动基线。

#### 场景：主路径

（场景已并入各 FR 行为句下的 Given/When/Then）

### FR-02: 用户真实上滚（scrollTop 减少）照常清贴底判定（读历史不被拉底，既有行为不变）

- 禁止：用户真实上滚（scrollTop 减少）被误判为被动增高——该路径必须照常清贴底判定（读历史不被拉底，既有行为不变）。

#### 场景：主路径

（场景已并入各 FR 行为句下的 Given/When/Then）

### FR-03: 真实上滚后的内容增长（读历史时后台预取插入）不恢复贴底（near 保持 false）

- 禁止：用户已上滚离开底部后，后台预取等被动增高恢复贴底判定——被动分支保持原值（false 照旧）。

#### 场景：主路径

（场景已并入各 FR 行为句下的 Given/When/Then）

### FR-04: 连续 3 次冷加载全部落底（导航 active=末轮=视口末轮），真浏览器实测

- 必须：连续 3 次冷加载全部落底（导航 active 轮号 = 视口末轮，距底 ≈0），真浏览器实测验收。

#### 场景：主路径

（场景已并入各 FR 行为句下的 Given/When/Then）

### FR-05: 贴底/翻页/跳转/preview 测试面复跑绿 + tsc 0

- 必须：贴底/翻页/竞态/跳转/preview 定向 8 文件全部复跑通过 + tsc --noEmit 零错误。

#### 场景：主路径

（场景已并入各 FR 行为句下的 Given/When/Then）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：jsdom 无真实滚动布局（scrollHeight=0），被动增高分支由真浏览器实测验收（FR-04 连续冷加载）
FR-02: frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx（上滚不拉底既有用例全绿——被动分支不影响真实上滚路径）
FR-03: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx + session-panel-load-earlier-full-turn.test.tsx（翻页期守卫既有用例全绿）
FR-04: 真浏览器连续 3 次冷加载实测（部署后验证，结果记入收口输出）
FR-05: vitest 定向 8 文件 104 例全绿 + tsc 0（/tmp/vitest-passivegrow.log）
