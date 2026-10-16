---
author: flow-machine-draft
created_at: 2026-10-16T14:32:32.483Z
---
# 设计记录（Design Record）— 2026-10-16-change-center-delete-back-keeps-state

## 做法概述

两处小改，均为上一变更 2026-10-16-change-center-back-keeps-list-state 恢复链路的收尾：

1. **删除后返回**（`[cid]/page.tsx` DetailDeleteAction onSuccess）：`router.push(无参列表)`
   改为 `window.history.length > 1 ? router.back() : router.push(默认列表)`——与
   BackToListLink 同款判定（history.length 判定 + href/默认路径兜底）。删除前用户从哪个
   列表状态进来，back 就回到那个带 query 的列表 URL，列表页挂载从 URL 恢复 tab/页码。
2. **页码超界钳回**（`changes/page.tsx` 新增 effect）：主列表查询返回真实响应
   （isSuccess 且非 isPlaceholderData——keepPreviousData 下 placeholder 是上一页数据，
   不能用于判空）后，若 items 空且 total>0 且 page>1 且 page > ceil(total/pageSize)，
   setPage 钳回最后一页。删除后 back 回列表 → URL page=N 超界 → 首查响应 total 变小 →
   钳回 → queryKey 变化自动重取 → 写回 effect 同步 URL。

## 接口契约

- `changes/page.tsx`：新增超界钳回 useEffect（内部逻辑，不改既有函数签名；不新增导出）。
- `[cid]/page.tsx`：DetailDeleteAction onSuccess 跳转逻辑替换（组件 props 不变）。
- 无后端/接口/api-types/daemon 变化（gen:types 义务不触发）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：钳回 effect 只在真实响应（非 placeholder）到达后判定一次，钳回本身
   setPage 触发的新请求是全新 queryKey；若钳回请求返回前用户手动翻页，翻页 setPage 的
   值覆盖钳回目标，后续响应按新 page 判定——条件幂等（page ≤ 最后一页即不动作），无
   振荡面。轮询（30s）重复触发判定同样幂等。
2. 并发写：钳回只写本组件 state（setPage）与 URL（既有写回 effect），无共享数据面；
   他人并发删除导致的 total 缩水由每次轮询响应重新判定收敛。
3. 切换/生命周期：删除 onSuccess 里 invalidate 在跳转前 await 完成——列表 query 失效
   后 back/push 到列表，挂载/恢复时按 URL queryKey 重取已删行不在的数据；bfcache 跨
   document 场景（整页导航进详情再 back）invalidate 不跨文档生效，但列表页恢复时
   refetchOnWindowFocus 重取 + bfcache 失败时整页重载从 URL 重建，两路数据均收敛。
4. 作用域：跳转目标与钳回均在 /workspaces/<id>/changes 作用域内（带 workspaceId 路径
   段），列表 queryKey 含 workspaceId，无跨工作区串台。

## 风险与死路

- **风险①（已知取舍）**：history.length>1 判定在「从站外页进详情后删除」场景 back 回
  站外页——与上一变更 BackToListLink 同款取舍（Next 14.2.5 无栈深标记，内部工具罕见，
  标准返回语义），接受。
- **风险②（已知取舍）**：bfcache 恢复路径下列表数据短暂陈旧（已删行可能闪现一帧，随后
  focus refetch 收敛）——跨 document 无法主动失效，与现状删除行为一致，非本变更引入。
- **风险③**：钳回 effect 与 URL 写回 effect 的执行顺序——挂载 page=5 超界时写回先落
  ？page=5、数据到达后钳回再落 ？page=4，URL 有一次可见翻转；翻转窗口 < 首查往返时长且
  终态正确，接受。
- **死路 A（放弃）**：详情页删除后 push 带 query 的列表 URL——详情页不知道来路列表的
  tab/page（无 channel），伪造默认状态等于维持现状 bug。
- **死路 B（放弃）**：删除后一律回第 1 页——用户在归档区第 5 页连续清理时每次被甩回
  首页，体验差且与「返回保状态」诉求相悖。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | DetailDeleteAction onSuccess 跳转改为 back/兜底 push |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx | 新增页码超界钳回 effect（quicklog 不参与） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | 新增超界钳回/真空不钳回用例 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-back-to-list.test.tsx | 新增删除后 back/兜底 push 用例 |
