---
author: flow-machine-draft
created_at: 2026-10-28T23:13:04.592Z
---
# 提案书（Proposal）— 2026-10-29-floating-scope-loadmore-fix

## 动机

任务原话转写：悬浮面板加载更多附加段误清修复

动机与背景：floating-session-host.tsx:578 以内联对象传 scope（lockedRuntime ? { kind: runtime, runtimeId } : undefined），宿主每次重渲染产生新引用；b9949cdbf 在 session-list-panel.tsx 新增的清理 effect 以 [scope, isArchivedView, assocFilter] 为依赖（React useEffect Object.is 引用比较），宿主重渲染即触发 setExtraItems([]) 并把 extraOffsetRef 游标归 null——锁定 runtime 悬浮面板点「加载更多会话」拉回的附加段随宿主重渲染消失、已加载计数回跳、再点从首屏 offset 重复拉取。其余调用方 scope 为 undefined 或稳定变量不受影响；react-query queryKey 走结构化哈希也不受影响，唯独 effect 落坑。

成功标准：
- 清理 effect 的 scope 依赖改为口径稳定键（kind+标识字段标量），同值新引用 scope 重渲染不再清附加段/复位游标（组件级用例固化：rerender 传同值新对象 scope 后已加载条目不回跳）
- scope 口径真实变化（kind 或标识 id 变化）时附加段仍正确清空（既有口径语义零回归，用例固化）
- 会话列表现有测试套件全绿，tsc/eslint 0 error

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 清理 effect 的 scope 依赖改为口径稳定键（kind+标识字段标量），同值新引用 scope 重渲染不再清附加段/复位游标（组件级用例固化：rerender 传同值新对象 scope 后已加载条目不回跳）
2. scope 口径真实变化（kind 或标识 id 变化）时附加段仍正确清空（既有口径语义零回归，用例固化）
3. 会话列表现有测试套件全绿，tsc/eslint 0 error

## 成功标准（可验证）

1. 清理 effect 的 scope 依赖改为口径稳定键（kind+标识字段标量），同值新引用 scope 重渲染不再清附加段/复位游标（组件级用例固化：rerender 传同值新对象 scope 后已加载条目不回跳）
2. scope 口径真实变化（kind 或标识 id 变化）时附加段仍正确清空（既有口径语义零回归，用例固化）
3. 会话列表现有测试套件全绿，tsc/eslint 0 error
