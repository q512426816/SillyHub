---
author: flow-machine-draft
created_at: 2026-10-30T01:26:52.734Z
---
# 决策记录（Decisions）— 2026-10-30-marquee-awaiting-loop-scroll

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- 最大风险：jsdom 无真实布局，回卷视觉正确性（无缝、无空白）无法在单测里直接验证，只能靠纯函数 wrapLoopOffset/loopScrollWidth + 双份 DOM 结构断言覆盖；上线后需在真实页面肉眼确认一轮循环（视觉证据 visual-evidence.md 记录）。 - 评审 P2（短文本相位露白，turn-live-marquee.tsx loopScrollWidth 锚点）已实装修复：一份文字 ≤ 窗口宽时不起滚、静止显示开头（等待初期无 token 数据的常态阶段），文本增长超窗后自然起滚；48px 轮间隔空隙经过窗口属跑马灯轮次分隔的常态运动空白，非静止死白。 - 放弃方案 ①（单份文本滚到末尾后直接跳回开头继续）：末尾贴右缘时跳变突兀，且若滚过末尾继续左移，窗口右侧必然出现空白区段——正是用户本次抱怨的现象，故必须双份拼接。 - 放弃方案 ②（用户最初提议：删掉 inline-block class）：span 退回 display:inline 后 CSS transform 对 inline 非替换元素不生效，滚动"悄悄失效"，属碰巧坏掉式修法、代码意图不明，被否。 - 放弃方案 ③（所有 running 条目统一改循环）：thinking 流式文本持续增长，"循环一轮"与"跟随新末尾"语义冲突（慢速下一轮极长且内容一直在变），保持 once 模式；仅每秒变化、内容收敛的 marquee-awaiting 条目改 loop。 - 残留风险：文本每秒变化时周期宽度微变，回卷点可能有 1-2px 抖动；双份文本使 ticker DOM 文本量翻倍（单条目 <1KB 量级，无性能面问题）。
