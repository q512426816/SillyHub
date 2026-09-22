---
author: qinyi
created_at: 2026-09-11 23:41:33
---

# 决策记录（Decisions）

## D-001@v1: 全量一次收口（聚合契约+强制+硬编码收口+派生）
- status: accepted
- source: user
- question: 收口范围怎么切？
- answer: 用户裁决：全量一个变更做完（聚合契约六要素声明 + 编译期 satisfies 强制 + 守护测试 + 按格式冒烟制度化 + 三处硬编码 kind 字面量收口 + 前端白名单派生）。理由：引擎现仅 4 个（claude/codex/pi/cursor），越晚重构成本越高。
- normalized_requirement: 单变更覆盖聚合契约/强制手段/硬编码收口/派生四部分，不拆分。
- impacts: [全部 FR 与 Wave 划分]
- evidence: 用户 AskUserQuestion 回答轮次 1

## D-002@v1: caps 三端同步升级为生成脚本
- status: accepted
- source: user
- question: ProviderCaps 三端同步机制保持手工镜像还是升级生成？
- answer: 用户裁决：生成脚本——daemon 单源 + 脚本产出 frontend/src/lib/provider-caps.ts 与 backend/app/modules/agent/provider_caps.py（挂现有 pnpm gen:types 流程），对齐测试保留作守护。
- normalized_requirement: 改能力矩阵只改 daemon 单源一处；生成产物可重跑幂等；对齐测试继续守护生成物不被手改漂移。
- impacts: [caps 派生 FR]
- evidence: 用户 AskUserQuestion 回答轮次 1；现有先例 frontend/src/lib/api-types.ts 生成模式

## D-003@v1: 聚合形态 = 编译期聚合对象（方案 A）
- status: accepted
- source: user
- question: ProviderAdapter 聚合契约的架构形态？
- answer: 用户裁决方案 A：新建 provider-adapter.ts（ProviderAdapter 接口 + PROVIDER_ADAPTERS 聚合表 satisfies Record<InteractiveProvider, ProviderAdapter> 编译期强制全引擎覆盖）；现有各注册表（INTERACTIVE_PROVIDERS/caps/credential-injector REGISTRY/file-settings 分派）数据源改为聚合表派生、模块导出面兼容（消费点近零改动）；daemon 三处硬编码 kind 判断改读 adapter 元数据。否决 B（god 文件手术面大）、C（未解决一份声明诉求）。
- normalized_requirement: 新引擎接入 = 在聚合表加一份声明（六要素）+ 实现 driver/写盘器，缺任一要素编译红；现有消费点不改调用方式。
- impacts: [契约 FR, 硬编码收口 FR]
- evidence: 用户 AskUserQuestion 回答轮次 2

## D-003@v2: 聚合形态 = 编译期聚合（落点修订）
- type: architecture
- priority: P1
- status: accepted
- supersedes: D-003@v1
- source: docs
- question: 聚合契约的实现落点？
- answer: Grill 复审发现 @v1 表述「新建 provider-adapter.ts」与实际最优落点不符——ProviderDescriptor（providers.ts:262）已承载五要素，原地扩展 INTERACTIVE_PROVIDERS 为 ProviderAdapter 聚合表改动面最小。@v2 修订：落点=providers.ts 内扩展，不另立契约文件。
- normalized_requirement: 聚合表与 caps 单源同文件（providers.ts）；其余同 @v1（satisfies 强制/派生导出兼容/硬编码读元数据）。
- impacts: [FR-01, FR-02]
- evidence: Grill 审查轮次 1；providers.ts:262 现状核实
