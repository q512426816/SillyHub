<!-- SillySpec v3.33.1 START — 由 sillyspec init 注入，勿手动编辑此段 -->
# Agent 指引

## 项目说明
本项目使用 **SillySpec** 管理变更，采用文档驱动开发。SillySpec 是给 Agent 调用的 CLI 流程控制器：你通过 CLI 告诉它"我在哪"，它告诉你"下一步做什么"；你执行步骤，它校验产出、推进状态，人类只在关键决策点介入审批。要考虑多 agent 同时操作代码，代码随时可能变化。所有变更以稳定、可用、可维护为目标，按生产级标准处理。

## 选道（动手前先对号入座）
| 需求形态 | 走法 |
|---|---|
| 需求已含决策（改什么、成功标准说得清——成功标准须来自**用户原话或既有文档转写**；要靠你推断拟出的标准＝需求不清晰） | **轻量变更（默认快道）**：`flow start` → 直接干活 → `flow done`（2 次协议调用；操作细节见 `/sillyspec:flow` skill 与 flow start 输出） |
| 用户显式要求极速（「极速/别验证/只要 spec 和代码」类原话）且需求已含决策 | **轻量变更极速版**：同上行加 `--turbo`（`flow start --change <名> --input "<...>" --turbo`）——**仅用户显式触发，禁止你自行启用**；收口跳过实测与重仪式门（hunk/dirty/ui 探针/评审），spec 结构校验/tasks 全勾/ledger/patch 冻结/distill/归档照常（跳的是验证不是证据）；升厚即失效恢复全量仪式；收口输出显式标注「不含测试客观核验」。预段组合极速：头脑风暴预段走轻量跑判定+单轮合并问询+burst 一次 --done，收编时按用户要求带 --turbo |
| 需求不清晰 / 需要方案探索（含「成功标准要你替用户拟」的形态——自己拟标准再自答是把默认共识伪装成共识） | 头脑风暴预段：`run brainstorm --change <名>` → 完成后 `flow start --change <名>` 收编续跑（design 以头脑风暴版为准）。上个轻量变更被 route-hindsight 标记时全新 start 会被同意门拦下要求显式选道：确认已含决策带 `--no-prestage` 声明留痕，否则先走本行预段 |
| 大改动：跨模块取舍 / Wave 计划编排 / 多阶段治理 / 设计期人机对抗 | 完整流程五阶段：`run brainstorm → plan → execute → verify → archive`（每阶段一次渲染 + 一次 --done 收口；细节见各阶段 skill 与 CLI 输出） |
| 代码已先写好（倒推收尾） | 不回头补流程装样子：`flow start --change <YYYY-MM-DD-名> --input` 按下方过门格式写（动机=已做改动的描述，成功标准=已验证达标的行为）→ `flow done` 一步收口 |

`--input` 过门格式（轻量道首次调用即过，勿靠报错学；引号内换行合法，下例可照抄）：

```bash
sillyspec flow start --change <YYYY-MM-DD-名> --input "<一句 10-30 字中文概括（首行即变更标题，必须落在 10-30 字硬区间、建议 ~20 字——不合区间 flow start 拒启）；随后动机与背景

成功标准：
- <可验证标准>"
```

选道看流程形态需求，不看技术关键词——风险面由收口评审按证据（承诺词/diff 原语/盲维作答）判定。轻量→完整转道是用户决策：须征得用户同意并带 `--upgrade-thick`（同意门留痕，无 flag 拒跑）；轻量变更实测失败自动升厚。

## 恢复与查看
- 轻量变更恢复：重跑 `sillyspec flow start --change <名>`（输出恢复简报）或 `flow status --change <名>`；完整流程恢复：`run <stage> --change <名>` 续跑。不直接 commit 半成品
- 跨会话交接：`sillyspec handoff --change <名>`；变更列表：`sillyspec status`；自检修复：`sillyspec doctor`
- 知识库：`sillyspec knowledge search "<关键词>"`（命中知识 CLI 会自动注入 prompt，勿自行重复检索）

## 核心规则
1. **禁止绕过本文件规则和 SillySpec 流程**。所有变更走 sillyspec 流程，不裸改裸提交。
2. **改代码前必须先说明依据**——依据的文档路径（design.md / 模块文档 / file-lifecycle.md（如有））或现有代码依据，无依据不改。
3. **执行顺序**：文档 → 读代码 → 写测试 → 写实现 → 跑测试 → 验收 → 更新文档。测试按层适用：纯逻辑先写测试，行为契约断言用户可见行为，视觉样式与纯配置/文档不写测试（记「不适用：理由」，验收靠规范与人工）。
4. **实证核验再收口**：触及 `src`/`test` 的改动，CLI 会在收口时亲自实测（实测失败阻断收口；纯 doc/配置自动跳过）。测试面按变更动态推断（本变更测试 ∪ FR 关联回归 ∪ import 依赖，runner 自项目结构推断——无需配置）；lint 走 `.sillyspec/local.yaml` 的 `commands.lint`。以落盘文件与测试结果为准，不信口头"已完成"。
5. **非测试逻辑本身有误时，禁止改测试来"通过"**——修逻辑，不修测试。
6. **git hook 拦截提交时禁止跳过**（如 `.husky/pre-push`），修复问题后再提交。
7. **代码必须兼容 Windows / Linux / macOS**（路径 / 换行 / 并发都要顾）。
8. **任务记录隔离**：永不重置 / reset / 清零已存在的 change；多个活跃 change 各自 `--change <名>` 隔离不重叠。
9. **代码可能随时在修改**（多 agent 并行），Edit 前重跑 + 查最新态；破坏性 git op 前先备份。
10. **会话启动先立身份**：`export SILLYSPEC_SESSION_ID=<唯一标识>`（如 agent 名+任务名）——多会话并行时 change 所有权判定（apply / cleanup / 归档对他会话活跃变更的接管拒绝）依赖此标识；缺省降级为 `anon@<主机名>` 机器级标识（只拦他机，同机并行不设防）。部分 harness 的 shell 状态不持久（env 随命令丢失），此时接管类命令每条显式带 flag：`sillyspec worktree apply <change> --session <唯一标识>`（`--session` 优先级高于 env）。
11. **禁止目录级 git add / git add -A**（多会话共享仓）：目录级暂存会夹带并行会话的进行中文件甚至误删已提交文件。提交一律用显式 pathspec，且 **add 与 commit 用同一份清单**：`git commit -m "..." -- 文件1 文件2`——带 pathspec 的 commit 只提交这些路径，他侧已 staged 的条目既不被带走、也原样留给对方；裸 `git commit` 提交的是整个共享暂存区，他会话 add 过的文件会被一并扫入。核对暂存面固定用 `git diff --cached --name-only` 全量读取，禁用过滤式核对（过滤正是致盲原因）；核对与提交分开两条命令执行，不得链在同一命令里（链行没有拦截点）。安装了 commit-guard hook 的仓会对超声明面的 staged 文件警告（只警告不阻断）。
12. **不奉承用户**，禁止"你说得对"类话术，直接给结论、依据、方案。
13. **边干边勾（任务进度唯一源=变更的 tasks.md）**：完成一个任务单元（实现到位 + 相关测试跑绿）当场勾对应格——`sillyspec task tick --change <名> --task task-NN`（即时回显进度与下一任务）或直接 Edit 翻格 `- [ ]`→`- [x]`，勿攒到收口一把勾。harness 自带的 TodoWrite 类工具是会话内便利面，不替代 tasks.md——平台进度投影、收口哨兵、断点恢复只读 tasks.md。
<!-- SillySpec END -->
