---
author: flow-machine-draft
created_at: 2026-10-27T00:36:15.352Z
---
# 设计记录（Design Record）— 2026-10-27-mobile-chat-visual-round2

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户真机二轮反馈五项视觉问题，逐一定位后落码：①agent 正文未满宽的真凶是组件类 max-w-[calc(100%-120px)]（2026-10-25 PC 阅读限宽，手机被吃 30%）——globals.css mobile 块加 .seg-text-body{max-width:100%}（特异度 (0,2,0) 压单类）一处覆盖 v2/旧路径两挂点，轮过程区缩进 ml-9+pl-3.5→12+8px 同块收敛；②RoundDivider mobile 去胶囊框纯文字+细线；③SessionConfigBar mobile 不渲染行尾用量徽章（功能仍在 ⋯ 菜单）；④悬浮件玻璃化 bg-card/75+blur-md（TabBar/顶栏/FAB），PC 同步=floating-session-host 悬浮窗体 bg-card/85+blur-md（用户原话授权；输入区外框非悬浮层不玻璃化——无穿行内容只有色差）；⑤TaskExecutionPanel/AgentLogCard mobile 默认不挂、⋯ 菜单两开关控制（照抄 ql-20260915-011 收纳先例，开即挂载快照自恢复）。方案全部走既有机制（mobile prop 分支/data-variant CSS 块/⋯ 菜单收纳），零新概念。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无接口/端点/schema 改动。组件签名零变化（RoundDivider/SessionConfigBar 已有 mobile prop 复用）；session-panel-page 新增两个局部 state（mobileExecPanelOpen/mobileAgentLogOpen）与菜单两按钮（data-testid session-mobile-exec-toggle / session-mobile-agentlog-toggle）。对外可见：手机端 agent 正文满宽、轮次轻量、输入区少一徽章、悬浮件玻璃、顶部两面板收进菜单；PC 端仅悬浮会话窗体玻璃化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不适用——纯视觉/挂载门控改动，无输入事件序；TaskExecutionPanel 关闭期间 SSE 事件注入跳过（ref=null），重开由快照轮询+内存态 props 自恢复，终态不丢。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用——无数据写入；两面板挂载门控是渲染层布尔。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全——两开关 state 是面板级（会话切换 key 重挂载自然归零）；面板关闭再开数据自恢复（FR-05 场景）；CSS 常驻无生命周期。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：玻璃半透明在深色/花哨内容上滚动时对比度下降——bg-card/75+blur-md 是透明度与模糊的平衡点（穿行内容呈朦胧块非清晰透字），真机不满意可一行调参（/75→/85 或 blur-md→lg）。放弃的方案：①直接改组件内 max-w 类（两挂点+PC 要分支判断，CSS 一处覆盖更稳）；②输入区外框也玻璃化（非悬浮层，无穿行内容只有色差，无视觉收益）；③两面板收进 Drawer（⋯ 菜单开关已够轻，Drawer 交互重）。
