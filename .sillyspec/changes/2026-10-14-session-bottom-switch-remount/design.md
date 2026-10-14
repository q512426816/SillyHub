---
author: flow-machine-draft
created_at: 2026-10-14T07:50:47.367Z
---
# 设计记录（Design Record）— 2026-10-14-session-bottom-switch-remount

## 做法概述

第三层根因：SPA 内列表点击切换会话时 SessionPanelPage/TurnTimeline 不卸载重挂，滚动判定 refs 跨会话残留（上滚读历史后 isNearBottomRef=false）→ 新会话贴底跟随被守卫拦下（真浏览器复现：会话 A 上滚→切 f231ca18→停距底 3963px）。前两轮修复（length 分量/被动增高）只覆盖整页加载路径。修法：React 惯例——同组件不同实体用 key 隔离：page/dialog 两处 <TurnTimeline> 挂 key={会话标识}，切换即重挂载、全部滚动状态归零（初始贴底语义恢复）。agent-replay-body（本地回放单会话展示）不 key 化。

## 接口契约

无接口/导出变化；两处 JSX 挂载点加 key（组件生命周期语义），内部状态重置行为对消费方透明。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到：重挂载后首个 [turns] effect 在初始窗口到达时照常贴底（refs 全新，无残留路径）；切换瞬间的在飞请求由既有会话纪元守卫丢弃（page 层不变）。
2. 并发写：key 重挂载由 React 提交序原子完成，无并发面。
3. 切换/生命周期：重挂载即本修复主题——切换时全 state/refs 销毁重建；minimizedIds 等 UI 态随会话切換清零属正确语义（跨会话本不应保留）。
4. 作用域：key 取组件自身会话标识，无跨会话串台面。

## 风险与死路

最大风险：重挂载一次性成本（切会话时全量行重建）——切会话本就全量重渲 turns，增量成本可忽略。放弃方案：①TurnTimeline 内加 sessionId prop + effect 手动重置各 refs——枚举 refs 易漏（本轮正是漏了 scrollBaselineRef 才升级到 key），新增 ref 又要记得加；②只重置 isNearBottomRef——治标，其余残留（lastSigRef/firstTurnKeyRef/baseline）仍有竞态面。
