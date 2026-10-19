---
author: flow-machine-draft
created_at: 2026-10-16T14:41:38.711Z
---
# 决策记录（Decisions）— 2026-10-16-change-center-delete-back-keeps-state

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- **风险①（已知取舍）**：history.length>1 判定在「从站外页进详情后删除」场景 back 回 站外页——与上一变更 BackToListLink 同款取舍（Next 14.2.5 无栈深标记，内部工具罕见， 标准返回语义），接受。 - **风险②（已知取舍）**：bfcache 恢复路径下列表数据短暂陈旧（已删行可能闪现一帧，随后 focus refetch 收敛）——跨 document 无法主动失效，与现状删除行为一致，非本变更引入。 - **风险③**：钳回与 URL 写回的时序——真实路径下进详情前列表 URL 已是超界态 （如 ？page=5，上一变更写回 effect 落的），back/整页载入挂载后写回首跑同址跳过； 数据到达后钳回 setPage(4) 再写回 ？page=4，URL 一次翻转、终态正确，窗口小于首查 往返时长，接受。（评审 P3 修正：原稿误写为挂载写回先落 ？page=5——挂载首跑同址 跳过，不存在该额外动作。） - **死路 A（放弃）**：详情页删除后 push 带 query 的列表 URL——详情页不知道来路列表的 tab/page（无 channel），伪造默认状态等于维持现状 bug。 - **死路 B（放弃）**：删除后一律回第 1 页——用户在归档区第 5 页连续清理时每次被甩回 首页，体验差且与「返回保状态」诉求相悖。
