---
author: flow-machine-draft
created_at: 2026-10-23T03:33:04.639Z
---
# 提案书（Proposal）— 2026-10-23-session-dialog-input-align

## 动机

任务原话转写：会话浮窗输入即清与草稿语义对齐修复

上一个变更（2026-10-23-session-input-clear-fix，已归档）只修了 page 模式；用户批准时明确要求 dialog 模式 session-panel-dialog.tsx 同构对齐「发送受理即清 + 失败恢复 + 预会话语义」，并补 dialog 侧测试基础。现状：dialog 仍走 onSendSettled（响应成功后才清）→ 用户感知卡顿；清空经 setInput→写草稿 effect 链路，浮窗卸载时 effect 不跑 → localStorage 草稿键残留已发送文本，重开/新建回读即重现；idle 首句 createSession 失败时输入已清且不恢复（丢文本）；idle 态挂载回读 __pre__:<workspaceId> 草稿 → 新建浮窗显示上次未发送内容。

成功标准：
- 发送受理即清：dialog 活跃轮直发/忙轮排队/steered 路径在请求在途时输入框即空，不等响应
- 失败恢复：submitFollowup / sendToServerQueue / idle 首句创建失败时原文回到输入框（输入框已有新内容则不覆盖）可原地重试
- 受理即同步清 localStorage 草稿键（真会话 view.sessionId / 预会话 __pre__:<workspaceId>），发送在途切走再切回不残留
- dialog idle 态（无会话）输入框恒空白：不回读 __pre__ 草稿并清残留键；真会话草稿持久化（切换/刷新恢复）不回归
- 既有 dialog 相关用例按新语义修订，新增 FR-01~04 行为用例；tsc --noEmit 零错，相关测试全绿

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 发送受理即清：dialog 活跃轮直发/忙轮排队/steered 路径在请求在途时输入框即空，不等响应
2. 失败恢复：submitFollowup / sendToServerQueue / idle 首句创建失败时原文回到输入框（输入框已有新内容则不覆盖）可原地重试
3. 受理即同步清 localStorage 草稿键（真会话 view.sessionId / 预会话 __pre__:<workspaceId>），发送在途切走再切回不残留
4. dialog idle 态（无会话）输入框恒空白：不回读 __pre__ 草稿并清残留键；真会话草稿持久化（切换/刷新恢复）不回归
5. 既有 dialog 相关用例按新语义修订，新增 FR-01~04 行为用例；tsc --noEmit 零错，相关测试全绿

## 成功标准（可验证）

1. 发送受理即清：dialog 活跃轮直发/忙轮排队/steered 路径在请求在途时输入框即空，不等响应
2. 失败恢复：submitFollowup / sendToServerQueue / idle 首句创建失败时原文回到输入框（输入框已有新内容则不覆盖）可原地重试
3. 受理即同步清 localStorage 草稿键（真会话 view.sessionId / 预会话 __pre__:<workspaceId>），发送在途切走再切回不残留
4. dialog idle 态（无会话）输入框恒空白：不回读 __pre__ 草稿并清残留键；真会话草稿持久化（切换/刷新恢复）不回归
5. 既有 dialog 相关用例按新语义修订，新增 FR-01~04 行为用例；tsc --noEmit 零错，相关测试全绿
