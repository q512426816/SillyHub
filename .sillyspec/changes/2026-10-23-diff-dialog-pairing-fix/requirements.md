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

### FR-02: 悬空调用判死不毒化，无悬置诚实丢弃

- 新编辑调用进入悬置面时 **必须** 清空旧悬置（串行协议推理：agent 工具调用顺序执行，新调用到来即证明前序调用 result 已处理——旧悬置必为补丁超限/丢失的悬空调用）；无主补丁在「无任何悬置编辑调用」时 **必须** 丢弃（不伪造归属）；**禁止**让悬空调用累积毒化后续补丁的配对。

#### 场景：悬空调用（补丁超 64KB 未附着）不拖死后续

- Given 日志序 call A(编辑，补丁超限丢失) → call B(编辑) → result(B 的补丁，无 id) → call C → result(C 的补丁，无 id)，When 就近配对，Then B 的补丁配 B、C 的补丁配 C（A 的悬空由 call B 到来判死，不污染后续）；result 先于任何编辑调用到达（悬置空）→ 丢弃。

### FR-03: ①精确配对零回归

- tool_use_id 齐全的日志（①精确配对路径）行为 **必须** 与现状完全一致：同 id 配对、同 id 多次取首个、配上的调用标记已用；本变更 **禁止** 触及①分支语义。

#### 场景：id 齐全会话

- Given 补丁行与调用行 tool_use_id 均在且一致，When 收集补丁段，Then 配对结果与改动前逐段一致（既有测试全绿即证）。

### FR-04: 数据面 id 缺失登记已知问题

- edit_patch 日志行 tool_use_id 缺失的数据链环节问题（daemon 归一化→上报→落库哪一环丢失未定，本地 transcript/rollout 无 structuredPatch 无法取证）**必须** 登记到 docs/sillyspec/ 活跃坑文档（现象、影响面、取证路径），留待后续变更根治。

#### 场景：留档可查

- When 查 docs/sillyspec 对应文档，Then 能看到该已知问题条目（含 2026-10-23 会话 49c5c3ec / run 63130ca1 实证）。

### FR-05: 触及面测试与类型零错

- 本变更触及的 vitest 用例 **必须** 全部通过；`pnpm -C frontend exec tsc --noEmit` **必须** 零类型错误。

#### 场景：验收门

- When 运行触及面 vitest 与 tsc --noEmit，Then 全部通过、零错误。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts「就近悬置配对:多文件无 id 补丁各归其位,目标文件弹窗不再吃到他文件内容」
FR-02: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts「悬空调用判死不毒化,无悬置补丁诚实丢弃」
FR-03: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts 既有用例全绿(id 齐全路径零回归)
FR-04: 不适用：文档登记面（docs/sillyspec/ 活跃坑），以落盘文件为证，无测试面
FR-05: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts（触及面全绿）+ pnpm -C frontend exec tsc --noEmit 零类型错误
