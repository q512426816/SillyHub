---
author: flow-machine-draft
created_at: 2026-10-18T07:48:05.717Z
---
# 提案书（Proposal）— 2026-10-18-audit-log-redact-yaml-quote

## 动机

任务原话转写：2026-10-18 只读审计两项风险清偿：zcode 驱动 spawn env 诊断日志未脱敏带凭据代理 URL（daemon.log 落密）；dsh cordis.patch.yml 模型/baseURL 裸插值，特殊字符破坏 YAML 致 provider 静默拒收。

成功标准：
- zcode 驱动 env 诊断日志的值统一走脱敏 helper：KEY/TOKEN 键整值 <redacted>，其余值内 scheme://user:pass@host 形态的 userinfo 段打码为 ***，普通值原样保留（诊断能力不回退）
- dsh cordis.patch.yml 的 model id/name 与 baseURL 一律 YAML 单引号包裹并按规范双写转义内嵌单引号，含冒号/空格/#/单引号的模型名不再破坏 YAML 结构
- 新增单测钉板两处（zcode 脱敏 helper 纯函数用例 + dsh 特殊字符模型名写盘用例），既有用例断言同步更新，dsh-settings 与 zcode 驱动相关测试全绿，tsc 零错

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. zcode 驱动 env 诊断日志的值统一走脱敏 helper：KEY/TOKEN 键整值 <redacted>，其余值内 scheme://user:pass@host 形态的 userinfo 段打码为 ***，普通值原样保留（诊断能力不回退）
2. dsh cordis.patch.yml 的 model id/name 与 baseURL 一律 YAML 单引号包裹并按规范双写转义内嵌单引号，含冒号/空格/#/单引号的模型名不再破坏 YAML 结构
3. 新增单测钉板两处（zcode 脱敏 helper 纯函数用例 + dsh 特殊字符模型名写盘用例），既有用例断言同步更新，dsh-settings 与 zcode 驱动相关测试全绿，tsc 零错

## 成功标准（可验证）

1. zcode 驱动 env 诊断日志的值统一走脱敏 helper：KEY/TOKEN 键整值 <redacted>，其余值内 scheme://user:pass@host 形态的 userinfo 段打码为 ***，普通值原样保留（诊断能力不回退）
2. dsh cordis.patch.yml 的 model id/name 与 baseURL 一律 YAML 单引号包裹并按规范双写转义内嵌单引号，含冒号/空格/#/单引号的模型名不再破坏 YAML 结构
3. 新增单测钉板两处（zcode 脱敏 helper 纯函数用例 + dsh 特殊字符模型名写盘用例），既有用例断言同步更新，dsh-settings 与 zcode 驱动相关测试全绿，tsc 零错
