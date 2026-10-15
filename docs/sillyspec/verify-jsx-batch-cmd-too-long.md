# verify 门禁 jsx 批在 Windows 恒败「命令行太长」（137 文件单命令超 cmd 上限）

- **现象**（2026-10-15，2026-10-15-zcode-engine-appserver verify 阶段实证）：变更触碰被广泛引用的前端文件（`frontend/src/lib/daemon/runtimes.ts`）→ deps 依赖发现拉出 137 个前端测试文件；`buildDepsBatches` 把 jsx 批拼成单条 `cd frontend && pnpm exec vitest run <137 个带引号路径>`（约万字符），Windows cmd 执行器上限 ~8191 → `命令行太长。` exit 1（129ms 即败）。且失败批进入增量账本（「前轮失败批」），后续每次 gate 重跑都复拼同一超长命令 → **自我循环恒败，verify 无法收口**。
- **根因**：`sillyspec/src/verify-postcheck.js` 的 `buildDepsBatches` 对 jsx（vitest/jest）与 node --test 批无命令长度分块；文件数帽（CAP=30）对「优先面（变更文件 + FR 绑定回归面）」整跑豁免——广引用文件变更时优先面轻松破百，帽形同不存在。
- **绕过/修复**（已实施，未提交）：给该函数加 `chunkByCommandLength(prefix, files, maxLen=6000)`，jsx 与 node --test 两批按「前缀 + 逐文件参数拼接总长」分块；单块保持原批名 `deps(auto-jsx)`（零回归），多块命名 `deps(auto-jsx:N/M)` 独立计账。补丁位置：`C:/Users/qinyi/IdeaProjects/sillyspec/src/verify-postcheck.js`（该工具仓当前工作区还有其他 WIP，未代为提交——需用户自行 commit 到 sillyspec 仓）。验证：`node --test test/dynamic-test-inference.test.mjs`（10 过 0 败）、`dynamic-deps-comment-edge.test.mjs`（8/0）、`residual-runner-parity.test.mjs`（5/0）+ 平台侧 gate 复跑通过（jsx 批分 96+60 两块全绿）。
- **建议工具修复（上游化）**：分块逻辑并入 sillyspec 仓并补 `buildDepsBatches` 单测（超长输入分块/单块零回归/命名规则）；可选把 maxLen 按平台默认（Windows 6000 / POSIX 更大）。

## 连带暴露的另两项（同批修复，同一调用链）

- **jsx 批混包根恒败**：分块后暴露——frontend 与 sillyhub-daemon 两包根的测试被拼进同一条 `cd frontend && pnpm exec vitest run`（runner 取全局首个文件的最近 package.json），非本根路径在其 cwd 下「No test files found」exit 1。修复：逐文件按自身包根 `inferJsxRunner` 分组（`hits` 显式命中保持整批旧语义；全局推断降级为兜底）。
- **trace 悬空判定不识别 worktree**：绑定行引用 worktree 内新增测试文件时，悬空判定按主仓根解析 → 恒报「测试绑定悬空」阻断 verify（文件在 worktree 真实存在）。修复：`traceMainRoots`（读变更 meta.json 的 worktreePath）+ 悬空判定/残差执行多根解析。
- 三修合并验证：工具侧 node --test 三文件 25/25 绿；平台侧 verify --done 全绿收口（2026-10-15 18:12）。

## 补充实证（2026-10-15-dsh-engine-acp，第二实例，规模更大）

- 现象同款：jsx 批 138 →（失败重入）155 → 159 递增，`⚡ 增量重跑面` 141→159；自 15:23 起
  连续多轮 `命令行太长。`（含 16:16 轮仍复现）。分块补丁观测：16:16 最后一轮失败时补丁未生效；
  工具仓 `src/verify-postcheck.js` 于 16:33 后在树（`chunkByCommandLength` :2831，jsNative :2988 /
  jsx :3010 双接线，未提交）——补丁落地晚于本变更最后的失败轮，与「已实施未提交」吻合。
- 逃生口（与分块补丁并行的第二条路，本次实际使用）：`local.yaml test_strategy: full` 切
  `commands.test`（无 argv 文件清单）一轮全绿收口，用完已还原 `module`——适用「补丁未落地 /
  需单轮强制收口」场景；注意还原，避免拖慢后续会话的全部 verify。
- 交叉缺陷（独立记账，账本语义面）：`verify-incremental-rerun-infra-batch-growth.md`
  （失败批账本不区分基建失败 → 膨胀 + RERUN 签名无基建维度）。
