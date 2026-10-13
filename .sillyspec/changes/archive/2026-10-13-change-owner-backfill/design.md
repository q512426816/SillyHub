---
author: flow-machine-draft
created_at: 2026-10-13T15:09:03.043Z
---
# 设计记录（Design Record）— 2026-10-13-change-owner-backfill

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

问题根因（排查实证）：变更负责人仅在 change_writer 代理写路径落库（2026-08-16-change-owner-from-token），主力路径「agent 本地 CLI 写变更目录 + 平台 reparse 扫描登记」建行恒 `owner_id=None`（service.py `_build_change`），库里 342 条变更 300 条无负责人，变更中心大面积显示「—」。

方案两条腿：
1. **后端数据侧（治本，管新行）**：`_build_change` 加 `owner_id` 关键字参数（默认 None 保持既有调用兼容），reparse 主循环建新行处传 `owner_id=workspace.created_by`（工作区所有者）。`_apply_parsed` 维持现状不触碰 owner_id（2026-08-16 设计 R-05 既有守卫）——已有 owner 不覆盖、存量空行不回填（把「未知」改写成「猜测」会污染数据；存量行的可见性交给第 2 条）。
2. **前端展示侧（治标，管存量行+可读性）**：列表负责人位从「首字小圆」改为「首字头像 + 名字文本」；双空行兜底显示 `workspace.owner.display_name`（列表页已并发拉取 workspace，零新增请求），title 标注兜底语义；全链无值才显示「—」。

选这个组合而非「reparse 回填全部存量空行」：回填会把 300 条历史行的负责人批量改写为工作区所有者（多数是 agent 干的活，所有者只是「最可能的责任人」），数据断言变弱且不可逆；展示层兜底达到同样的可见效果，数据保持诚实。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `backend/app/modules/change/service.py`：`ChangeService._build_change(parsed, *, workspace_id, owner_id=None)` 新增关键字参数（默认 None，全仓唯一调用点在 reparse 建行处），reparse sync 主循环建行调用改为传 `owner_id=workspace.created_by`。
- 后端 HTTP API / DTO / OpenAPI schema：无变化（owner_id/owner_name 本就在 ChangeSummary 投影，只是建行填充逻辑变化）——不需要 `pnpm gen:types`。
- 前端 `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx`：`renderOwnerAvatar(c)` 改造为 `renderOwner(c, workspace)`（组件内闭包，无导出面），渲染行为变化如 FR-02/FR-03；无导出签名变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   答：成立。owner 兜底只在「建行」这一刻取 workspace.created_by 快照；change_writer 代理路径带真实用户 token 先建行、reparse 后到则走 update 分支不动 owner（_apply_parsed 不触碰），两路径到达顺序任意，真实 owner 恒不被兜底值覆盖。workspace.created_by 建区后变更属罕见管理操作，建行快照不追随其后变化（与 title/description 同为「落库时点值」，reparse 不追平既有列）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   答：与现状一致，无新增竞态。建行撞唯一键 `ux_changes_workspace_key` 时既有 savepoint 兜底转 `_apply_parsed`（update 分支），该分支不写 owner——并发下兜底值丢失但不会写脏（安全方向失败）；update 分支不触碰 owner_id，无覆盖窗口。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   答：安全。owner 兜底值是纯内存构造 Change 对象时传入的字段，随 reparse 既有事务原子落库；事务中断回滚则整行不存在，无半行状态。前端兜底是纯渲染逻辑（props 驱动），无本地状态。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   答：不会。owner_id 兜底源是 `self._workspace_service.get(workspace_id)` 按 reparse 目标工作区取的行，created_by 天然按工作区隔离；前端兜底显示的 workspace.owner 来自同一工作区查询（queryKey 含 workspaceId），不跨区引用。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：语义软化——兜底「工作区所有者」在多人协作工作区里未必是真责任人（agent 干的活记到创建工作区的人头上）。缓解：前端 title 明示「负责人未指派，默认工作区所有者」兜底语义；数据侧不改写存量，真实 owner（change_writer 路径）永远优先显示。若未来需要精确归属，可在会话立项联动时把会话用户写入（本次范围外，留作后续演进）。

试过但放弃的方案：
- 「reparse 对存量空行也回填 workspace.created_by」——放弃理由：300 条历史行一次性改写、不可逆，且多数为 agent 产出，把「未知」写成「猜测」弱化数据可信度；展示层兜底达到同等可见效果。
- 「从 git log 提交者推断负责人」——放弃理由：agent 提交的 git author 不可靠（多为统一 agent 身份/机器账号），且 reparse 在平台侧执行需要额外仓库访问，成本高收益低。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/app/modules/change/service.py | `_build_change` 加 owner_id 参数；reparse 建行调用处传 workspace.created_by（注：该改动被并行变更 2026-10-13-change-reparse-autobind-remove 的提交 3cab26f0d 一并带入 HEAD，多会话同文件并行所致，内容已验证共存无冲突） |
| 修改 | backend/app/modules/change/tests/test_reparse_owner_backfill.py | 新增四用例（新建兜底/已有不覆盖/存量不回填/created_by 为 None 边界） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx | renderOwnerAvatar → renderOwner：名字文本渲染 + 双空兜底工作区所有者 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | 负责人用例改四态（owner_name 文本/owner_id mono/兜底/全空「—」）+ renderAndWait 加可选 ws 参数 |
| 修改 | frontend/src/components/mobile/mobile-change-card.tsx | 移动卡 renderOwner 四态对齐桌面：加 fallbackOwnerName prop（双空兜底，弱化色区分） |
| 修改 | frontend/src/app/m/workspaces/[id]/changes/page.tsx | 移动列表页传 fallbackOwnerName=workspace.owner.display_name |
| 修改 | frontend/src/components/mobile/mobile-change-card.test.tsx | 移动卡补兜底用例（fallback 有/无两分支） |
