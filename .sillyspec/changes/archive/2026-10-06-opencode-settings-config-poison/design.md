---
author: flow-machine-draft
created_at: 2026-10-06T04:29:51.468Z
---
# 设计记录（Design Record）— 2026-10-06-opencode-settings-config-poison

> 四节每节必答——问题行原样保留（勿删勿改勿用答案替换），答案另起一行写在问题行下方；小改动可写「不适用：<理由>」；flow done 空节拒收。
> 需要列改动文件时加独立「## 文件变更清单」章节+表格（| 操作 | 路径 | 说明 |）——章节标题是 parseFileChangeList 的识别面，勿写在「接口契约」节内（收口声明面解析不到会误报夹带嫌疑）。
> 四问原文/FR 标题/镜像任务行是收口锚——问题行/标题从本模板原样保留或复制，勿删勿改、勿用答案整块替换问题原文、勿手打重写（标点也要逐字：2026-10-05 三度实证——句号手写成问号、答案整块替换问题原文均被锚对比拒收）。

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

纯运维数据修复 + 文档补记，无代码改动。根因：OpenCode Go 供应商行残留旧 settings_config.env（错误 ANTHROPIC_BASE_URL 指向 /zen/go/v1/chat/completions 全端点 + 无关 sk- key + mimo 模型串），daemon 注入器规则 7（settings_config.env 最高优先级）覆盖平台全部注入 → Claude Code 打错端点报「selected model 不存在」。处置：psql UPDATE settings_config=NULL（行 68b4b5b9）+ 坑文档补记覆盖链教训。选数据修复而非代码改动：注入器规则 7 的优先级设计本身是有意的（D-007 settings_config 是用户显式配置的最高意志，cc-switch 导入兼容），毒在数据残留不在代码；平台 UI 真实新会话端到端验证（发送「请只回复两个字：收到」→ 回复「收到」，第 1 轮已完成）闭环。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无代码接口变更。可见行为变化：OpenCode Go 供应商的 Claude Code 子进程 env 不再被 settings_config.env 覆盖——新会话按平台注入（base_url=https://opencode.ai/zen/go + x-api-key + deepseek-v4.1-flash 四槽 + HTTPS_PROXY）正确出网。坑文档 litellm-v1950-image-entrypoint-not-found.md 追加 2026-10-06 下午②处置记录。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不适用：静态配置数据修复，无事件流语义。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用：后台无流量时隙的一次性 UPDATE（毒配置在则所有 opencode 会话必炸，无正确流量可并发）；之后行只被常规表单更新路径触碰。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：新会话/供应商切换时 provider_config 全量重读（claim/resolve_bound 均查行现值），清 NULL 即时生效；已知边界——修复前创建的存量会话 providerConfig 快照含毒不回填（daemon sessions.json 持久化），换供应商再切回或新会话即愈（坑文档已注明）。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会：单行主键 UPDATE 只影响该部署实例的该供应商；settings_config 本就是 per-provider 字段，清空后该供应商会话统一走平台注入链，无跨实例语义。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：清 NULL 后丢失的 enabledPlugins/skipDangerousModePermissionPrompt/model=fable 等键原本是否被用户依赖——判定不依赖：这些键来自 openai_chat 时代/导入残留，与 anthropic 直连链路冲突且正是本次故障根因，属毒数据（若用户后续要插件开关，前端表单可重配）。放弃的方案：①保留 settings_config 仅删 env 子键——保留的 model=fable 仍会改 claude settings.json 行为且其余键语义未审计，不如整清干净；②代码层加「settings_config.env 含 ANTHROPIC_BASE_URL 时告警」防护——属产品设计面（规则 7 的优先级是有意设计），超出本事故修复范围，坑文档留教训即可。
