---
author: flow-machine-draft
created_at: 2026-10-30T00:49:06.115Z
---
# 提案书（Proposal）— 2026-10-30-marquee-awaiting-loop-scroll

## 动机

任务原话转写：会话页对话tab底部跑马灯的「等待模型响应 · 秒数 · token」合成条目：现行为一次滚到末尾即停且常伴末尾后空白；用户要求改为慢速无缝循环滚动（用户能看清的速度）。

成功标准：
- marquee-awaiting 条目文本区为双份文本无缝循环滚动：恒速慢速（72px/s 量级）、滚满一份宽度即回卷、任意时刻窗口不出现空白区段
- 循环滚动尊重 prefers-reduced-motion（静态截断）
- 其他 running 条目（thinking 流式等）保持现有单份一次滚行为不变
- turn-live-marquee 现有测试不回归，新增用例覆盖循环模式渲染与回卷纯函数

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. marquee-awaiting 条目文本区为双份文本无缝循环滚动：恒速慢速（72px/s 量级）、滚满一份宽度即回卷、任意时刻窗口不出现空白区段
2. 循环滚动尊重 prefers-reduced-motion（静态截断）
3. 其他 running 条目（thinking 流式等）保持现有单份一次滚行为不变
4. turn-live-marquee 现有测试不回归，新增用例覆盖循环模式渲染与回卷纯函数

## 成功标准（可验证）

1. marquee-awaiting 条目文本区为双份文本无缝循环滚动：恒速慢速（72px/s 量级）、滚满一份宽度即回卷、任意时刻窗口不出现空白区段
2. 循环滚动尊重 prefers-reduced-motion（静态截断）
3. 其他 running 条目（thinking 流式等）保持现有单份一次滚行为不变
4. turn-live-marquee 现有测试不回归，新增用例覆盖循环模式渲染与回卷纯函数
