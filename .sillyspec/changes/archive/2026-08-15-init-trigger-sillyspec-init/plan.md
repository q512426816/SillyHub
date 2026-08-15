---
plan_level: full
author: qinyi
created_at: 2026-08-15T16:06:52
change: 2026-08-15-init-trigger-sillyspec-init
---

# 计划：init lease 触发 sillyspec init

## 来源

brainstorm 四件套 + decisions（D-001~D-009）+ 两轮 Design Grill stage review（12/12 pass）。design.md rev3。

## 范围（按仓分段）

### sillyspec 仓（跨仓，repo: sillyspec）
- src/index.js — init 参数解析：--no-skills + --tool 多值
- src/init.js — doInstall noSkills / 平台模式跳过项目内清理段
- test/ — init flags 测试

### main 仓（sillyhub-daemon）
- sillyhub-daemon/src/spec-sync.ts — runSillyspecInit + handleInitLease 插步 + tools 参数 + projects/ 三处排除
- sillyhub-daemon/src/task-runner.ts — TaskRunner 构造 detectedAgents + _runInitLease 透传
- sillyhub-daemon/src/cli.ts — 构造前 detectAgents 映射注入
- sillyhub-daemon/tests/test_init_lease.test.ts — 改写 + 新用例

### main 仓（backend）
- backend/app/modules/spec_workspace/service.py — apply_ops 同 hash no-op
- backend/app/modules/spec_workspace/tests/ — pytest 用例

## Wave 结构

### Wave 1（CLI 前置，跨仓 sillyspec，串行同文件）
三者改同一对文件（index.js/init.js），依赖链 01→02→03 串行执行；完成后**发版**（含三项的版本号即 MIN_SILLYSPEC_VERSION_FOR_INIT）。

- [x] task-01: CLI --no-skills 开关（repo: sillyspec）

---
id: task-01
repo: sillyspec
base_commit: f13e96daa0f3355b544fdbe3a586c6f9e6888bc4
head_commit: 00f72179259fe54777232271247a0722a83454b6
---

- [x] task-02: CLI --tool 逗号/重复多值（repo: sillyspec）

---
id: task-02
repo: sillyspec
base_commit: 00f72179259fe54777232271247a0722a83454b6
head_commit: 02ca1fd355d9d7c1ef292a5a9fa91be15ed2c219
---

- [x] task-03: CLI 平台模式跳过项目内 .sillyspec 清理段（repo: sillyspec）

---
id: task-03
repo: sillyspec
base_commit: 02ca1fd355d9d7c1ef292a5a9fa91be15ed2c219
head_commit: 01c44daba2c5c2f8a39f8c72bcf156fa255af6a7
---

### Wave 2（daemon + backend 并行）
三链可并行：链 A task-04 → task-05 → task-06 → task-08（daemon 依赖链，共享文件按依赖串行）；链 B task-07（daemon，独立）；链 C task-09（backend，独立）。

- [x] task-04: daemon runSillyspecInit（版本门控+spawn+超时杀树+退出码映射）
- [x] task-05: daemon handleInitLease 插入 init 步骤（pull 后 post 前，硬失败）
- [x] task-06: daemon tools 透传链（cli.ts 探测映射 → TaskRunner → _runInitLease）
- [x] task-07: daemon projects/ 三处排除统一
- [x] task-08: daemon test_init_lease.test.ts 改写+新用例
- [x] task-09: backend apply_ops 同 hash no-op

### Wave 3（集成验证）
依赖全部；CLI 已发版安装 + 本机 daemon 真实 init lease 走通。

- [x] task-10: 集成验证（首成员产物断言+第二成员 no-op 无 conflict）

## Tasks（总览）

task-01 ~ task-10，分属 Wave 见上；任务卡片见 tasks/task-NN.md。

## Wave 与 Task 对应表（显式划分，防 execute 同 Wave 共享文件并行覆盖）

| Task | Wave | 说明 |
|---|---|---|
| task-01 | 1 | repo:sillyspec，改 src/index.js + src/init.js |
| task-02 | 1 | repo:sillyspec，改 src/index.js + src/init.js（依赖 01，串行） |
| task-03 | 1 | repo:sillyspec，改 src/init.js（依赖 02，串行） |
| task-04 | 2 | 改 spec-sync.ts + tests/run-sillyspec-init.test.ts |
| task-05 | 2 | 改 spec-sync.ts + tests/test_init_lease.test.ts + tests/run-sillyspec-init.test.ts（依赖 04，与 04 不同 Wave 内并行批次由 depends_on 串行约束） |
| task-06 | 2 | 改 task-runner.ts + cli.ts（依赖 05） |
| task-07 | 2 | 改 spec-sync.ts + 两个测试文件（依赖链外独立，与 04/05 共享 spec-sync.ts 须按 depends_on 串行） |
| task-08 | 2 | 改 tests/test_init_lease.test.ts（依赖 04/05/06） |
| task-09 | 2 | backend service.py + 新测试（完全独立） |
| task-10 | 3 | 改 spec-sync.ts（定版本常量，依赖全部） |

## 依赖关系

```
Wave1: task-01 → task-02 → task-03（同文件串行）→ [发版]
Wave2: task-09 ∥ (task-04 → task-05 → task-06 → task-08, task-07 ∥)
Wave3: task-10（依赖 Wave1 发版 + Wave2 全部）
```

## 验收

- AC-01: init lease 成功后 rootPath 出现 .sillyspec-platform.json（status active）+ 工具指令文件；specCacheRoot 出现骨架（FR-01）
- AC-02: init 失败（非0/超时/门控）→ lease failed，stats.init_error 带前缀，后续步骤不执行（FR-02/FR-03）
- AC-03: --no-skills 下 init 不写 .claude/skills 等目录；skill-manager 链路回归绿（FR-07/Non-Goals）
- AC-04: apply_ops 同 hash 版本不匹配 → no-op 不 conflict；异 hash → 仍 conflict；无 hash → 行为不变（FR-05）
- AC-05: projects/ 三处排除后全量/增量均不上传该目录，无 delete op 误删（FR-06）
- AC-06: 第二成员 init lease 骨架 add 全 no-op，无 conflict 记录（FR-04 工具列表 + 全链路，task-10 实测）
- AC-07: 三仓测试套件绿（vitest 改写后 / pytest spec_workspace / sillyspec 仓自测）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-04 | spawn 子进程，无 import/复刻 |
| D-002@v2 | task-05 | handleInitLease 编序 pull 后 post 前 |
| D-003@v1 | task-05 | ok:false → lease failed，stats.init_error |
| D-004@v1 | task-01, task-04 | --no-skills flag 传递 |
| D-005@v1 | task-06 | agent-detector 映射 + 兜底 claude |
| D-006@v1 | task-04 | 60s 超时杀树 |
| D-007@v1 | task-06 | cli.ts 构造注入 |
| D-008@v2 | task-07, task-09 | 同 hash no-op + projects/ 排除 |
| D-009@v1 | task-04 | MIN_SILLYSPEC_VERSION_FOR_INIT 门控 |

## 风险与缓解（继承 design 风险登记 R-01~R-09）

- R-01 发版顺序：Wave1 先发版 + task-04 版本门控兜底
- R-05 local.yaml：task-03 平台模式整体跳过清理段
- R-07 no-op 滥用：hash 比对内容不可伪造；task-09 用例锁死

## 测试策略

test_strategy=module（local.yaml）：verify 按 git diff 命中模块跑（sillyhub-daemon vitest 两批范式 + backend spec_workspace pytest）；sillyspec 跨仓 task 用其仓内 `node --test`（task 卡 verify 字段标明）。
