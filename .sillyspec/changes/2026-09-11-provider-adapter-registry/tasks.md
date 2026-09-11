---
author: qinyi
created_at: 2026-09-11 23:39:32
---
# 任务清单（Tasks）

- [x] task-01: ProviderAdapter 聚合契约——ProviderDescriptor 扩展四字段（envInjector 懒工厂/fileSettings writer 接口/perSessionDir/smokeSuite/switchable）+ 聚合表 satisfies Record<string, ProviderAdapter> 字段完备强制 + caps 加 provider_switch 键（联动 provider-registry.test.ts nineKeys 9→10）
- [x] task-02: 派生改造——credential-injector REGISTRY 惰性 memoized 派生 + provider-file-settings 两处分派（spawn 版 + ForReload 内部）按 writer 接口派发（导出面与失败语义不变） (depends_on: task-01)
- [x] task-03: 硬编码收口六处——daemon 热切换/清理/孤儿清扫 + persistence 两处 + session-manager reload 门控改读元数据 (depends_on: task-01)
- [x] task-04: caps 生成脚本 gen-provider-caps.mjs（零依赖解析+响亮失败+幂等）+ frontend gen:types 挂钩 + 三端产物落地 + 对齐测试 9→10 键 (depends_on: task-01)
- [x] task-05: 前端白名单派生——provider-caps.ts 改生成产物含 PROVIDER_SWITCH_ENGINES 派生导出（消费点 import 不变） (depends_on: task-04)
- [x] task-06: 冒烟制度化——pi-settings/codex-settings 全词表表驱动映射用例 + 守护测试 provider-adapter-registry.test.ts（覆盖/smokeSuite 存在性/词表扫描/caps 一致/REGISTRY 等价/幂等重跑） (depends_on: task-01, task-02, task-04)
- [ ] task-07: 全量回归与防遗漏演示验证——既有套件全绿 + 「临时抽走一份声明 → tsc 红」验证记录 (depends_on: task-01, task-02, task-03, task-04, task-05, task-06)
