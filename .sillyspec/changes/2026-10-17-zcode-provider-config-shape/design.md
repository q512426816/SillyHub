---
author: flow-machine-draft
created_at: 2026-10-17T03:39:40.718Z
---
# 设计记录（Design Record）— 2026-10-17-zcode-provider-config-shape

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

本变更解决「zcode 会话创建成功但每轮 turn.failed：Select a model before continuing」。三重证据（宿主有效 provider_config.json / zcode.cjs bundle 内 `.strict()` schema 与写盘器输出 / daemon.log 三次同错误）钉死两层根因：① `zcode-settings.ts` 把 `providerConfigRules` 写成裸数组，而引擎文件级 schema 要求 `{providerRules:[...]}` 对象包裹（附 `modelConfigRules` 两键），裸数组被引擎静默丢弃 → 注册表无 sillyhub 提供程序；② `_applyModel` 在目录等待超时/精确命中两条路径上 `resolvedModelId` 保持 `undefined`，把 `modelId:undefined` 发给 setModel 必败。修复即改这两处：注入形状对齐引擎写盘器输出；`_applyModel` 以归一化字符串为初值、目录命中时附带引擎自报的 `options.reasoningLevel`（JSON-RPC 对象路径走严格校验，缺 reasoningLevel 即拒——探针 + 真机双实证）。

inject → inputQueue → 驱动消费链路经 dl-out.log 实证无问题（会话 368a0ed6 的 inject 有缓冲有消费、restore 会话 idle 挂 `pulling input` 属正常等待），按用户要求核实后**未加**验证日志。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `buildZcodeProviderConfig`（sillyhub-daemon/src/zcode-settings.ts）：返回对象形状变更——`config.providerConfigRules` 从裸数组改为 `{providerRules:[...]}`，新增 `config.modelConfigRules:{providerModelRules:[],manualProviderModelRules:[]}`；无签名变化（入参/导出不变），消费方仅引擎文件读取面。
- `ZcodeAppServerDriver._applyModel`（私有方法）：`session/setModel` 请求参数从 `{sessionId, model:{providerId, modelId}}` 变为 `{sessionId, model:{providerId, modelId, options?:{reasoningLevel}}}`；目录等待窗 15s → 60s；`resolvedModelId` 三路径恒为字符串。
- `ZcodeModelCatalogEntry`（zcode-events.ts）：新增可选字段 `reasoningDefaultLevel?: string`（提取自 state.updated 的 `reasoning.defaultLevel`）；对既有消费方向后兼容（可选字段）。
- 端点/命令/表结构：无变化。

## 文件变更清单（自声明对账面）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/zcode-settings.ts | 注入形状修正（providerRules 对象包裹 + modelConfigRules 两键）+ 头注释同步 |
| 修改 | sillyhub-daemon/src/interactive/zcode-app-server-driver.ts | _applyModel：字符串 modelId 三路径 + options.reasoningLevel + 等待窗 60s + 超时目录快照诊断 |
| 修改 | sillyhub-daemon/src/interactive/zcode-events.ts | ZcodeModelCatalogEntry 增 reasoningDefaultLevel 提取 |
| 修改 | sillyhub-daemon/tests/zcode-settings.test.ts | 形状钉板更新（对象包裹 + modelConfigRules） |
| 修改 | sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts | mock 目录带 levels/defaultLevel；setModel 参数形状钉板 |
| 修改 | sillyhub-daemon/tests/interactive/zcode-events.test.ts | defaultLevel 提取钉板 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：state.updated 目录推送晚于 create（真机实证 ~30–45s）正是本次故障形态——设计以「轮询等待 + 60s 上限 + 超时降级 warn 非致命」吸收迟到；目录永不到达时会话仍可建（引擎默认模型），仅平台路由不生效且有诊断日志。
2. 并发写：per-session 注入文件每次会话创建/热切换各写一次（writeFileAtomic 原子替换），同一会话目录内无并发写方；多会话各持独立 ZCODE_DATA_BASE_DIR，互不可见。
3. 切换/生命周期：setModel 失败保持非致命（warn 后会话照常进输入循环），daemon 重启走既有 restoreAndReconnect；目录等待循环在 `h.closing` 时提前 return，不阻塞会话收口。
4. 作用域：注入文件按 sessionId 隔离目录（`zcode/<sessionId>/.zcode/v2/`），且 spawn env 覆盖用户级 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`（探针实证不覆盖则引擎读宿主文件、注册表无 sillyhub）；跨工作区/多 runtime 无共享面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：引擎版本演进改目录推送时序或 setModel schema（如将来允许字符串/免 reasoningLevel）——60s 窗口与 levels 提取按当前实证形状钉死，引擎升级需回归（MIN_VERSIONS zcode (0,16,9) 已有版本门兜底）。已试并放弃：裸 setModel 兜底重试（引擎对象路径缺 reasoningLevel 恒拒，重试无意义）；setModel 前置到会话空闲期后台执行（engine 默认模型不保证等于平台路由模型，turn 1 可能脱路由——保持阻塞确定性优先）。
