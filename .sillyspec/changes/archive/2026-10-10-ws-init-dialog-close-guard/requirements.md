---
author: flow-machine-draft
created_at: 2026-10-10T00:02:05.793Z
---
# 需求规格（Requirements）— 2026-10-10-ws-init-dialog-close-guard

## 功能需求

### FR-01: creating/initializing 态 Modal 的 ESC（keyboard）、点遮罩（maskClosable）、右上角 X（closable）三条关闭通道必须全部禁用，idle/done/init_failed 态保持默认可关

- phase 为 creating/initializing 时，Modal 必须以 `maskClosable={false} keyboard={false} closable={false}` 禁用三条默认关闭通道（对齐 footer 取消按钮既有 disabled 语义）；idle/done/init_failed 态三条通道必须保持 antd 默认可用。

#### 场景：主路径

Given initializing 态弹窗 / When 按 ESC 或点击遮罩 / Then onCancel 不被调、弹窗保持、进度反馈不丢。
Given initializing 态弹窗 / When 查 DOM / Then 右上角 X（.ant-modal-close）不渲染。
Given idle 态弹窗 / When 查 DOM / Then X 按默认渲染（三条通道可用）。

### FR-02: 后台标签页（document.hidden）期间初始化超时不得判 init_failed（超时钟与轮询可见性暂停对齐），回前台后恢复计时再判

- 初始化超时 deadline 到期时若 document.hidden 为真，禁止判 init_failed，必须顺延一拍（INIT_POLL_INTERVAL_MS）再探；回前台后必须重挂满窗（INIT_POLL_TIMEOUT_MS）再计。

#### 场景：主路径

Given initializing 态且标签页后台 / When 推进 5min+ / Then 失败文案不出现、initializing 保持。
Given 回前台 / When 再推进 5min+ / Then 才进 init_failed。

### FR-03: 新增用例先红后绿：initializing 态 ESC 不调 onCancel；hidden+5min 推进不出失败态，回前台再计满才失败

- 测试必须覆盖三个新用例（ESC/遮罩 onCancel 零调用 + X 不渲染、hidden 超时假失败防护、idle 默认通道保持），实现前运行必须红（3 failed），实现后必须全绿（14/14）且旧 11 用例零回归。

#### 场景：主路径

Given 未加防护的旧实现 / When 跑新增 3 用例 / Then 全红（ESC 触发 onCancel / X 渲染 / hidden 5min 假失败）。
Given 加防护后的新实现 / When 同组用例 / Then 全绿。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/__tests__/workspace-scan-dialog.test.tsx「initializing 态按 ESC / 点遮罩 → onCancel 不被调（Modal keyboard/maskClosable 禁用）」+「initializing 态右上角 X 不渲染（closable 禁用）；idle 态三条通道保持默认可用」
FR-02: frontend/src/components/__tests__/workspace-scan-dialog.test.tsx「后台标签页 5min 超时不假失败；回前台再计满 5min 才 init_failed」
FR-03: frontend/src/components/__tests__/workspace-scan-dialog.test.tsx 同上三用例（先红 3 failed 实证于 2026-10-10 08:02 运行，后绿 14/14 实证于 08:03 运行）
