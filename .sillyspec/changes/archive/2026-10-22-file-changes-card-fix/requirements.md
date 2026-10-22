---
author: zcode-agent
created_at: 2026-10-22T11:17:23.094Z
---
# 需求规格（Requirements）— 2026-10-22-file-changes-card-fix

## 功能需求

### FR-01: 轮内已提交（git commit）的文件必须出现在本轮文件变更卡中；文件清单来源为 git status ∪ git diff --name-status <baselineHead>，行数取 numstat

- 采集器**必须**把「轮首基线 HEAD 到轮尾工作区」之间**已提交**的改动与 `git status` 的未提交/未跟踪清单合并为文件列表；**禁止**只以 `git status` 作为文件清单来源。行级 +/− **必须**取 `git diff --numstat <baselineHead>`（含已提交改动）；同名路径以 status 的状态为准，status 未出现的已提交路径按 name-status 的 A/M/D 归类。

#### 场景：轮内 commit 后工作区干净
- Given 轮首基线为 HEAD0，agent 在本轮修改 `src/a.ts` 并 commit，轮尾 `git status` 为空
- When 轮尾采集快照
- Then 卡片文件列表包含 `src/a.ts`（status=modified），行数取 `HEAD0..工作区` 的 numstat

#### 场景：轮内新增/删除并提交
- Given 本轮新增 `new.ts`、删除 `old.ts` 并 commit
- When 采集
- Then 列表出现 `new.ts`（added）与 `old.ts`（deleted），行数来自 numstat

#### 场景：未跟踪文件仍在列
- Given 工作区有未跟踪文件 `draft.ts`
- When 采集
- Then 列表包含 `draft.ts`（untracked），行数 0/0 且前端不得显示为 +0 −0

### FR-02: 慢盘工作区（/mnt/ 等）不再固定超时：自适应/放大超时预算且可配置；numstat 超时仍保留已采集的 status/name-status 文件清单（行数显示破折号）

- 采集超时**必须**支持按工作区自适应：WSL 挂载路径（`/mnt/<盘符>/...`）基础预算**必须** ≥ 8000ms；任一次 timeout 后该工作区预算**必须**自动升级（≤15000ms，进程内记忆）；**必须**支持 `SILLYHUB_FILE_CHANGES_TIMEOUT_MS` 环境变量覆盖基础值。
- `git status` 成功后，即使 `diff --name-status` / `diff --numstat` 超时，**必须**返回已采集的文件清单（`status=partial`、`reason=timeout`、行数不可信）；**禁止**返回 `files=[]` 丢弃已完成部分。只有 status 本身失败才允许 `files=[]`。

#### 场景：慢盘首轮超时后升级
- Given 工作区 `/mnt/e/...`，默认预算 8000ms 仍超时
- When 下一轮采集
- Then 该工作区预算升级（如 16000ms 封顶 15000ms），不再固定 1500ms

#### 场景：numstat 超时保留清单
- Given status 与 name-status 成功，numstat 超过剩余预算
- When 采集收口
- Then `status=partial`、`reason=timeout`、files 保留，前端行级显示破折号

### FR-03: 未跟踪新文件、删除文件、mtime 探测行有明确状态展示；删除行不可点击；改N次=真实编辑调用次数

- 前端**必须**为每个文件行展示状态（新增/修改/删除/未跟踪）；未跟踪与 mtime 探测行**禁止**显示 `+0 −0`（显示破折号/新文件语义）；删除行**禁止**可点击打开；「改N次」**必须**取本轮该文件编辑调用次数（同一工具多次调用重复计数），工具名提示去重展示。

#### 场景：未跟踪新文件
- Given 文件行 status=untracked、added/deleted=0
- When 渲染
- Then 显示「新文件」状态徽标，行级统计显示破折号

#### 场景：删除文件
- Given 文件行 status=deleted
- When 点击该行
- Then 不触发打开文件回调（行不可交互），显示「删除」徽标

#### 场景：同一文件多次 Edit
- Given 同一文件被 Edit 调用 3 次
- When 渲染
- Then 显示「改3次」，工具提示去重为「Edit」

### FR-04: notice 按精确 reason（timeout/queue_overflow/无 reason）与采集耗时生成文案，notice 态也显示共享工作区提示

- 无文件行的 partial 提示卡**必须**按 `reason` 生成文案：timeout 带采集耗时、queue_overflow 明确排队溢出、无 reason 用通用「快照未完成」；`concurrentSessionsHint=true` 时 notice 态**必须**显示「共享工作区，可能含并行会话改动」。

#### 场景：timeout 提示
- Given snapshot.status=partial、reason=timeout、collectMs=1500、files=[]
- When 渲染提示卡
- Then 文案包含「超时」与「1.5s」，不出现「队列溢出」

#### 场景：queue_overflow 提示
- Given reason=queue_overflow
- When 渲染
- Then 文案明确「排队溢出」，不出现「超时」

### FR-05: daemon/前端定向测试全绿，既有卡片与快照契约零回归

- **必须**补齐 daemon 采集器与前端卡片/视图模型的定向测试；既有快照 DTO 形状与卡片基础交互（折叠头/展开/二进制/降级不出卡）**必须**保持零回归。

#### 场景：回归
- Given 本次变更测试面
- When 运行 daemon 与前端定向测试
- Then 全绿，且既有断言（2 条子进程预算改为 3 条、notice 文案、二进制破折号）按新契约更新后通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/interactive/turn-file-changes.test.ts「轮内 commit 的改动进入文件清单」
FR-02: sillyhub-daemon/tests/interactive/turn-file-changes.test.ts「numstat 超时保留 status 清单」「慢盘预算自适应」
FR-03: frontend/src/components/daemon/file-changes/__tests__/turn-file-changes.test.ts「status/untracked/编辑次数映射」；frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx「状态徽标/删除行不可点/未跟踪破折号」
FR-04: frontend/src/components/daemon/file-changes/__tests__/turn-file-changes.test.ts「notice 按 reason 与耗时生成」；frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx「notice 态共享工作区提示」
FR-05: sillyhub-daemon/tests/interactive/turn-file-changes.test.ts「既有六类夹具/降级路径回归」；frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx「既有卡片交互回归」
