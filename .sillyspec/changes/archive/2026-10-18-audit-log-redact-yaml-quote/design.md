---
author: flow-machine-draft
created_at: 2026-10-18T07:48:05.717Z
---
# 设计记录（Design Record）— 2026-10-18-audit-log-redact-yaml-quote

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

2026-10-18 只读审计两项风险的小修（thin）：

1. **zcode env 诊断日志脱敏**（zcode-app-server-driver.ts:172，ba409b94c 真机诊断遗留、已随 e3eb90a60 上线）：行内三元改为调用新导出的纯函数 `redactEnvValueForLog(key, value)`——键名含 KEY/TOKEN 整值 `<redacted>`；否则对值做 URL userinfo 段打码后按既有 60 字符截断。选值级打码而非整值 `<redacted>`：代理 host/port 是该日志的诊断定位信息（日志存留目的），只抹凭据段；KEY/TOKEN 类无定位价值，维持整值脱敏。
2. **dsh patch YAML 插值转义**（dsh-settings.ts writeDshHome）：新增模块内 `yamlQuote(v)`（YAML 单引号标量：`'` + `v.replace(/'/g, "''")` + `'`），应用于 model id、model name、baseURL 三个外部数据插值点。选单引号风格：转义规则最简（仅单引号双写），cordis/llm-pi-ai 侧 YAML 解析后值等价，无引擎行为变化。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新导出 `redactEnvValueForLog(key: string, value: unknown): string`（zcode-app-server-driver.ts；导出仅供单测，先例：spec-sync applyResurrectSuppress）。
- 新模块内函数 `yamlQuote`（dsh-settings.ts，不导出）。
- cordis.patch.yml 字段值形状：id/name/baseURL 由裸标量变单引号标量——YAML 解析后同值，对 dsh 引擎无行为变化；dsh-settings.test.ts 既有断言同步更新。
- zcode daemon.log 输出形状：带凭据代理 URL 的值显示为 `scheme://***@host:port`；其余不变。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   不适用：两处均为纯函数 + spawn 前一次性求值/写盘，无事件时序面。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   不适用变化：writeDshHome 仍为幂等重写（同输入同输出，既有用例钉板），并发语义不变。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   不适用：日志在 spawn 前同步打印、写盘在会话建立前完成，无新增中间态；中断不会留下半转义文件（单次 writeFile 原子替换）。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

4. 作用域：跨工作区/跨工作仓/多实例时数据会不会串台？
   不适用：日志属本进程、DSH_HOME 属 per-session 会话目录，无跨实例共享面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：userinfo 打码正则漏形态。正则取 `scheme://` 后不含 `/`、`@`、空白的第一段为 userinfo（覆盖 `user` 与 `user:pass`）；用户名含 URL 编码 `%40` 时不匹配、原样输出——残余暴露面收窄但未归零（与 KEY/TOKEN 整值红action 的严格度差异在函数注释声明）。已放弃方案：a) PROXY 键整值 `<redacted>`——丢 host 诊断价值，与该日志存留目的冲突；b) YAML 双引号 + JSON.stringify 转义——对控制字符更严但转义面大，无需求支撑。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| M | sillyhub-daemon/src/interactive/zcode-app-server-driver.ts | env 诊断日志改走 redactEnvValueForLog；新导出该 helper（含注释） |
| M | sillyhub-daemon/src/dsh-settings.ts | 新增 yamlQuote；model id/name/baseURL 单引号化 |
| M | sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts | 新增脱敏纯函数 describe（三态） |
| M | sillyhub-daemon/tests/dsh-settings.test.ts | 既有断言更新为引号形态 + 特殊字符模型名用例 |
