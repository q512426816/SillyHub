---
author: qinyi
created_at: 2026-09-20 09:27:05
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机

会话时间线里 agent 回复是长文档（markdown/代码块/表格），装在卡片气泡里既浪费阅读宽度又制造视觉噪音。本变更把 agent 回复文本改为无框铺底形态（主流 AI 会话产品同款：Claude/ChatGPT/Gemini/DeepSeek），用户消息保留气泡——气泡语义回归单一："用户说的话"。

## 关键问题

1. **"文档块"摩擦已有前科**：ql-20260909-009 因气泡顶满成文档块把限宽 86%→80%（turn-segment-views.tsx:507 注释）；mobile 又放宽到 94%（globals.css:825）——补丁式修补，气泡感名存实亡只剩边框
2. **混合形态视觉噪音**：时间线里用户气泡/agent 气泡有框，思考行/工具行/系统事件/文件卡/子代理文本无框——一半有框一半没框；子代理文本更早已 CSS 透明化去气泡（turn-segment-views.tsx:107），同一界面两种 agent 文本形态
3. **阅读宽度损失**：气泡限宽 80% + 气泡内边距，长代码块/表格多一层折行；去框后内容列可用宽度显著增加

## 变更范围

- v2 段模型文本段容器（TextSegmentView `.seg-text-bubble` → 无框 `.seg-text-body`，48rem 阅读限宽）
- 旧数据回退路径答复气泡同步换同款无框容器（双路径形态一致）
- globals.css：mobile 字号/行高规则迁新类名（不带 max-width 覆盖）；删子代理透明化冗余补丁；注释同步
- 相关测试断言同步（2 个测试文件）
- 用户气泡（含轮内引导消息三态气泡）完全不动

## 不在范围内（显式清单）

- 不做轮结构改造（逐段头像/agent 名字头/内容列全宽——方案 C 内容，YAGNI）
- 不动思考行/工具行/系统事件药丸/文件卡/AskUser 卡等本就无框的元素
- 不新增分隔线/背景块等新视觉元素
- 不改后端/接口/schema/数据模型

## 成功标准（可验证）

- agent 文本段（v2 + 旧路径）渲染容器无 border/底色/阴影/气泡内边距类，阅读限宽 min(100%,48rem)
- 用户气泡类名与样式不变（`.turn-bubble` 仅存于用户侧）
- mobile 变体下 agent 文本 font-size 14px / line-height 24px 规则仍在（挂 `.seg-text-body`）
- 全仓 grep 无残留气泡语义引用 `.seg-text-bubble`；相邻面测试（turn-segment-views / session-panel-dialog / sessions page）全绿
