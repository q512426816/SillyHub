---
author: flow-machine-draft
created_at: 2026-10-10T00:02:05.793Z
---
# 设计记录（Design Record）— 2026-10-10-ws-init-dialog-close-guard

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

24h 审查发现 1940c83b1「创建即初始化」弹窗收口不完整：initializing 态只把 footer 取消按钮 disabled，antd v6 Modal 默认开启的 ESC（keyboard）/点遮罩（maskClosable）/右上角 X（closable）三条通道仍会触发 onCancel → 父组件卸载弹窗、轮询清理、进度反馈丢失且列表不刷新；另后台标签页期间轮询 tick 被 document.hidden 短路而 5min 超时 setTimeout 不暂停，后台初始化实际成功、回前台却见假失败。方案：①Modal 三属性随 busy（creating/initializing）态翻转（`!busy`），idle/done/init_failed 保持默认；②超时回调改 armInitDeadline 递归——到期时若 document.hidden 则顺延一拍（2s）再探，回前台后重挂满窗（5min）再计，与轮询的 D-005 可见性暂停钟对齐。选属性翻转而非 onCancel 内拦截：属性禁用让三条通道在交互层就不触发（含 X 按钮直接不渲染），比事后拦截语义更明确且不影响 idle 态既有行为。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `frontend/src/components/workspace-scan-dialog.tsx`：组件 Props 零变化；新增内部函数 armInitDeadline(delayMs)（替换原一次性 setTimeout 赋值）；Modal 新增 maskClosable/keyboard/closable 三个动态属性。对外可见行为变化：busy 态 ESC/遮罩/X 不再关闭弹窗（footer disabled 语义对齐）；后台标签页不再 5min 假失败。
- 无后端/协议/类型面变化（纯前端交互收口，api-types 无涉）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立：deadline 顺延只在到期瞬间读一次 document.hidden，与轮询 tick 无交错依赖；ESC/遮罩事件与 phase 状态同步渲染（React 单线程提交），无乱序面。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   无并发写面：initDeadlineRef 句柄由 stopInitPolling 统一清理，armInitDeadline 递归每次覆盖同一句柄槽；单组件内单定时器链，不存在双 deadline 并存。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全：卸载仍走既有 useEffect(() => stopInitPolling) 清理（顺延中的 deadline 同样被 clearTimeout）；done/init_failed 达成时 stopInitPolling 先清 deadline 再置态，无孤儿定时器。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会：visibility 与 phase 均为组件内状态，一次只服务一个创建流程；弹窗销毁（destroyOnHidden）后状态全部重置。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：deadline 顺延一拍（2s）在高频切页场景产生最长 2s 的判死延迟——相对 5min 超时窗可忽略，且换来的是后台零假失败。另一个取舍：回前台后重挂满窗而非续接剩余时长，最坏情况前台多等 5min——初始化轮询通常先于超时命中 init_synced_at，实际影响罕见。试过但放弃：onCancel 内按 phase 拦截（放弃理由：ESC/遮罩事件仍会触发 antd 内部状态翻转，且 X 按钮仍渲染给用户可点击的假出口，交互层禁用更干净）；deadline 用 visibilitychange 事件重算剩余时长（放弃理由：需要额外事件监听器与剩余时长簿记，复杂度超过 2s 顺延的收益）。

## 文件变更清单（自声明）

交付文件（2 个）：

1. `frontend/src/components/workspace-scan-dialog.tsx`——Modal 三属性 + armInitDeadline 递归顺延（FR-01/FR-02）
2. `frontend/src/components/__tests__/workspace-scan-dialog.test.tsx`——三个新用例（FR-03）

留档口径注记：冻结面内的 docs/sillyspec 两条坑记录移动（finished/ 收编）为同会话独立 chore 提交（f95789b7a），非本变更交付；评审 P1（回前台重挂满窗未实现）已在后续提交修复——armInitDeadline 增加 fullWindow 标记区分满窗/顺延拍，测试补 4min 检查点断言。
