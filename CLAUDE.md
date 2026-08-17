<!-- SillySpec v3.26.9 — 由 sillyspec init 生成，可自由编辑；重跑 init 同版本不更新 -->
# Claude Code 指引

## 项目说明
本项目使用 **SillySpec** 管理变更，采用文档驱动开发。SillySpec 是给 Agent 调用的 CLI 流程控制器，不是给人类直接使用的产品，也不是处理业务逻辑的工具——你（Agent）通过 CLI 告诉它"我在哪"，它告诉你"下一步做什么"；你执行步骤，它校验产出、推进状态，人类只在关键决策点介入审批。要考虑多 agent 同时操作代码，代码随时可能变化。所有变更以稳定、可用、可维护为目标，按生产级标准处理。

## 核心规则
1. **禁止绕过本文件规则和 SillySpec 流程**。所有变更走 sillyspec 流程，不裸改裸提交。
2. **改代码前必须先说明依据**——依据的文档路径（design.md / 模块文档 / file-lifecycle.md）或现有代码依据，无依据不改。
3. **新功能 / 大改动走完整流程**：`brainstorm → plan → execute → verify → archive`。
4. **小修复 / 小调整走 quick**：`sillyspec run quick`。
5. **执行顺序**：文档 → 读代码 → 写测试 → 写实现 → 跑测试 → 验收 → 更新文档。
6. **判规模选档**：≤3 文件、范围明确走 `quick`；多阶段 / 架构级走完整流程。
7. **代码先行不补流程（倒推 B 模式）**：代码若已先写好，**不回头补 brainstorm/plan 装样子**——用 `quick --done` 收尾 + 补 quicklog 条目，把已落盘改动如实登记进进度库。
8. **实证核验再 `--done`**：`quick --done` 前，触及 `src`/`test` 的改动先 `npm test` + `npm run lint`；纯 doc/配置改动可跳过（lint 不扫 docs/，空转无信息），以落盘文件与测试结果为准，不信口头"已完成"。
9. **中途停下不靠额外命令存进度**——进度已由上一次 `--done` 自动落盘；恢复时用 `sillyspec progress show` 查看进度，再用 `sillyspec run <stage>` 续跑，不直接 commit 半成品。
10. **实现完成后对照文档验收**（design.md / 模块文档），并检查是否影响已有测试。
11. **非测试逻辑本身有误时，禁止改测试来"通过"**——修逻辑，不修测试。
12. **hook 拦截提交时禁止跳过**（`.husky/pre-push`），修复问题后再提交。
13. **代码必须兼容 Windows / Linux / macOS**（路径 / 换行 / 并发都要顾）。
14. **任务记录隔离**：永不重置 / reset / 清零已存在的 change；多个活跃 change 各自 `--change <名>` 隔离不重叠；quick 同一 QUICKLOG 按 ql-ID 条目追加，不冲突。
15. **quicklog 手动精修**：CLI 只写骨架，`--done` 后手动补语义化标题 / 文件多行带括注 / 结果四段。
16. **代码可能随时在修改**（多 agent 并行），Edit 前重跑 + 查最新态；破坏性 git op 前先备份。
17. **不奉承用户**，禁止"你说得对"类话术，直接给结论、依据、方案。
