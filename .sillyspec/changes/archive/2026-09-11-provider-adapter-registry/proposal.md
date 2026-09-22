---
author: qinyi
created_at: 2026-09-11 23:39:32
---
# 提案书（Proposal）

## 动机

新引擎接入清单散落七八处（driver 注册/caps 三端手抄/env 注入器/写盘器分派/六处硬编码 kind 判断/前端白名单），无强制兜底——漏项轻则缺功能重则静默故障；写盘器还可能「实现错协议」（ql-20260911-029：pi 写死 openai-completions 致智谱 anthropic 端点全断流，mock golden 单形态没拦住）。本变更把接入面收口为一份 ProviderAdapter 声明 + 编译期/测试期/语义期三层强制。

## 关键问题

1. **结构性遗漏**：接入清单分散且无编译期强制
2. **语义性错误**：写盘器协议取值错只能靠按格式的真实冒烟防（现状 mock 只有单一形态）
3. **手抄漂移**：caps 三端镜像改一次值要手改三处；前端白名单同步靠注释提醒（R-04 旧账）

## 变更范围

- daemon：ProviderDescriptor 扩展为 ProviderAdapter（四新字段）+ 聚合表 satisfies 强制；REGISTRY 惰性派生；写盘分派按 writer 接口派发；六处硬编码读元数据；caps 加 provider_switch 键；生成脚本 + 守护测试 + 写盘器全词表表驱动用例
- frontend：provider-caps.ts 改生成产物（白名单派生）；gen:types 挂钩
- backend：provider_caps.py 改生成产物；对齐测试键集合 9→10

## 不在范围内（显式清单）

- 不改任何引擎现有行为（纯收口，零漂移由测试锁定）
- 不做 gemini 实现（留给 satisfies 强制第一次真实拦截）
- 不动 backend inject 422 语义
- 不做运行时注册中心（方案 B 已否决）

## 成功标准（可验证）

- 聚合表缺引擎 → tsc 编译红（演示性验证：临时注释一份声明）
- 全部既有测试不改预期全绿（唯一例外：对齐测试键集合 9→10 联动）
- 六处硬编码字面量 grep 归零（codex/pi 字面量仅存在于聚合表与写盘器本体）
- caps 改值只改 providers.ts 一处，重跑生成三端一致（幂等）
- 每写盘器带全词表表驱动映射测试，守护测试校验 smokeSuite 存在性
