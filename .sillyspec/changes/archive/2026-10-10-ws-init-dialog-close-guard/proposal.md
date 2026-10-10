---
author: flow-machine-draft
created_at: 2026-10-10T00:02:05.793Z
---
# 提案书（Proposal）— 2026-10-10-ws-init-dialog-close-guard

## 动机

任务原话转写：24h 审查发现创建即初始化弹窗收口不完整：initializing 态仅 footer 取消按钮被禁用，antd Modal 的 ESC/遮罩/右上角 X 三条默认关闭通道全开，半途关窗丢进度反馈且列表不刷新；且后台标签页期间轮询被 document.hidden 暂停而 5min 超时钟不暂停，后台初始化成功回前台却见假失败。
成功标准：
- creating/initializing 态 Modal 的 ESC（keyboard）、点遮罩（maskClosable）、右上角 X（closable）三条关闭通道必须全部禁用，idle/done/init_failed 态保持默认可关
- 后台标签页（document.hidden）期间初始化超时不得判 init_failed（超时钟与轮询可见性暂停对齐），回前台后恢复计时再判
- 新增用例先红后绿：initializing 态 ESC 不调 onCancel；hidden+5min 推进不出失败态，回前台再计满才失败

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. creating/initializing 态 Modal 的 ESC（keyboard）、点遮罩（maskClosable）、右上角 X（closable）三条关闭通道必须全部禁用，idle/done/init_failed 态保持默认可关
2. 后台标签页（document.hidden）期间初始化超时不得判 init_failed（超时钟与轮询可见性暂停对齐），回前台后恢复计时再判
3. 新增用例先红后绿：initializing 态 ESC 不调 onCancel；hidden+5min 推进不出失败态，回前台再计满才失败

## 成功标准（可验证）

1. creating/initializing 态 Modal 的 ESC（keyboard）、点遮罩（maskClosable）、右上角 X（closable）三条关闭通道必须全部禁用，idle/done/init_failed 态保持默认可关
2. 后台标签页（document.hidden）期间初始化超时不得判 init_failed（超时钟与轮询可见性暂停对齐），回前台后恢复计时再判
3. 新增用例先红后绿：initializing 态 ESC 不调 onCancel；hidden+5min 推进不出失败态，回前台再计满才失败
