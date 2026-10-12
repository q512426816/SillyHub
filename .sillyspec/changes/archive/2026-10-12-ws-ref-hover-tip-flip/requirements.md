---
author: flow-machine-draft
created_at: 2026-10-12T02:58:44.040Z
---
# 需求规格（Requirements）— 2026-10-12-ws-ref-hover-tip-flip

## 功能需求

### FR-01: 鼠标悬停底部区域标签时，浮层翻到鼠标上方显示，永远在视口内

- 必须：当 `y + 16 + 48 > window.innerHeight`（下方空间不足）时，浮层 top 必须翻转为 `max(8, y - 48 - 10)`（鼠标上方）；禁止浮层渲染在视口外。

#### 场景：主路径

Given 输入框贴页面底缘、鼠标悬停标签（y≈720，视口高 768）/ When 浮层渲染 / Then top=662（鼠标上方）且在视口内。

### FR-02: 常规位置（下方有空间）仍显示在鼠标下方 16px

- 必须：下方空间充足时浮层 top 必须保持 y+16（既有行为零变化）。

#### 场景：主路径

Given y=200 / When 渲染 / Then top=216。

### FR-03: 相关测试全绿

- 必须：input-ref-overlay 测试套件全绿（含新增翻转用例）。

#### 场景：主路径

Given vitest run input-ref-overlay.test.tsx / Then 14/14 通过。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx「hoverTip 底部空间不足翻到鼠标上方（输入框贴页面底缘场景，2026-10-12 修复）」
FR-02: test/frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx 同用例常规位置断言（top=216px）
FR-03: test/frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx 全文件 14/14（logs/tipfix-test.log）
