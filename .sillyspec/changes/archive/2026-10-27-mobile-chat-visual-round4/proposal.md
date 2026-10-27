---
author: flow-machine-draft
created_at: 2026-10-27T03:24:31.025Z
---
# 提案书（Proposal）— 2026-10-27-mobile-chat-visual-round4

## 动机

任务原话转写：用户四轮反馈：子代理卡/进度视图过程块(运行命令等)仍不满宽(8 处 calc(100%-120px) PC 限宽)；对话与进度两 tab 轮次样式不一(进度用旧 TurnStatusBadge 小字)要求统一用对话的 RoundDivider。

成功标准：
- turn-segment-views 8 处 max-w-[calc(100%-120px)] 收敛为语义类 seg-width-cap,限宽改由 globals.css 单点定义(PC calc(100%-120px) 等价/mobile 100% 满宽),mobile 子代理卡/过程块/团队卡/警告行全满宽,desktop 限宽原样
- all(进度)视图轮尾统一用 RoundDivider(与对话视图同款同构,含 meta/detail/mobile 透传),TurnStatusBadge 形态与函数退役,自动续跑徽标保留在统一行内
- 相关测试面全绿(token-speed all 视图用例按统一后契约更新)

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. turn-segment-views 8 处 max-w-[calc(100%-120px)] 收敛为语义类 seg-width-cap,限宽改由 globals.css 单点定义(PC calc(100%-120px) 等价/mobile 100% 满宽),mobile 子代理卡/过程块/团队卡/警告行全满宽,desktop 限宽原样
2. all(进度)视图轮尾统一用 RoundDivider(与对话视图同款同构,含 meta/detail/mobile 透传),TurnStatusBadge 形态与函数退役,自动续跑徽标保留在统一行内
3. 相关测试面全绿(token-speed all 视图用例按统一后契约更新)

## 成功标准（可验证）

1. turn-segment-views 8 处 max-w-[calc(100%-120px)] 收敛为语义类 seg-width-cap,限宽改由 globals.css 单点定义(PC calc(100%-120px) 等价/mobile 100% 满宽),mobile 子代理卡/过程块/团队卡/警告行全满宽,desktop 限宽原样
2. all(进度)视图轮尾统一用 RoundDivider(与对话视图同款同构,含 meta/detail/mobile 透传),TurnStatusBadge 形态与函数退役,自动续跑徽标保留在统一行内
3. 相关测试面全绿(token-speed all 视图用例按统一后契约更新)
