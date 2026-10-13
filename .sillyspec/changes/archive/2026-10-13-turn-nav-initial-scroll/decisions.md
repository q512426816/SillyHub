---
author: flow-machine-draft
created_at: 2026-10-13T06:47:00.377Z
---
# 决策记录（Decisions）— 2026-10-13-turn-nav-initial-scroll

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：首挂载滚动在 flex 布局完成前执行的时序疑虑——useEffect 运行于 DOM commit 后，读取滚动几何会强制同步布局，且窄轨刻度高度固定（h-2.5/h-1.5）不受 markdown 异步撑高等影响，位置首挂载即最终位置，无竞态；jsdom 层以 scrollIntoView stub 断言调用事实（真实滚动行为由浏览器 block:"nearest" 标准语义担保）。 放弃的方案：① 首挂载改用 requestAnimationFrame 延帧滚动——刻度位置无异步依赖，延帧只增加闪跳窗口，无收益；② 在父层（session-panel-page）打开会话时显式触发滚轨——把组件内视觉态外泄到挂载方，破坏「受控纯组件、props 进回调出」契约（turn-catalog 先例约束）；③ 保留 mountedRef 但首渲用 useLayoutEffect 单独滚——双路径冗余，与既有 effect 维护同一语义却分两处，后续改联动易漏同步。
