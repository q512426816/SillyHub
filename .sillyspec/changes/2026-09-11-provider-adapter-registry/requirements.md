---
author: qinyi
created_at: 2026-09-11 23:39:32
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 引擎接入开发者 | 未来接入 gemini 等新引擎时按聚合契约一份声明的开发者 |
| daemon | 注册表消费方（SessionManager/task-runner/daemon.ts/持久化） |
| frontend / backend | caps 生成产物消费方 |

## 功能需求

### FR-01: 聚合契约 + 编译期强制
覆盖决策：D-001@v1, D-003@v2
Given INTERACTIVE_PROVIDERS 聚合表（ProviderAdapter = 现五要素 + envInjector 懒工厂【实例或显式 none+理由】+ fileSettings【writer 或显式 none+理由】+ perSessionDir + smokeSuite + switchable）
Then `satisfies Record<InteractiveProvider, ProviderAdapter>` 编译期强制全引擎覆盖——新引擎加入联合类型后未补声明即编译红
And 显式 none 与缺省不可区分（无「忘了写」与「故意不写」的歧义）

### FR-02: 派生改造零漂移
覆盖决策：D-003@v2
Given credential-injector REGISTRY（惰性 memoized 派生）与 provider-file-settings 分派（按 adapter.fileSettings 派发）
Then 模块导出面与调用点零改动；全部既有测试（daemon 162 修改相关 + frontend 55，含 ForReload 21 矩阵/dispatch 17/smoke integ 5）不改预期全绿

### FR-03: 硬编码收口（六处）
覆盖决策：D-001@v1
Given daemon.ts 热切换判断（:7815）、_cleanupProviderFileDirs、_sweepOrphanProviderFileDirs（:4774）、persistence restore 外层门控（:337）与 codex 探测、session-manager reload 合并块门控（:1825）
When 改为读聚合表元数据（fileSettings 是否 writer / perSessionDir）
Then 六处行为与原字面量判断逐类等价（claude/cursor/未知零动作，codex/pi 原逻辑不变），既有测试锁定

### FR-04: caps 生成 + 白名单派生
覆盖决策：D-002@v1
Given providers.ts PROVIDER_CAPS 单源（新增第 10 键 provider_switch：claude/codex/pi=true，cursor=false）+ scripts/gen-provider-caps.mjs（零依赖解析+响亮失败守卫）
When 跑生成脚本（frontend gen:types 链尾自动 / 手动）
Then 产出 frontend/src/lib/provider-caps.ts 与 backend/app/modules/agent/provider_caps.py（文件头 @generated，幂等重跑逐字节稳定）；前端 PROVIDER_SWITCH_ENGINES 手写常量退役改由产物派生（消费点 import 不变）；对齐测试键集合 9→10 联动更新后守护生成物

### FR-05: 冒烟制度化
覆盖决策：D-001@v1（ql-20260911-029 教训）
Given 每个文件层写盘器声明 smokeSuite（测试文件名）
Then 守护测试校验：smokeSuite 文件真实存在 + 文件内容含 api_format 词表全量字面量（表驱动映射覆盖）；pi-settings/codex-settings 各新增全词表表驱动用例（每格式→期望协议字段）

## 非功能需求
- 兼容性：四引擎行为零漂移（既有测试锁定）；backend caps 运行时消费三处按键取值 additive 安全
- 可回退：整体 revert 回手抄三端+硬编码现状
- 可测试：守护测试（聚合覆盖/smokeSuite/词表扫描/caps 一致/REGISTRY 等价）+ 既有全量修改相关套件

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01/03/05 | 全量收口 |
| D-002@v1 | FR-04 | 生成脚本 |
| D-003@v2 | FR-01/02 | 编译期聚合、providers.ts 落点 |
