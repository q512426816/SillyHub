---
author: flow-machine-draft
created_at: 2026-10-23T06:40:17.501Z
---
# 需求规格（Requirements）— 2026-10-23-diff-dialog-pairing-fix

## 功能需求

### FR-01: 无 id 补丁按「紧邻其前的最近未用编辑族调用」配对

- ②回退配对（result 行与 call 行均无可用 tool_use_id 时）**必须**改为就近配对：无主补丁只允许配给「日志中紧挨它之前、且未被占用的最近编辑族调用」；**禁止**跳过中间的其他 tool_call/tool_result 行去匹配更早或更晚的调用（旧实现「全局按序塞给路径命中的第一个未用调用」**禁止**回归）。

#### 场景：多文件编辑轮点目标文件（2026-10-23 实证复现）

- Given 同轮日志序含无 id 的补丁 P1(design.md)、P2(requirements.md)、P3(task-runner.test.ts)，各自紧邻其前的未用编辑调用分别是 Write(design)、Write(requirements)、Edit(task-runner)×2，When 对 repoRelPath=tests/task-runner.test.ts 收集补丁段，Then 弹窗只含 task-runner.test.ts 自己的补丁段（P1/P2 已各自就近配对到自己的文件、被路径过滤），不再出现设计文档内容。

### FR-02: 回退按子代理轨道隔离，同轨唯一悬置才配

- ②回退配对（两侧均取不到配对键）**必须** 按 `parent_tool_use_id` 轨道隔离：只在「同轨、日志序上已出现、未被①消费的编辑族调用**恰好一个**」时配对；同轨 0 个或 ≥2 个（同执行体并行 tool_use / 悬空调用未判）**必须** 诚实丢弃，**禁止**跨轨或跨多个候选猜测归属。

#### 场景：子代理交错无 id

- Given 主代理 call A → 子代理 call S（parent_tool_use_id 不同）→ 主代理 result A（无 id），When 回退配对，Then A 的补丁配给主轨唯一的 A；子轨的 S 不受影响，两文件弹窗均不出现他文件内容。

#### 场景：同轨多悬置诚实丢弃

- Given 同轨 call A → call B → result（无 id），When 回退配对，Then 候选两名，无法确证归属 → 丢弃（a/b 弹窗都不显示该段）。

### FR-03: ①精确配对键恢复真实来源且零回归

- ①精确配对 **必须** 以 `metadata.agent_event.call_id` 为主配对键（新轨事件逐行落库的真实 id），回退顶层 `tool_use_id`（slim 回填）与 tool_call content JSON 内 `tool_use_id`（旧轨）；id 齐全时同 id 配对、同 id 多次取首个、已用标记 **必须** 与改动前一致，且乱序批次（result 行先于 call 行）**禁止** 因单遍扫描丢配对。

#### 场景：metadata 键精确配对

- Given 调用行与补丁行顶层均无 tool_use_id、但 `metadata.agent_event.call_id` 一致，When 收集补丁段，Then ①命中并按路径正确归属（评审前该数据形态下①空转、全部落②错配）。

#### 场景：乱序批次

- Given 补丁行在日志序上先于其调用行（同时间戳批次 UUID 破平），When 收集补丁段，Then ①仍命中（全量预建 id 索引）。

### FR-04: 配对键事实登记

- docs/sillyspec 已知问题文档 **必须** 按评审修正后的事实登记：`agent_run_logs` 无顶层 `tool_use_id` 列、真实配对键在 `metadata.agent_event.call_id`、旧前端只读顶层键导致①长期空转；**禁止**保留「丢 id 环节未定 / 双侧写 tool_use_id 列」的误判表述。

#### 场景：留档可查且与代码事实一致

- When 查 docs/sillyspec 对应文档，Then 能看到上述事实（含 2026-10-23 会话 49c5c3ec / run 63130ca1 实证）与 metadata 键读取先例路径。

### FR-05: 触及面测试与类型零错

- 本变更触及的 vitest 用例 **必须** 全部通过；`pnpm -C frontend exec tsc --noEmit` **必须** 零类型错误。

#### 场景：验收门

- When 运行触及面 vitest 与 tsc --noEmit，Then 全部通过、零错误。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts「metadata.agent_event.call_id 精确配对:多文件各归其位,目标文件弹窗不再吃到他文件内容」
FR-02: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts「②回退同轨唯一悬置」+「子代理轨道隔离」+「同轨多个悬置诚实丢弃」+「悬空调用不错配」
FR-03: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts「metadata 键精确配对」+ 既有 id 配对用例全绿
FR-04: 不适用：文档登记面（docs/sillyspec/ 活跃坑），以落盘文件为证，无测试面
FR-05: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts（触及面全绿）+ pnpm -C frontend exec tsc --noEmit 零类型错误
