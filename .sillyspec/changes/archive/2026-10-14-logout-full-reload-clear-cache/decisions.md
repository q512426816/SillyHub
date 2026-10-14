---
author: flow-machine-draft
created_at: 2026-10-14T02:50:01.424Z
---
# 决策记录（Decisions）— 2026-10-14-logout-full-reload-clear-cache

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：整页跳转比 SPA 跳转多一次完整文档加载（HTML/JS 重取，浏览器缓存可摊薄），登出是低频操作且 401 被动登出长期就是这个行为，体验一致性与数据正确性优先，可接受。放弃方案 A：登出时 `queryClient.clear()` + 逐个 reset 内存 store——需要 app-shell 拿到 QueryClient 并枚举所有 store，覆盖面靠人工维护，未来新增 store 即漏（本次 bug 正是此类漏网），且组件内闭包/SSE 状态仍难穷尽；放弃方案 B：给全部 query key 加用户维度——改动面遍历全站 hook，且不解决非 QueryClient 的内存 store 串台，收益/成本倒挂。
