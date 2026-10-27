---
author: flow-machine-draft
created_at: 2026-10-27T00:51:08.037Z
---
# 提案书（Proposal）— 2026-10-27-ghost-spec-binding-fix

## 动机

任务原话转写：失败命令不再生成幽灵变更占位并过滤存量

动机与背景：2026-10-27 会话 9d190177 实证——agent 执行 sillyspec flow start --change task-wakeup-precision-fix（缺日期前缀）被 CLI exit 2 拒绝，但平台命令解析绑定通道不看命令成败，仍为该名字建出 placeholder 变更行（draft/active/无文档）并挂会话链接；该名字永远不会有文件系统目录，reparse 永不接管，会话变更弹窗「进行中（2）」长期显示一条全量·未开始的幽灵变更。本地库 2026-07-07 的 default 行是同类历史残留。

成功标准：
- bind_session_to_change 在 changes 表无该 change_key 行且名字不匹配 YYYY-MM-DD- 日期前缀格式时，跳过建 placeholder 与 link（log.warning 记录），返回 None
- 名字带日期前缀但行不存在时维持现状建 placeholder（真实 flow start 场景零回退）
- 库中已存在同 key 行（含历史旧格式名）时正常建 link，行为不变
- list_changes_for_session 过滤幽灵占位行：status=draft 且 location=active 且无 change_documents 且 created_at 距今超过 30 分钟的行不出现在返回结果
- 刚创建（30 分钟内）的 draft 无文档行不过滤（镜像同步延迟窗口不受影响）
- 有文档的 draft 行、归档行、status 非 draft 的行均不过滤（零误伤）
- backend 相关单元测试新增并通过（binding 校验 + 会话列表过滤两组）

## 变更范围

按成功标准机械推导，共 7 条验收面：
1. bind_session_to_change 在 changes 表无该 change_key 行且名字不匹配 YYYY-MM-DD- 日期前缀格式时，跳过建 placeholder 与 link（log.warning 记录），返回 None
2. 名字带日期前缀但行不存在时维持现状建 placeholder（真实 flow start 场景零回退）
3. 库中已存在同 key 行（含历史旧格式名）时正常建 link，行为不变
4. list_changes_for_session 过滤幽灵占位行：status=draft 且 location=active 且无 change_documents 且 created_at 距今超过 30 分钟的行不出现在返回结果
5. 刚创建（30 分钟内）的 draft 无文档行不过滤（镜像同步延迟窗口不受影响）
6. 有文档的 draft 行、归档行、status 非 draft 的行均不过滤（零误伤）
7. backend 相关单元测试新增并通过（binding 校验 + 会话列表过滤两组）

## 成功标准（可验证）

1. bind_session_to_change 在 changes 表无该 change_key 行且名字不匹配 YYYY-MM-DD- 日期前缀格式时，跳过建 placeholder 与 link（log.warning 记录），返回 None
2. 名字带日期前缀但行不存在时维持现状建 placeholder（真实 flow start 场景零回退）
3. 库中已存在同 key 行（含历史旧格式名）时正常建 link，行为不变
4. list_changes_for_session 过滤幽灵占位行：status=draft 且 location=active 且无 change_documents 且 created_at 距今超过 30 分钟的行不出现在返回结果
5. 刚创建（30 分钟内）的 draft 无文档行不过滤（镜像同步延迟窗口不受影响）
6. 有文档的 draft 行、归档行、status 非 draft 的行均不过滤（零误伤）
7. backend 相关单元测试新增并通过（binding 校验 + 会话列表过滤两组）
