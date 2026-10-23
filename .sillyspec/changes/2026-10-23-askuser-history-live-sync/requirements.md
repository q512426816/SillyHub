---
author: flow-machine-draft
created_at: 2026-10-23T02:21:05.382Z
---
# 需求规格（Requirements）— 2026-10-23-askuser-history-live-sync

## 功能需求

### FR-01: SSE permission_request（dialog_kind 存在）到达时，对话与进度内容流实时出现该提问记录（无需刷新页面）

- SSE 回调 onPermissionRequest 收到 dialog_kind 存在的请求时，除既有 setPendingRequests 追加外，必须触发一次 dialogHistory 重拉（fetchSessionDialogHistory），使对话/进度视图的内容流穿插渲染（TurnTimeline dialogHistory 链路）实时出现该提问记录；拉取失败必须静默降级（不阻塞 SSE 主流程，同 REST 恢复路径口径）。

#### 场景：提问到达实时回显

- Given 会话已建立、内容流可见、无待答提问
- When SSE 推送 permission_request（dialog_kind="ask_user"）
- Then 底部输入框位置出现待答卡（既有），且对话/进度内容流同时出现该提问记录（不刷新页面）

#### 场景：拉取失败降级

- Given dialogHistory 重拉请求失败（网络抖动）
- When SSE onPermissionRequest 触发重拉
- Then 待答卡正常展示（pendingRequests 链路不受影响），内容流回显等待下一事件或刷新兜底，无报错抛出

### FR-02: SSE permission_resolved 到达时，对应问答记录实时更新为已答态（答案/答题人来自后端落库数据），待答卡同步移除

- SSE 回调 onPermissionResolved 必须在既有 setPendingRequests 过滤之外，再触发一次 dialogHistory 重拉，使对应问答记录实时更新为已答态（answer/answered_by 来自后端落库数据，前端不手工拼装答案——resolved 事件本身不含 answers，禁止伪造）；待答卡移除仍由既有 pendingRequests 过滤承担。

#### 场景：回答收口实时更新

- Given 一条待答提问（卡在输入框位置、内容流有 pending 记录）
- When 用户提交回答且 SSE 推送 permission_resolved
- Then 待答卡移除（既有），内容流中该记录实时变为已答态（含答案与答题人，来自后端落库）

### FR-03: session-panel-page 与 session-panel-dialog 两挂载点同款行为

- 两挂载点（page 模式与 dialog 模式）的 SSE onPermissionRequest / onPermissionResolved 回调必须同款接线 dialogHistory 重拉，行为一致；实现建议抽共享 helper（与 page-helpers 现有共享惯例同构），避免两份拷贝漂移。

#### 场景：两挂载点一致

- Given page 与 dialog 两种会话形态各自建立 SSE
- When 同一 permission_request / permission_resolved 事件分别到达
- Then 两形态内容流实时回显行为一致

### FR-04: 重拉并发防乱序（仅最新一次拉取结果生效）

- dialogHistory 重拉必须带序号防护（递增 seq，回调比对仅最新一次的结果 setDialogHistory），防止 request/resolved 短时间相邻两次拉取的响应乱序导致旧数据覆盖新数据；重拉必须复用挂载点既有的 sessionId 闭包（不跨会话串写）。

#### 场景：相邻事件并发拉取

- Given 提问到达（重拉 A 发出）后 1 秒内 resolved 到达（重拉 B 发出）
- When 重拉 A 的响应晚于重拉 B 的响应返回（网络乱序）
- Then dialogHistory 最终为重拉 B 的结果（旧响应被序号守卫丢弃）

### FR-05: 受影响测试全绿，tsc 零错

- 本次触及的测试套件必须全部通过（含新增的 SSE 触发重拉断言用例），tsc --noEmit 必须零错误；禁止跑全量测试（全量留给 CI）。

#### 场景：验证

- Given 改动完成
- When 运行受影响套件与 tsc
- Then 全绿/零错

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx「permission_request 到达 → 重拉 dialogHistory，内容流实时出现提问记录」（新增用例）
FR-02: frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx「permission_resolved 到达 → 再次重拉 dialogHistory，记录更新已答态」（新增用例）
FR-03: 不适用：两挂载点共用同一共享 helper（page-helpers 导出），FR-01/02 用例经 helper 覆盖行为，page 挂载点与 dialog 挂载点接线同构由 tsc + 代码审查保证（helper 单点实现无分叉面）
FR-04: frontend/src/components/daemon/session-panel/__tests__/refetch-dialog-history.test.ts「相邻两次拉取响应乱序 → 仅最新一次生效（旧序号响应被丢弃）」（评审 P3 收敛：原绑定行路径笔误）
FR-05: frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx 既有套件回归 + tsc --noEmit（命令实测）
