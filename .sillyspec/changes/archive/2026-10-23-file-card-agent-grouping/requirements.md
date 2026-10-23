---
author: flow-machine-draft
created_at: 2026-10-23T02:34:59.849Z
---
# 需求规格（Requirements）— 2026-10-23-file-card-agent-grouping

用户原话（成功标准来源）：「变更文件卡片 优先默认只展示 本轮次修改的（新增编辑删除）， 把命令行、其他会话修改的放旁边按钮点击才展示（标题也改下 本轮AGENT XX 个文件变更 +15 -12 | 总共 xx 个文件变更（共享工作区，可能含并行会话改动）+265 -14）； 还有已删除的文件为什么点击不了」。会话导出数据实证：command 归因行主要是 agent 经 Bash 跑 sillyspec CLI 创建的 .sillyspec 文件（非编辑工具直改）。

## 功能需求

### FR-01: 折叠头双段标题：本轮AGENT 段（tool 归因计数与行级合计）+ 总共段（全部文件计数与合计），共享工作区提示保持

- FileChangesCard 折叠头**必须**渲染双段标题：第一段「本轮AGENT N 个文件变更 +a −d」（source=tool 行的计数与行级合计，N=0 时省略 +/− 段），第二段「总共 M 个文件变更 +A −D」（全部行合计），两段间以分隔符区隔；既有共享工作区提示、截断破折号语义（truncated 时两段行级均显破折号）**禁止**回归。

#### 场景：主路径

- Given 快照含 3 个 tool 行（+15 −12）与 23 个 shell 行（+250 −2），When 渲染折叠卡，Then 头部含「本轮AGENT 3 个文件变更」「+15」「−12」「总共 26 个文件变更」「+250」「−2」，共享工作区提示行照旧在场。

### FR-02: 展开区默认只列 agent 编辑行；命令行/其他变更收进按钮行，点击展开该区段

- 卡片展开时**必须**默认只渲染 source=tool 的文件行；source=shell 的行**必须**收进一个可点击按钮行（显示「命令行/其他 N 个文件 +X −Y」语义的计数），点击后展开该区段文件行，再点收起；agent 行为零时按钮行仍在（主列表空不吞其他变更入口）。

#### 场景：主路径

- Given 混合归因的快照，When 展开卡片，Then 主列表只见 tool 行；点击「命令行/其他」按钮后 shell 行可见、再点收起。

### FR-03: 已删除文件行可点击，弹窗展示补丁或如实说明删除无补丁

- status=deleted 的文件行**必须**可点击（保留删除线样式）并触发 onOpenFile；弹窗内若本轮日志配到该文件补丁则照常展示，配不到则**必须**如实说明该文件本轮被删除且删除动作未来自编辑工具（无补丁内容），**禁止**静默不可点或渲染伪造 diff。

#### 场景：主路径

- Given 快照含 status=deleted 行，When 点击该行（已接线挂载面），Then 弹窗打开并显示删除如实说明或补丁内容；未接线消费方照旧零行为（上一变更 FR-04 语义不回归）。

### FR-04: 无补丁弹窗说明改为如实表述，不再断言唯一原因；有补丁时副标题才提 agent 编辑日志

- 无补丁说明文案**必须**改为如实表述：该文件的改动未来自本轮 agent 编辑工具（Edit/Write），可能由命令行/脚本、并行会话或其他进程产生，平台未捕获补丁内容仅行数统计可信；**禁止**断言唯一原因（如「由命令行/脚本改动」）；弹窗副标题仅在弹窗实际展示补丁段时**可以**提及「来自 agent 编辑日志」语义，无补丁说明态**禁止**出现该表述。

#### 场景：主路径

- Given command 归因行点击后日志无补丁，Then 说明文案不含「该文件由命令行/脚本改动」断言句式、不含「来自 agent 编辑日志」副标题；Given tool 行点击配到补丁，Then 副标题/脚注的 agent 编辑日志语义在场。

### FR-05: 既有 notice/degraded/破折号语义不回归，触及面测试绿

- FileChangesCard 的 notice 单行卡、degraded 说明行、partial/binary/untracked 的破折号与 title 提示语义**必须**零回归；本变更触及的前端测试面（file-changes 全族 + turn-timeline 挂载 + 弹窗）与 `tsc --noEmit` **必须**全绿零错误。

#### 场景：主路径

- When 运行触及面 vitest 与 tsc，Then 全部通过、零类型错误；notice/degraded 既有用例不改语义即通过（或仅按新标题文案适配断言）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx「折叠头双段标题：本轮AGENT 段 + 总共段 + 行级合计」
FR-02: frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx「展开区默认只列 agent 行，命令行/其他收进按钮展开」
FR-03: frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx「已删除文件行可点击并弹窗如实说明（FR-03）」+ frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「删除文件无补丁时如实说明删除」
FR-04: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「无补丁说明如实表述不断言唯一原因」
FR-05: frontend/src/components/daemon/file-changes（全族目录）+ 触及面 vitest + pnpm exec tsc --noEmit 构建证据
