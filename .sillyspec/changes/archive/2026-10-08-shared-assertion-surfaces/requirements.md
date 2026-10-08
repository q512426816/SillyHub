---
author: flow-machine-draft
created_at: 2026-10-08T17:15:36.561Z
---
# 需求规格（Requirements）— 2026-10-08-shared-assertion-surfaces

## 功能需求

### FR-01: testing-gotchas.md 新增「共享断言面」条目，六面齐备（契约源/钉子测试/动作三列），INDEX.md 对应关键词行挂载

- testing-gotchas.md 必须 新增「共享断言面」条目且六面齐备（迁移锚/心跳参长/TABS 数量/caps 全对象/previewers mock/词表对账，每面含契约源+钉子测试+动作），INDEX.md 必须 挂对应关键词索引行。

#### 场景：主路径

Given 六面契约各有跨文件钉子 / When 登记条目+索引落地 / When 后续 flow start 或 INDEX 查询命中关键词 / Then 提醒可见。

### FR-02: 四个契约源码处各加一行同步提醒注释，指向具体钉子测试文件

- 五个契约源码处（schema.py/daemon.ts/workspace-tabs.tsx/provider-caps.ts/previewers/index.ts）必须 各有同步提醒注释，指向具体钉子测试文件与知识条目锚；注释 禁止 改变任何行为。

#### 场景：主路径

Given 开发者编辑契约源码 / When 注释在场 / Then 钉子测试文件名当场可见。

### FR-03: 三端静态门零错（backend ruff/mypy、daemon tsc、frontend tsc/eslint），钉子测试复跑全绿（证注释零影响）

- 三端静态门必须 零错，被注释触达的钉子测试（迁移锚/provider-adapter-registry/git-log TABS/workspace-tabs/pre-session-picker/onlyoffice-preview）复跑必须 全绿。

#### 场景：主路径

Given 五文件仅注释改动 / When 静态门与钉子测试复跑 / Then 全部通过（实证：backend ruff/format/mypy 0+锚 7 绿；daemon tsc 0+registry 8 绿；frontend tsc/eslint 0+4 文件 45 绿）。

### FR-04: 推送后五 workflow 全绿

- 推送后五个 workflow（backend-ci/frontend-ci/daemon-ci/e2e-ci/scan-drift）必须 全绿（按路径过滤触发者以实跑为准）。

#### 场景：主路径

Given 修复推送 / When 各 workflow 完成 / Then 全部 success。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：文档登记面（条目在场性与索引行已人工核，无测试断言价值）
FR-02: 不适用：注释零影响面（行为无改动，由 FR-03 静态门+钉子复跑代证）
FR-03: backend/tests/test_align_platform_change_events_migration.py（7 绿）+ sillyhub-daemon/tests/provider-adapter-registry.test.ts（8 绿）+ frontend git-log-page/workspace-tabs/pre-session-picker/onlyoffice-preview 四文件（45 绿）
FR-04: 不适用：CI 门（五 workflow 全绿以推送后 GitHub Actions 实跑为准，盯到全绿）
