---
author: flow-machine-draft
created_at: 2026-10-14T12:28:03.940Z
---
# 提案书（Proposal）— 2026-10-14-session-bottom-resize-observer

## 动机

任务原话转写：第四层根因（真浏览器注入复现取证：重申窗过期后向滚动容器注入 2000px 占位 → delta=2000 永久停住，无任何机制修正）：内容迟到撑高（懒加载图片、markdown 迟渲染、content-visibility 真实化）只改 scrollHeight——不触发 scroll 事件（scrollTop 未变）、不触发 turns 提交，2.5s 高度重申窗过期后彻底无修正源。前三轮修复各覆盖特定触发器，本层是通解缺位。

成功标准：
- ResizeObserver 观察滚动容器内容高度：任何来源的高度变化（图片/视图/懒渲染/注入）且用户在底部（isNearBottomRef=true）→ rAF 合帧 scrollTo 底，delta 保持 0
- 用户上滚读历史时高度变化不拉底（isNearBottomRef=false 守卫）
- 注入复现脚本在修复后 delta 保持 0（部署前后对照取证）
- rAF 合帧防布局风暴（2026-10-13 layout-storm 教训：高频回调去重为一帧一滚）
- 兼容无 ResizeObserver 环境（jsdom/旧浏览器优雅降级不挂观测）
- 既有测试面复跑绿 + tsc 0

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. ResizeObserver 观察滚动容器内容高度：任何来源的高度变化（图片/视图/懒渲染/注入）且用户在底部（isNearBottomRef=true）→ rAF 合帧 scrollTo 底，delta 保持 0
2. 用户上滚读历史时高度变化不拉底（isNearBottomRef=false 守卫）
3. 注入复现脚本在修复后 delta 保持 0（部署前后对照取证）
4. rAF 合帧防布局风暴（2026-10-13 layout-storm 教训：高频回调去重为一帧一滚）
5. 兼容无 ResizeObserver 环境（jsdom/旧浏览器优雅降级不挂观测）
6. 既有测试面复跑绿 + tsc 0

## 成功标准（可验证）

1. ResizeObserver 观察滚动容器内容高度：任何来源的高度变化（图片/视图/懒渲染/注入）且用户在底部（isNearBottomRef=true）→ rAF 合帧 scrollTo 底，delta 保持 0
2. 用户上滚读历史时高度变化不拉底（isNearBottomRef=false 守卫）
3. 注入复现脚本在修复后 delta 保持 0（部署前后对照取证）
4. rAF 合帧防布局风暴（2026-10-13 layout-storm 教训：高频回调去重为一帧一滚）
5. 兼容无 ResizeObserver 环境（jsdom/旧浏览器优雅降级不挂观测）
6. 既有测试面复跑绿 + tsc 0
