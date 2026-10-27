---
author: flow-machine-draft
created_at: 2026-10-27T00:36:15.352Z
---
# 提案书（Proposal）— 2026-10-27-mobile-chat-visual-round2

## 动机

任务原话转写：用户真机第二轮反馈(截图)：agent 回复仍未占满一行(真凶=PC 阅读限宽 max-w-[calc(100%-120px)] 段模型正文限宽+轮过程区缩进 ml-9/pl-3.5 手机被吃 30% 宽)；轮次显示效果待优化；输入框下方按钮拥挤占位大；悬浮元素要玻璃半透明效果(PC 端可同步)。

成功标准：
- agent 正文手机端真满宽：.seg-text-body 限宽 mobile 100%(globals.css 压 calc(100%-120px))，轮过程区缩进 mobile 36+14px→12+8px，desktop 阅读限宽原样保留
- 轮次分隔 mobile 轻量化：去胶囊框(边框/底色/阴影/毛玻璃)改纯文字+两侧细线，desktop 形态不变
- 输入区 mobile 收纳：行尾用量徽章(CtxUsageBar 插槽)mobile 不渲染(功能仍在头部 ⋯ 菜单 ql-20260915-011)，desktop 照旧
- 悬浮元素玻璃化：TabBar 胶囊/FAB/移动顶栏 bg-card/75+backdrop-blur-md，PC 端同步=会话输入区外框(session-panel-page 5051 共用容器)bg-card/85+backdrop-blur-md——用户原话授权 PC 同步
- 相关测试面全绿(tab-bar 玻璃契约用例更新/round-divider/session-config-bar 零回归)

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. agent 正文手机端真满宽：.seg-text-body 限宽 mobile 100%(globals.css 压 calc(100%-120px))，轮过程区缩进 mobile 36+14px→12+8px，desktop 阅读限宽原样保留
2. 轮次分隔 mobile 轻量化：去胶囊框(边框/底色/阴影/毛玻璃)改纯文字+两侧细线，desktop 形态不变
3. 输入区 mobile 收纳：行尾用量徽章(CtxUsageBar 插槽)mobile 不渲染(功能仍在头部 ⋯ 菜单 ql-20260915-011)，desktop 照旧
4. 悬浮元素玻璃化：TabBar 胶囊/FAB/移动顶栏 bg-card/75+backdrop-blur-md，PC 端同步=会话输入区外框(session-panel-page 5051 共用容器)bg-card/85+backdrop-blur-md——用户原话授权 PC 同步
5. 相关测试面全绿(tab-bar 玻璃契约用例更新/round-divider/session-config-bar 零回归)

## 成功标准（可验证）

1. agent 正文手机端真满宽：.seg-text-body 限宽 mobile 100%(globals.css 压 calc(100%-120px))，轮过程区缩进 mobile 36+14px→12+8px，desktop 阅读限宽原样保留
2. 轮次分隔 mobile 轻量化：去胶囊框(边框/底色/阴影/毛玻璃)改纯文字+两侧细线，desktop 形态不变
3. 输入区 mobile 收纳：行尾用量徽章(CtxUsageBar 插槽)mobile 不渲染(功能仍在头部 ⋯ 菜单 ql-20260915-011)，desktop 照旧
4. 悬浮元素玻璃化：TabBar 胶囊/FAB/移动顶栏 bg-card/75+backdrop-blur-md，PC 端同步=会话输入区外框(session-panel-page 5051 共用容器)bg-card/85+backdrop-blur-md——用户原话授权 PC 同步
5. 相关测试面全绿(tab-bar 玻璃契约用例更新/round-divider/session-config-bar 零回归)
