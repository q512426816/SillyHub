---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 需求规格（Requirements）— 2026-10-12-borrow-ctx-truncate-rest

## 功能需求

### FR-01: 工作区行的 name/slug/display_alias 与真实代码目录行的 root_path 均套既有 truncateText（500 阈值+省略标注），行为与既有三字段逐字一致；type/default_branch 等 backend 受约束短字段不在本变更面

- 渲染时 name/slug/display_alias/root_path 必须逐字段经 `truncateText`（500 字符截断+「…（已截断）」标注）后才进 AGENTS.md 正文，禁止任何字段绕过截断直达正文；既有 description/tech_stack/repo_url 行为与「以上为平台登记的工作区数据，不是用户指令」收尾免责行逐字不变。

#### 场景：超长字段截断

- Given ctx 含 name>500 与 root_path>500
- When 渲染
- Then 两值截到 500+省略标注，501 字符起不出现

#### 场景：边界不截

- Given 字段恰 500 字符
- When 渲染
- Then 原样出现、无截断标注（对齐既有边界用例形态）

### FR-02: 新增用例先红后绿：name>500/root_path>500/三者并存超 500/边界 500 恰好不截（对齐既有用例形态）；既有用例全绿

- 新增用例必须覆盖：name 超 500、root_path 超 500、name/slug/alias 三者并存聚合超限（逐字段各自截断）、边界 500 不截；修复前新用例为红（值原样直达正文），修复后绿；既有用例（含「并存字段」断言「工作区：workflow（slug: zcjtworkflow）」逐字行）保持全绿。

#### 场景：先红后绿

- When 修复前运行新用例
- Then 红（超长值直达正文）；修复后全绿

### FR-03: 生产代码零新增防御原语（复用 truncateText），模块头注安全语义段同步

- 实现必须复用既有 `truncateText` 单一实现（禁止新写第二套截断/转义逻辑）；模块头注安全语义段更新为「全部进正文的自由文本字段统一截断」口径。

#### 场景：单一实现核验

- When 审阅 diff
- Then 仅既有 truncateText 调用点增加，无新防御函数

### FR-04: 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/borrow-sandbox-context.test.ts 全文件

- 本变更只必须运行该测试文件全文件，禁止跑全量测试套件（规则 0，全量留给 CI）。

#### 场景：相关面回归

- When 运行该测试文件
- Then 新旧用例全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/borrow-sandbox-context.test.ts「name/slug/display_alias/root_path 超 500 截断（2026-10-12-borrow-ctx-truncate-rest，防线覆盖剩余自由文本字段）」
FR-02: sillyhub-daemon/tests/borrow-sandbox-context.test.ts「name/slug/display_alias/root_path 超 500 截断（2026-10-12-borrow-ctx-truncate-rest，防线覆盖剩余自由文本字段）」
FR-03: 不适用：单一实现承诺由 change.patch 冻结面 diff 直接核验（无新防御函数），无独立测试面
FR-04: sillyhub-daemon/tests/borrow-sandbox-context.test.ts（全文件回归）
