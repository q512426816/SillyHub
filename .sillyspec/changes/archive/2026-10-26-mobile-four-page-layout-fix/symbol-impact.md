# 符号影响面报告

> tasks.md 内容指纹（生成时）: e14f848d0cce14de——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——MobileAppShell props 不变，main 的 pb className 改 calc 组合；MobileTabBar 内部样式类改动，对外 props 零变化
- task-02: 无签名级变更——纯 CSS 新增 .m-app 后代选择器规则块，无 TS 符号触达
- task-03: 接口新增（向后兼容）——TurnLiveMarquee props 增 `mobile?: boolean`（可选，缺省 false）；既有调用点（turn-timeline.tsx / turn-segment-views.tsx / proto 页）不传即零变化，均在任务范围内（透传归 task-05）
- task-04: 接口新增（向后兼容）——RoundDivider props 增 `mobile?: boolean`（可选）；新增导出纯函数 abbreviateCount(n: number): string；既有调用点不传即零变化
- task-05: 接口新增（向后兼容）——TurnTimelineProps / TurnSegmentViews props 增 `variant?: "desktop" | "mobile"`（可选，缺省 "desktop"）；session-panel-page.tsx 两处 TurnTimeline 挂载点加实参（调用点更新在卡内），dialog/floating-session-host 等既有宿主不传零变化
- task-06: 无签名级变更——SessionConfigBar 已有 variant/mobile props（ql-20260915-013 先例），仅 mobile 分支内样式类/宽度值调整，props 签名不动
- task-07: 无签名级变更——deriveSessionPlaceholder 已有 mobile opt 参数位（page-helpers.tsx:701 先例），仅排队态分支返回文案变化，函数签名不动
- task-08: 接口新增（向后兼容）——PlatformSyncSection props 增 `mobile?: boolean`（可选，缺省 false）；既有调用点（PC changes 页 / m changes 页 compact）不传即零变化，m 页透传在 task-09 范围内
- task-09: 无签名级变更——页面级布局类改动 + PlatformSyncSection 调用点加 mobile 实参（消费 task-08 新 prop），页面自身导出符号零变化
- task-10: 无签名级变更——/m/workspaces 页面内部布局类改动，无导出符号触达
- task-11: 无签名级变更——/m sessions 页面布局 + mobile-workspace-header 内部样式类收紧，组件 props 零变化
