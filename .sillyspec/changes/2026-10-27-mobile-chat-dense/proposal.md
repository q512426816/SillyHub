---
author: flow-machine-draft
created_at: 2026-10-27T00:17:59.282Z
---
# 提案书（Proposal）— 2026-10-27-mobile-chat-dense

## 动机

任务原话转写：用户真机复验 seq44 部署后反馈：会话页 agent 回复内容希望手机端占满一行,字体和间隔收小,一屏显示更多内容(第三轮密度回调——ql-20260915-009 放大 16px→ql-20260915-013 回调 14px→本轮再收紧)。

成功标准：
- agent 回复气泡手机端限宽 94%→100% 占满一行,时间线滚动区左右留白 12px→8px 让宽
- 手机端正文字号 14px→13px(不低于 12px 紧凑档),行高 1.7→1.6、气泡行高 24px→21px,标题同比降一档
- 改动仅限 globals.css [data-variant=mobile] 排版块,desktop/悬浮窗零变化
- 相关测试面零回归(session-panel-variant 等既有套件全绿)

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. agent 回复气泡手机端限宽 94%→100% 占满一行,时间线滚动区左右留白 12px→8px 让宽
2. 手机端正文字号 14px→13px(不低于 12px 紧凑档),行高 1.7→1.6、气泡行高 24px→21px,标题同比降一档
3. 改动仅限 globals.css [data-variant=mobile] 排版块,desktop/悬浮窗零变化
4. 相关测试面零回归(session-panel-variant 等既有套件全绿)

## 成功标准（可验证）

1. agent 回复气泡手机端限宽 94%→100% 占满一行,时间线滚动区左右留白 12px→8px 让宽
2. 手机端正文字号 14px→13px(不低于 12px 紧凑档),行高 1.7→1.6、气泡行高 24px→21px,标题同比降一档
3. 改动仅限 globals.css [data-variant=mobile] 排版块,desktop/悬浮窗零变化
4. 相关测试面零回归(session-panel-variant 等既有套件全绿)
