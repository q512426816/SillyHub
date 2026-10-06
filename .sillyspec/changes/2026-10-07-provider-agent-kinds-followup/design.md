---
author: flow-machine-draft
created_at: 2026-10-06T23:05:38.553Z
---
# 设计记录（Design Record）— 2026-10-07-provider-agent-kinds-followup

> 四节每节必答——问题行原样保留（勿删勿改勿用答案替换），答案另起一行写在问题行下方；小改动可写「不适用：<理由>」；flow done 空节拒收。
> 需要列改动文件时加独立「## 文件变更清单」章节+表格（| 操作 | 路径 | 说明 |）——章节标题是 parseFileChangeList 的识别面，勿写在「接口契约」节内（收口声明面解析不到会误报夹带嫌疑）。
> 四问原文/FR 标题/镜像任务行是收口锚——问题行/标题从本模板原样保留或复制，勿删勿改、勿手打重写（标点也要逐字：2026-10-05 三度实证——句号手写成问号、答案整块替换问题原文均被锚对比拒收）。

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

两处独立小修（2026-10-06 代码审查报告的高置信发现 1/2）：①前端 `formToUpdate`（frontend/src/lib/api/llm-providers.ts:464）补 `agent_kinds: v.agent_kinds` 透传——`formToCreate` 已有同款先例（444 行），编辑分支唯一调用点 llm-provider-list.tsx:95 无需改动，R-05 toast 随之与服务器状态恢复一致（不改 toast 本身）。②后端 `LlmProviderService.update`（backend/app/modules/llm_provider/service.py）在 pi×openai 生效组合判定**之前**比照 `api_key`/`multimodal` 先例把显式 None pop 掉（`updates.get("agent_kinds") is None → pop`），使 `effective_kinds` 回退行值、`setattr` 不写 NULL、扩张清兄弟分支不误触发。

选 pop-None 而非收紧 schema（去掉 `| None`）：openapi/api-types 契约已发布 nullable（`anyOf: [array, null]`），收紧契约会迫使第三方调用方行为变化，且服务层「显式 null=不动」与同 DTO 其它字段既有语义完全一致，变更面最小。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

`LlmProviderUpdate.agent_kinds` 显式 null 的语义从「未定义（TypeError/IntegrityError → 500）」收敛为「不动」，与 api_key/multimodal 一致；openapi schema 本身不变（仍 nullable）。`formToUpdate` 返回结构多携带 `agent_kinds` 键（类型不变，`LlmProviderUpdate.agent_kinds?:` 本就声明）。无端点/命令/文件格式/迁移变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   不适用——同步请求/响应路径，无事件流；PATCH 字段集合在单请求内原子生效，pop None 发生在请求解析后的内存 dict 层，与到达顺序无关。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   不适用——update 单事务内先取行后写，is_default 互斥清兄弟沿用既有 (user_id, 引擎) 粒度逻辑；pop None 位于取行后、判定前，与 api_key 处理同序，不新增并发面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   安全——显式 null 收敛为 no-op 后，请求中断/回滚行为与既有「不传该键」路径完全一致；无迁移、无后台任务、无状态残留。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   不会——改动限定本仓 llm_provider 服务层方法与前端映射器纯函数，不触碰跨仓/多实例共享状态；user_id 过滤口径不变。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：FR-01 修复后 `agent_kinds` 键出现在所有编辑提交 body 里，既有表单/apiformat 测试若存在对 PATCH body 的全量精确匹配断言（toEqual）会因新增键挂掉——处置：跑定向测试，按新契约补断言键（补字段属契约演进，非改测试凑绿）。试过放弃：①schema 层禁 null（`agent_kinds: list[...]` 去掉 `| None`）——把契约上合法的显式 null 变成 422，第三方调用方行为被动变化，且与同 DTO 其它 nullable 字段风格不一致；②前端映射器发 `agent_kinds: v.agent_kinds ?? null`——引入 null 与缺省两种「不动」歧义表达，无收益。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/lib/api/llm-providers.ts | formToUpdate 补 agent_kinds 透传 |
| 修改 | frontend/src/lib/api/__tests__/llm-providers.test.ts | formToUpdate 用例补 agent_kinds 断言 |
| 修改 | backend/app/modules/llm_provider/service.py | update 显式 agent_kinds=None pop 防护 |
| 修改 | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | 补显式 null 等同不动用例 |
