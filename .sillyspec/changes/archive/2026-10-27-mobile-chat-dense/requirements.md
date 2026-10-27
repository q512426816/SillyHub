---
author: flow-machine-draft
created_at: 2026-10-27T00:17:59.283Z
---
# 需求规格（Requirements）— 2026-10-27-mobile-chat-dense

## 功能需求

### FR-01: agent 回复气泡手机端限宽 94%→100% 占满一行,时间线滚动区左右留白 12px→8px 让宽

- 手机端（data-variant="mobile"）会话页 agent 回复气泡（.turn-bubble）必须 max-width:100%，时间线滚动区左右 padding 必须 8px——正文可用宽度占满视口一行。

#### 场景：主路径

- Given /m/ 会话页（SessionPanel variant="mobile"）
- When 渲染 agent 回复气泡
- Then 气泡满宽、滚动区左右各只留 8px，一行容纳更多字符

### FR-02: 手机端正文字号 14px→13px(不低于 12px 紧凑档),行高 1.7→1.6、气泡行高 24px→21px,标题同比降一档

- 手机端正文（markdown 与气泡）字号必须 13px（h1/h2 15px、h3/h4 13px、code 12.5px，全部 ≥12px 紧凑档下限）、markdown 行高必须 1.6、气泡行高必须 21px。

#### 场景：主路径

- Given 手机端会话页正文
- Then 同屏可见内容行数较 14px/1.7 版本增加（字号 -1px + 行高 -0.1 + 气泡行高 -3px）

### FR-03: 改动仅限 globals.css [data-variant=mobile] 排版块,desktop/悬浮窗零变化

- 本变更必须只触达 globals.css 的 [data-variant="mobile"] 选择器块；desktop/悬浮窗（无 data-variant="mobile" 属性的宿主）禁止命中任何新规则。

#### 场景：主路径

- Given PC 桌面会话页 / dialog / 悬浮宿主（DOM 无 data-variant="mobile"）
- Then 全部新 CSS 规则零命中，渲染与改前逐像素一致

### FR-04: 相关测试面零回归(session-panel-variant 等既有套件全绿)

- 改动后 session-panel-variant / page.m-session-chat / turn-timeline-token-speed 套件必须全绿。

#### 场景：主路径

- Given CSS 值变更（类名/结构未动）
- Then 既有断言（类名存在性、DOM 结构）零失效

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：CSS 数值（max-width/padding）不进 jsdom 断言——落点为 `frontend/src/app/globals.css` mobile 排版块代码锚 + 用户真机复验
FR-02: 不适用：CSS 数值（font-size/line-height）不进 jsdom 断言——同上代码锚 + 用户真机复验
FR-03: frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx 全套件「mobile/desktop 形态隔离断言」（13 用例全绿——desktop 锚用例证实无 data-variant 宿主零命中）
FR-04: frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx（13 passed）+ "src/app/m/workspaces/[id]/sessions/[sid]/__tests__/page.m-session-chat.test.tsx"（10 passed）+ frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx（7 passed）
