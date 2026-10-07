---
author: flow-machine-draft
created_at: 2026-10-07T15:53:04.895Z
---
# 需求规格（Requirements）— 2026-10-07-ci-sweep-focus-visible-flake

## 功能需求

### FR-01: delete-change-confirm.test.tsx 文件级 stub getComputedStyle（照先例形态+注释引用坑档案），19 用例全绿且连续多跑稳定

- 该测试文件必须在模块收集期以空样式表 Proxy stub window.getComputedStyle（照 agent-profile-form.test.tsx 先例形态），注释必须说明 jsdom 级联匹配缺陷机制与坑档案引用；stub 后 19 用例必须全绿且连续 6 跑稳定。

#### 场景：主路径

Given antd Checkbox focus-visible 规则已注册 / When 级联匹配被触发（点击/样式读取）/ Then cascade 被 stub 阻断，不再生成非法选择器，用例稳定通过。

### FR-02: eslint/tsc 0 错

- 修改后的测试文件必须通过 eslint（0 error）与 tsc --noEmit（0 错）。

#### 场景：主路径

Given stub 代码合入 / When 跑 lint 与类型检查 / Then 均 0 错。

### FR-03: frontend-ci 推送后转绿（其余 workflow 不回归）

- 推送后 frontend-ci 必须 转绿；backend-ci/e2e-ci/scan-drift 必须 不因本改动回归。

#### 场景：主路径

Given 修复推送 / When 四 workflow 完成 / Then frontend-ci success 且其余三线不回归。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/__tests__/delete-change-confirm.test.tsx「详情页危险按钮（PageHeader actions）」全套件 19 用例（本地连续 6 跑绿实证）
FR-02: 不适用：lint/类型门（eslint 0 error + tsc --noEmit 0 错已实证，非用例面）
FR-03: 不适用：CI 门（frontend-ci 转绿以推送后 GitHub Actions 实跑为准，盯到全绿）
