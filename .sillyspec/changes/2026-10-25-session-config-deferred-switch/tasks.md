---
author: flow-machine-draft
created_at: 2026-10-25T11:14:01.126Z
---
# 任务注册表（Tasks）— 2026-10-25-session-config-deferred-switch

- [x] task-01: SessionConfigBar 新增 staged/onStagedSwitch props——空闲点选四控件改暂存上抛不 inject/不 POST(D-001:静默无标记无 toast),选回当前生效值上抛 cancel;验证=session-config-bar.test.tsx 新用例「idle 点选 → onStagedSwitch patch 且 injectSession 未调用、无 toast」绿
- [x] task-02: 配置条暂存值受控显示——供应商/模型/档案/档位控件直接显示暂存值(无待生效标记,D-001);验证=测试「暂存后控件显示暂存值且无标记元素」绿
- [x] task-03: 时间线切换说明行——SessionTurnView.configChangeLine + TurnRow 轮块顶部独占一行渲染(对齐 system_event 药丸形态),buildConfigChangeLine 纯函数 + enrich 相邻快照对比(modelName 扩展);验证=page-helpers-config-change-line.test.tsx 文案/对比/渲染用例绿
- [x] task-04: 面板接线——session-panel-page 持暂存 state + label ref,onStagedSwitch 合并/取消,sessionId 切换重置;验证=面板渲染与暂存合并单测绿
- [x] task-05: 发送并入——sendFromQueue/sendToServerQueue/handleResend 三点位 injectSession 并入暂存 provider/model/profile(仅暂存非空才带,空形态与现状逐字段一致),档位先调 setSessionThinkingLevel(失败警告不阻塞,暂存保留),受理成功清暂存+invalidate agentSessionDetail,占位轮预置 configChangeLine;验证=session-panel-variant.test.tsx「发送并入暂存并清空」+「无暂存零回归」用例绿
- [x] task-06: 回归保障——running 点选仍 injectSession 忙轮排队、ended 禁用、provisional 流程不变;验证=session-config-bar.test.tsx 既有 running/ended/provisional 用例全绿
- [x] task-07: 相关测试全量跑通 + lint;验证=pnpm 相关 vitest 文件通过、eslint 对触达文件无新告警
