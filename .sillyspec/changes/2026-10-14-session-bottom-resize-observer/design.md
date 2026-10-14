---
author: flow-machine-draft
created_at: 2026-10-14T12:28:03.940Z
---
# 设计记录（Design Record）— 2026-10-14-session-bottom-resize-observer

## 做法概述

第四层根因（前三轮修复各覆盖特定触发器后的通解缺位）：内容迟到撑高只改 scrollHeight——不触发 scroll 事件（scrollTop 未变）、无 turns 提交，2.5s 重申窗过期后无修正源（真浏览器注入取证：贴底稳定 6 秒后注入 2000px → delta=2000 永久停住）。修法：ResizeObserver 观察滚动容器的内容子元素（容器自身 borderBox 由 flex 固定，须观察子元素），任何来源增高且用户在底部 → rAF 合帧 scrollTo 底。这是「高度变化」的权威事件源，覆盖图片/markdown/注入全部路径，与既有三触发器（turns 提交/scroll 事件/重申窗）互补不冲突。

## 接口契约

无接口/导出变化；TurnTimeline 新增一个内部 useEffect（ResizeObserver 生命周期 + rAF 句柄 ref），对消费方透明。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到：RO 回调只读 isNearBottomRef 现值（用户接管即时生效）；多次增高合并为最后帧一次滚（rAF 去重幂等）。
2. 并发写：RO 回调浏览器串行；rAF 句柄单一，无并发滚动面；与 [turns] effect 的 scrollTo 同为幂等到底操作，多次调用无害。
3. 切换/生命周期：effect cleanup disconnect 观测 + 取消挂起 rAF；key 重挂载（上轮修复）随组件卸载走 cleanup，无泄漏。
4. 作用域：观测对象为组件内 DOM 子元素，无跨会话面；挂载后新增子节点（streamFooter 等）不在初始 children 集——其渲染引起的兄弟高度变化经既有子捕获，属可接受覆盖。

## 风险与死路

最大风险：RO 高频回调性能（流式期间每 delta 触发）——rAF 合帧后每帧至多一次 scrollTo（与既有流式贴底同频，无增量）；MarkdownText memo 使未变行不重排，实际回调频率远低于帧率。放弃方案：①延长重申窗——时序赌注，图片加载时长无上界；②监听 img load 事件——只覆盖图片一类，markdown 迟渲染/注入仍漏；③MutationObserver——语义错位（观察结构不观察尺寸，且更贵）。
