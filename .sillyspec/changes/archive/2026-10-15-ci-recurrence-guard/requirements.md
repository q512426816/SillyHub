---
author: flow-machine-draft
created_at: 2026-10-15T00:49:32.903Z
---
# 需求规格（Requirements）— 2026-10-15-ci-recurrence-guard

## 功能需求

### FR-01: check-assertion-surfaces.py 规则⑦ requires 补 menu-permissions.test.ts 与 permission.test.ts，新增规则⑨ openapi.json→双 api-types.ts 同提交，单测覆盖并通过

- 断言面闸门必须满足：菜单注册表 menuKey 行变更而三件套钉子测试（admin/menus 序钉、menu-permissions 数量锚、permission 分区条目）任一不在同提交时 exit 1；backend/openapi.json 出现而前端与 daemon 双 api-types.ts 任一不在同提交时 exit 1。

#### 场景：主路径

- Given 规则⑦⑨如上定义
- When 模拟历史事故形态 staging（menuKey 行无数量钉 / openapi.json 只带前端生成物）
- Then python scripts/check-assertion-surfaces.py exit 1 且缺失清单精确列出新钉子；三件套/双生成物齐备时 exit 0

### FR-02: knowledge/testing-gotchas.md 共享断言面清单两处同步登记（脚本 docstring 要求）

- 闸门规则增改时 knowledge/testing-gotchas.md「共享断言面」条目必须同步（⑦ 三件套口径 + ⑨ 新条目 + 来源行），禁止脚本与清单漂移。

#### 场景：主路径

- Given 脚本 RULES 新增⑨、⑦ requires 扩充
- When 读 knowledge/testing-gotchas.md 共享断言面节
- Then ⑦⑨ 描述与脚本行为一致且来源行含 2026-10-15-ci-recurrence-guard

### FR-03: CLAUDE.md 第 21 条明示 sillyhub-daemon 的 gen:types 同步义务

- CLAUDE.md 第 21 条必须含 daemon 侧生成义务（pnpm -C sillyhub-daemon gen:types 与前端同变更内跑并提交），禁止只写前端义务。

#### 场景：主路径

- Given 第 21 条原文只覆盖前端
- When 读 .claude/CLAUDE.md 第 21 条
- Then 存在 daemon 同款义务 bullet 且指向闸门⑨

### FR-04: backend/.pre-commit-config.yaml 增 pre-push 快检钩子（frontend+daemon typecheck、双 gen:types:check），本机安装 pre-push 钩子类型并实测拦截/放行各一次

- pre-push 阶段必须跑 ci-fast-gate（四命令与 CI 同源：frontend typecheck、daemon typecheck、双 gen:types:check）与 docs-gate（收编原 .git/hooks/pre-push 棘轮，语义零改动），失败必须 fail-closed 拦推送。

#### 场景：主路径

- Given 干净工作树
- When pre-commit run ci-fast-gate/docs-gate --hook-stage pre-push
- Then 双双 Passed；另造类型错误临街文件时 ci-fast-gate Failed 且报出 error TS 行

### FR-05: 「菜单数量锚改推导」评估结论留痕（预期 rejected：钉子锚是有意契约，复发根因是本地缺拦截面）

- 数量锚改造评估结论必须在 design「风险与死路」留痕（rejected：推导锚与被测同源失去钉子契约语义，治本在闸门⑦补齐）。

#### 场景：主路径

- Given fix-ci-red 评审 P3 提出数量锚债务
- When 本变更 design 定稿
- Then rejected 结论与理由可在 design.md 检索到

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/tests/test_check_assertion_surfaces.py「test_rule7_requires_all_three_pins」「test_openapi_change_without_both_generated_files_is_violation」（另脚本级拦截演示：menuKey/openapi 各一次 exit 1 实测）
FR-02: 不适用：文档清单与脚本 RULES 的一致性由人工/评审核对面承载，无自动化测试面
FR-03: 不适用：CLAUDE.md 规则文本，无测试面
FR-04: pre-commit run --hook-stage pre-push「ci-fast-gate/docs-gate 放行实测 + 类型错误拦截实测」
FR-05: 不适用：评估结论留痕于 design.md「风险与死路」节
