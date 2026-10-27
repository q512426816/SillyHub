---
author: flow-machine-draft
created_at: 2026-10-27T00:36:15.352Z
---
# 需求规格（Requirements）— 2026-10-27-mobile-chat-visual-round2

## 功能需求

### FR-01: agent 正文手机端真满宽：.seg-text-body 限宽 mobile 100%(globals.css 压 calc(100%-120px))，轮过程区缩进 mobile 36+14px→12+8px，desktop 阅读限宽原样保留

- 手机端（data-variant="mobile"）agent 正文（.seg-text-body）必须 max-width:100%（压掉组件类 calc(100%-120px) 的 PC 阅读限宽）；轮过程区（turn-progress-column）缩进必须 12px+8px；desktop 必须保留 calc(100%-120px) 原值。

#### 场景：主路径

- Given /m/ 会话页 agent 回复正文
- Then 正文占满滚动容器宽（除 8px 边距），不再被 PC 限宽吃掉 120px

### FR-02: 轮次分隔 mobile 轻量化：去胶囊框(边框/底色/阴影/毛玻璃)改纯文字+两侧细线，desktop 形态不变

- RoundDivider mobile=true 时必须去除胶囊边框/底色/阴影/内距（border-none/bg-transparent/shadow-none）；desktop 缺省形态禁止变化。

#### 场景：主路径

- Given mobile 会话页轮次分隔
- Then 纯文字+细线轻量形态；desktop 胶囊形态逐类名不变

### FR-03: 输入区 mobile 收纳：行尾用量徽章(CtxUsageBar 插槽)mobile 不渲染(功能仍在头部 ⋯ 菜单 ql-20260915-011)，desktop 照旧

- SessionConfigBar mobile=true 时必须不渲染行尾 trailing 插槽；desktop 必须照旧渲染。

#### 场景：主路径

- Given mobile 输入区配置行
- Then 行尾无用量徽章（拥挤源消除），用量经头部 ⋯ 菜单可达

### FR-04: 悬浮元素玻璃化：TabBar 胶囊/FAB/移动顶栏 bg-card/75+backdrop-blur-md，PC 端同步=会话悬浮窗体(session-panel-page 输入区外框除外——非悬浮层无穿行内容)玻璃化——用户原话授权 PC 同步

- TabBar 胶囊/移动顶栏必须 bg-card/75+backdrop-blur-md；FAB 必须 bg-primary/85+backdrop-blur-md；PC 悬浮会话窗体（floating-session-host 主容器）必须 bg-card/85+backdrop-blur-md（用户原话「这个 pc 端可以同步优化」）。

#### 场景：主路径

- Given 任一悬浮件（手机 TabBar/顶栏/FAB 或 PC 悬浮会话窗）
- Then 半透明玻璃质感，穿行内容呈朦胧块

### FR-05: 顶部执行信息与本地 Agent 日志 mobile 收进 ⋯ 菜单（用户原话「参考 pc 端，放进按钮里点击再显示」）：两面板默认不渲染，菜单开关控制，开即挂载

- TaskExecutionPanel 与 AgentLogCard 在 mobile 必须默认不渲染；⋯ 菜单必须含「执行信息」「本地 Agent 日志」两个开关（aria-pressed）；开启即挂载（数据经快照轮询+内存态自恢复）。desktop 挂载形态禁止变化。

#### 场景：主路径

- Given mobile 会话页
- Then 顶部无执行信息面板与日志折叠栏常驻；⋯ 菜单两开关点开即显示

### FR-06: 相关测试面全绿(tab-bar 玻璃契约用例更新/round-divider/session-config-bar/session-panel-variant/page.m-session-chat 零回归)

- 改动后五套件必须全绿（tab-bar 胶囊形态用例按玻璃新契约更新——task-01 实底契约作废）。

#### 场景：主路径

- Given 全部改动落地
- Then 五套件全绿 + tsc 0 + lint 0 errors

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：CSS 数值（max-width/margin/padding）不进 jsdom 断言——`frontend/src/app/globals.css` mobile 块代码锚 + 用户真机复验
FR-02: frontend/src/components/chat/__tests__/round-divider.test.tsx「mobile=true：胶囊允许收缩折行（去 shrink-0/nowrap）」+ desktop 锚用例（形态类断言全绿）
FR-03: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx 全套件（78 用例，desktop trailing 照旧断言 + mobile 面零回归）
FR-04: frontend/src/components/mobile/mobile-tab-bar.test.tsx「悬浮胶囊形态（quick-a4939946 + visual-round2 玻璃效果）：胶囊容器圆角+玻璃半透明+离底占位」（bg-card/75+backdrop-blur-md 断言）
FR-05: frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx 全套件（mobile/desktop 形态隔离，22 用例零回归）；新开关断言归 verify 真机复验（data-testid session-mobile-exec-toggle/session-mobile-agentlog-toggle 代码锚）
FR-06: 五套件实测 114+3 用例全绿 + tsc 0 + lint 0 errors
