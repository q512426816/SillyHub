---
author: flow-machine-draft
created_at: 2026-10-27T00:36:15.352Z
---
# 任务注册表（Tasks）— 2026-10-27-mobile-chat-visual-round2

- [x] task-01: agent 正文手机端真满宽：.seg-text-body 限宽 mobile 100%(globals.css 压 calc(100%-120px))，轮过程区缩进 mobile 36+14px→12+8px，desktop 阅读限宽原样保留
- [x] task-02: 轮次分隔 mobile 轻量化：去胶囊框(边框/底色/阴影/毛玻璃)改纯文字+两侧细线，desktop 形态不变
- [x] task-03: 输入区 mobile 收纳：行尾用量徽章(CtxUsageBar 插槽)mobile 不渲染(功能仍在头部 ⋯ 菜单 ql-20260915-011)，desktop 照旧
- [x] task-04: 悬浮元素玻璃化：TabBar 胶囊/移动顶栏 bg-card/75+FAB bg-primary/85（均 backdrop-blur-md），PC 端同步=悬浮会话窗体 floating-session-host 主容器 bg-card/85+blur-md（用户原话授权；输入区外框非悬浮层不玻璃化——无穿行内容只有色差，执行期裁决与 requirements FR-04 一致）
- [x] task-05: 相关测试面全绿(tab-bar 玻璃契约用例更新/round-divider/session-config-bar 零回归)
- [x] task-06: 顶部执行信息+本地 Agent 日志 mobile 收进 ⋯ 菜单（用户补充需求「参考 pc 端放进按钮点击再显示」）：两面板默认不渲染，菜单两开关（session-mobile-exec-toggle/session-mobile-agentlog-toggle）控制，开即挂载快照自恢复，desktop 形态不变
