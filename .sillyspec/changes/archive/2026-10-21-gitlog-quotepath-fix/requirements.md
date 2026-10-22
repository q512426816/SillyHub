---
author: flow-machine-draft
created_at: 2026-10-21T00:44:22.606Z
---
# 需求规格（Requirements）— 2026-10-21-gitlog-quotepath-fix

## 功能需求

### FR-01: gitShow/gitDiffFile/gitStatus 的 git 调用统一带 -c core.quotepath=false，numstat 残余 C 引号路径在 daemon 侧解码为原文

- gitShow 与 gitDiffFile 的 `git show` 调用、gitStatus 的 porcelain v2 与 numstat 两条调用**必须**带 `-c core.quotepath=false`（per-invocation，不写宿主 git config；`git remote` / `git fetch` 不显示路径，**禁止**添加）；gitShow 的 numstat 解析**必须**对残余 C 引号形态路径（`core.quotepath=false` 下 git 对含字面 `"`、`\`、控制字符的路径仍强制引号包裹）按 git 引号规则解码为原文（UTF-8 还原），非引号形态路径**必须**原样透传。

#### 场景：中文路径主路径

- Given 宿主机 git（默认 core.quotepath=true）对含中文目录的提交输出 numstat，路径为 `".sillyspec/changes/2026-10-20-unitLedger\345\257\274\345\205\245\346\250\241\346\235\277\346\241\206\347\272\277/design.md"` 引号转义形态
- When daemon gitShow 解析该输出
- Then 返回的 files[].path 为解码后的中文原文 `.sillyspec/changes/2026-10-20-unitLedger导入模板框线/design.md`，不含引号与八进制转义

#### 场景：残余强制引号

- Given 文件名含字面双引号或反斜杠（`core.quotepath=false` 下 git 仍强制 C 引号包裹）
- When daemon gitShow 解析该 numstat 行
- Then 解码还原出含字面 `"` / `\` 的原文件名

#### 场景：diff pathspec 回查

- Given gitShow 返回的解码后中文路径
- When 以该路径调用 gitDiffFile
- Then daemon 以原文路径作为 pathspec 执行 `git show <sha> -- <path>`，返回非空 unified diff（修复前转义串匹配不到 → 空 diff）

### FR-02: daemon 单测覆盖中文路径 numstat 解码与 diff pathspec 回查，前端 file-tree 覆盖中文路径聚合

- daemon 单测**必须**覆盖：decodeGitCQuote 纯函数（中文八进制转义 / 嵌入引号反斜杠 / 控制字符 / 非引号原样 / 畸形串原样）、中文路径 numstat 解码、gitShow/gitDiffFile/gitStatus 命令构造含 `-c core.quotepath=false`；前端 buildFileTree **必须**覆盖中文路径段聚合与叶子以中文路径发起 diff 请求（点击前零请求语义不回归）。既有 args 索引断言用例（GL25/GL29/GL37/GL42/GL43/GL45）**必须**随参数插入同步更新。

#### 场景：前端中文路径聚合

- Given files 含 `docs/中文目录/文件.md` 形态中文路径
- When buildFileTree 聚合并渲染
- Then 目录节点名为「中文目录」、叶子名为「文件.md」，点击叶子以完整中文路径发起 diff 请求

### FR-03: 实测含中文目录提交：树展示正确中文、点击文件返回非空 diff

- 以真实临时仓库（真实 `git init` + 含中文目录的真实提交，非 mock stdout）**必须**实测：gitShow 返回正确中文路径，且 gitDiffFile 以该路径回查返回非空 diff（含新增行内容）；daemon TypeScript 编译**必须**零错误。

#### 场景：真实仓端到端

- Given 真实临时仓含 `导入模板框线测试/中文说明.md` 的真实提交
- When 依次调用 gitShow 与 gitDiffFile
- Then gitShow 解码路径与真实路径逐字符相等，gitDiffFile 返回非空 diff 且含新增行内容

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/host-fs-handler-git-log-quotepath.test.ts「真实仓中文路径 gitShow 解码 + gitDiffFile 回查非空 diff」；sillyhub-daemon/tests/host-fs-handler-git-log.test.ts「GL46 命令构造——gitShow/gitDiffFile/gitStatus 带 -c core.quotepath=false」
FR-02: sillyhub-daemon/tests/host-fs-handler-git-log.test.ts「GL47 decodeGitCQuote 纯函数五形态」「GL48 中文引号路径 numstat 解码」；frontend/src/components/git-log/__tests__/file-tree.test.tsx「中文路径聚合与叶子点击发起中文 path 请求」
FR-03: sillyhub-daemon/tests/host-fs-handler-git-log-quotepath.test.ts「真实临时仓端到端：含中文目录真实提交」（真实 git 执行，非 mock；编译验证 daemon tsc --noEmit）
