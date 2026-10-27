---
author: flow-machine-draft
created_at: 2026-10-27T02:41:29.576Z
---
# 设计记录（Design Record）— 2026-10-27-mobile-chat-visual-round3

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户三轮反馈三项：①轮次折行难看——round2 的 flex-wrap 在长 meta 下两行居中观感差，回改单行（nowrap+truncate 超长省略）+ mobile 不渲染 detail（开始/历时，最次要信息让宽）；②会话顶部返回列表——SessionPanel 加可选 onBack prop（宿主装配路由，组件保持纯 props 不感知 next/navigation），mobile 头部标题左侧渲染 ChevronLeft 钮，m-session-chat 页显式 push /m/workspaces/{id}/sessions（深链进入 router.back 不可靠）；③会话列表状态标——直接 import PC 端 session-list-panel 导出的 sessionStatusIndicator 纯函数（单一源，五态语义与 PC 逐字同款，不另造词表），mobile 卡行首渲染 dot/spinner/question 三形态，liveness 传 null（mobile 无 agent-logs 链路，status+currentRunStatus+pendingDialogKind 三输入覆盖五态核心）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无端点/schema 改动。签名新增两处可选 prop：SessionPanelProps/PageProps 加 onBack?: () => void（缺省零渲染零变化）；round-divider mobile 分支形态变更（nowrap+truncate+detail 不渲染）。m-session-chat 页新增 useRouter 装配。对外可见：mobile 轮次单行、会话页返回钮、列表卡状态标。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不适用——纯渲染层（样式分支+按钮+状态标纯函数派生），无输入事件序。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用——无数据写入。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全——onBack 是无状态回调；状态标由列表数据纯派生（数据刷新自动更新）；轮次单行纯 CSS。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：truncate 超长省略会把尾部信息（如 tok/s）截掉——已通过 mobile 不渲染 detail 优先省出宽度，极端长仍省略属可接受降级（完整信息在轮内详情可见）。放弃的方案：①轮次信息收进可点展开（交互重，分隔行本意是轻量锚点）；②返回钮用 router.back（深链进入会退出站点，显式路由恒可达）；③状态标 mobile 自建简化词表（与 PC 两套词表必漂移，直接消费单一源函数才是「同款」的正解）。
