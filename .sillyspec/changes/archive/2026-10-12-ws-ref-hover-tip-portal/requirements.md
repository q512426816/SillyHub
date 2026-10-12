---
author: flow-machine-draft
created_at: 2026-10-12T03:20:00.000Z
---
# 需求规格（Requirements）— 2026-10-12-ws-ref-hover-tip-portal

## 功能需求

### FR-01: 浮层经 portal 挂 document.body，fixed 相对视口定位，坐标零偏移

- 必须：浮层 DOM 必须渲染在 document.body 直下（脱离带 transform 的页面祖先），style.top 与 getBoundingClientRect().top 一致（无 containing block 偏移）。

#### 场景：主路径

Given 悬停命中标签 / When 浮层渲染 / Then rect.top === 解析 style.top（视口坐标系）。

### FR-02: 底部空间不足翻转逻辑在正确坐标系下生效

- 必须：视口坐标系下 y+16+48 > innerHeight 时必须翻转到鼠标上方；充足时保持 y+16。

#### 场景：主路径

同 hover-tip-flip 的两断言（662px / 216px），经 portal 后仍成立。

### FR-03: 相关测试全绿（portal 断言同步）

- 必须：overlay 套件 + 两输入区回归全绿；测试内多 render 的 portal 残留必须隔离（unmount 后断言）。

#### 场景：主路径

vitest 3 文件 105/105（logs/portalfix2.log）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx「hoverTip 传入时渲染 fixed 元数据气泡；null 时零渲染」（document 级断言=body 直挂）
FR-02: test/frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx「hoverTip 底部空间不足翻到鼠标上方（输入框贴页面底缘场景，2026-10-12 修复）」
FR-03: test/frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx + session-input-bar-upload.test.tsx + group-chat-panel.test.tsx 105/105（logs/portalfix2.log）
