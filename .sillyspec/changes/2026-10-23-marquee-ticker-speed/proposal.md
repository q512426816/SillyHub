---
author: flow-machine-draft
created_at: 2026-10-23T02:13:53.695Z
---
# 提案书（Proposal）— 2026-10-23-marquee-ticker-speed

## 动机

任务原话转写：跑马灯条目内部滚动提速

动机：用户反馈条目内部文本横向滚动太慢，流动感不足；需要明显加快。

成功标准：
- .sh-live-marquee-ticker 单圈时长由 8s 缩短到 3s，内部文本滚动速度明显提升
- 仅调整条目内部滚动速度，不改轨道整体推进速度与「只流到最新」行为
- prefers-reduced-motion 下仍保持静态，不恢复滚动
- 现有跑马灯测试全部通过，lint / typecheck 通过

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. .sh-live-marquee-ticker 单圈时长由 8s 缩短到 3s，内部文本滚动速度明显提升
2. 仅调整条目内部滚动速度，不改轨道整体推进速度与「只流到最新」行为
3. prefers-reduced-motion 下仍保持静态，不恢复滚动
4. 现有跑马灯测试全部通过，lint / typecheck 通过

## 成功标准（可验证）

1. .sh-live-marquee-ticker 单圈时长由 8s 缩短到 3s，内部文本滚动速度明显提升
2. 仅调整条目内部滚动速度，不改轨道整体推进速度与「只流到最新」行为
3. prefers-reduced-motion 下仍保持静态，不恢复滚动
4. 现有跑马灯测试全部通过，lint / typecheck 通过
