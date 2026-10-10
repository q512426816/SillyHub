---
author: flow-machine-draft
created_at: 2026-10-10T00:02:05.793Z
---
# 任务注册表（Tasks）— 2026-10-10-ws-init-dialog-close-guard

- [x] task-01: creating/initializing 态 Modal 的 ESC（keyboard）、点遮罩（maskClosable）、右上角 X（closable）三条关闭通道必须全部禁用，idle/done/init_failed 态保持默认可关
- [x] task-02: 后台标签页（document.hidden）期间初始化超时不得判 init_failed（超时钟与轮询可见性暂停对齐），回前台后恢复计时再判
- [x] task-03: 新增用例先红后绿：initializing 态 ESC 不调 onCancel；hidden+5min 推进不出失败态，回前台再计满才失败
