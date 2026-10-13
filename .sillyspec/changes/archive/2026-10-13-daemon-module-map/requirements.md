---
author: flow-machine-draft
created_at: 2026-10-12T23:57:14.731Z
---
# 需求规格（Requirements）— 2026-10-13-daemon-module-map

## 功能需求

### FR-01: sillyhub-daemon 项目模块图（.sillyspec/docs/sillyhub-daemon/modules/_module-map.yaml）task-runner 模块 paths 补齐目录前缀登记：src/task-runner 包目录 + tests/task-runner 测试目录（前缀匹配制，非 glob）

- task-runner 模块 paths 必须在既有 `sillyhub-daemon/src/task-runner.ts`（facade 文件）基础上补 `sillyhub-daemon/src/task-runner`（包目录前缀）与 `sillyhub-daemon/tests/task-runner`（测试目录前缀）两条登记；登记形态必须符合 sillyspec fr-index 的前缀匹配制（`filePath === pp || filePath.startsWith(pp + '/')`，fr-index.js matchedModuleIds），禁止 glob 写法（`**` 不参与匹配）。

#### 场景：目录前缀登记

- Given：task-runner 模块 paths 仅覆盖 facade 文件 `src/task-runner.ts`，包目录与测试目录均无登记（伪域根因）
- When：补两条目录前缀
- Then：`src/task-runner/**` 与 `tests/task-runner/**` 交付路径命中 task-runner 模块（域=模块 id），未来变更自动落真域 fr/task-runner.md

### FR-02: 用 sillyspec 源码 matchedModuleIds 实测：sillyhub-daemon/tests/task-runner/spawn-flush-e2e.test.ts 与 sillyhub-daemon/src/task-runner/spawn-stream.ts 均命中 task-runner 模块（未来变更自动落真域）

- 登记有效性必须以 sillyspec 源码实测背书：用 `discoverModuleIndex`（合并全部项目模块图）+ `matchedModuleIds` 对两个代表路径实测，必须均返回含 `task-runner` 的命中；禁止只凭 yaml 目测断言登记生效。

#### 场景：路由实测

- Given：FR-01 登记完成后的合并模块索引
- When：对 `sillyhub-daemon/tests/task-runner/spawn-flush-e2e.test.ts` 与 `sillyhub-daemon/src/task-runner/spawn-stream.ts` 各跑 matchedModuleIds
- Then：两次命中列表均包含 `task-runner`（伪域铸造路径断根）

### FR-03: fr/auto-sillyhub-daemon.md 的 FR-auto-sillyhub-daemon-034~038 五条目整体迁出，fr/task-runner.md 以 FR-task-runner-016~020 接续编号原样承接（变更/状态/摘要/全文/最近确认/测试绑定逐字段保持）

- 迁移必须整体搬移五条目：迁出侧从 fr/auto-sillyhub-daemon.md 删除 034~038 段，迁入侧在 fr/task-runner.md（现有最大编号 FR-task-runner-015）以 016~020 接续；除 `## FR-<id>` 段头的 id/编号外，变更/状态/摘要/场景正文/全文/最近确认/测试绑定（含机器字段 row 块）必须逐字段原样保持；禁止顺带改写条目内容或增删字段。

#### 场景：原样承接

- Given：伪域文件含 FR-auto-sillyhub-daemon-034~038 五条目（源变更 2026-10-13-spawn-flush-e2e-test）
- When：迁移执行
- Then：fr/task-runner.md 新增 016~020 五条目内容与原条目逐字段一致，fr/auto-sillyhub-daemon.md 不再含该五条目且其余条目（021~033 等）零扰动

### FR-04: sillyspec knowledge validate 通过、knowledge digest 伪域信号卡中 auto-sillyhub-daemon 待迁计数相应下降

- 迁移后必须以工具自检收口：`sillyspec knowledge validate` 必须通过（fr 条目解析一致性无报错）；`sillyspec knowledge digest` 的伪域信号卡中 auto-sillyhub-daemon 的待迁/存量计数必须较迁移前下降 5（与迁出条目数一致）；禁止跳过工具自检仅目测。

#### 场景：工具自检

- Given：FR-01/03 完成后的知识面
- When：运行 knowledge validate + digest
- Then：validate 通过；digest 伪域信号计数对齐迁出量

### FR-05: 不改任何 src 代码与归档件；sillyhub-daemon/backend 不需要跑测试（纯知识面变更）

- 本变更必须严格限定知识面：只改 `_module-map.yaml` 与 `knowledge/fr/` 两文件族，禁止改任何 src 代码、禁止改 `.sillyspec/changes/archive/**` 归档件（test-trace.json 等冻结件内旧 id 引用属溯源快照，随迁移成孤儿引用是预期而非要修对象）； SHOULD 不跑 sillyhub-daemon/backend 测试（无行为面）。

#### 场景：变更面约束

- Given：纯知识面变更定位
- When：diff 审视
- Then：改动仅落在 .sillyspec/docs/sillyhub-daemon/modules/_module-map.yaml、.sillyspec/knowledge/fr/auto-sillyhub-daemon.md、.sillyspec/knowledge/fr/task-runner.md（+本变更目录治理件）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：yaml 数据登记，由 FR-02 路由实测背书生效性
FR-02: 不适用：验证即执行项——node 直调 sillyspec 源码 discoverModuleIndex+matchedModuleIds 实测两路径命中（结果记 tasks 勾选证据）
FR-03: 不适用：知识文件内容迁移，由 FR-04 工具自检背书
FR-04: 不适用：验证即执行项——sillyspec knowledge validate / digest 命令输出（结果记 tasks 勾选证据）
FR-05: 不适用：变更面约束，由收口 diff 对账背书
