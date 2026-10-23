---
author: flow-machine-draft
created_at: 2026-10-23T08:07:18.411Z
---
# 设计记录（Design Record）— 2026-10-23-knowledge-scope-maintenance

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

parser.py 增 extract_scope_sections/marker 正则（与 CLI 语法同源，writer 复用）；schema.KnowledgeEntry 增 sections（KnowledgeSection: heading/scope/domains），_to_knowledge_entry 对 include_content=False 也解析（content 在 ParsedEntry 内）；writer 增 update_scope（top zone 顶层文件限定/heading 精确唯一/marker 增改删/keyword=移除/domains 校验）走既有 update_entry 的 apply_ops 单写者与超限/坏编码守卫；router 增 PATCH /knowledge/scope（KNOWLEDGE_WRITE 权限）。前端 lib/knowledge.ts 增 sections 类型与 updateKnowledgeScope；page 增 scopeFilter 状态与筛选条（全部/always/repo/module/关键词）；EntryCardList 增节级徽标与「维护作用域」按钮（props 注入回调），新 scope-maintain-dialog 组件承载表单（档位+域输入）→ PATCH→刷新。选节级而非文件级：标记语义本就是节级（CLI 注入单位=section），文件级无法表达混合。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

GET /knowledge 条目新增 sections 字段（加法，旧消费方零影响）；新端点 PATCH /knowledge/scope；KnowledgeWriterService.update_scope；前端知识页新增筛选条与作用域维护对话框。零配置/零 schema 迁移。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立：写入以 manifest 行版本乐观锁（base_version）为序，冲突 409 可见；读侧为时点快照。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

apply_ops 单写者语义：并发更新同一文件一方 409，提示刷新重试；scope 读写均经该通道，无旁路写。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：单文件单次原子 update（整文件内容经 apply_ops），中断不产生半标记；读侧无状态。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不串台：workspace_id 限定 + _spec_content_root 解析（spec_workspace 优先，与既有读侧同源）；marker 只写本 workspace 知识树。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

风险=节定位歧义（同名 heading 重复）导致改错节——对策：多义直接 422 并要求唯一 heading；marker 只在该节范围内增删，绝不触碰其他节。放弃：整文件 content 替换式维护（丢其他节编辑并发、无结构校验）；文件级 scope（无法表达节级语义）。


## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 改 | backend/app/modules/knowledge/parser.py | extract_scope_sections＋marker 正则 |
| 改 | backend/app/modules/knowledge/schema.py | KnowledgeSection＋sections 字段＋KnowledgeScopeIn |
| 改 | backend/app/modules/knowledge/service.py | _to_knowledge_entry 透传 sections |
| 改 | backend/app/modules/knowledge/writer.py | update_scope 节级维护 |
| 改 | backend/app/modules/knowledge/router.py | PATCH /knowledge/scope |
| 改 | frontend/src/lib/knowledge.ts | sections 类型＋updateKnowledgeScope |
| 改 | frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx | 作用域筛选条＋对话框接线 |
| 改 | frontend/src/components/knowledge/entry-card-list.tsx | 节级徽标＋维护入口 |
| 增 | frontend/src/components/knowledge/scope-maintain-dialog.tsx | 作用域维护对话框 |
| 增 | backend/app/modules/knowledge/tests/test_scope_maintenance.py | 后端用例 |
