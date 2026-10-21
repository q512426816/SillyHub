---
author: flow-machine-draft
created_at: 2026-10-21T01:10:27.665Z
---
# 需求规格（Requirements）— 2026-10-21-gitlog-conflict-quotepath

## 功能需求

### FR-01: _listConflictFiles 的 git diff --name-only 调用统一带 -c core.quotepath=false，残余 C 引号形态经 decodeGitCQuote 解码为原文

- `_listConflictFiles` 的 `git diff --name-only --diff-filter=U` 调用**必须**带 `-c core.quotepath=false`（per-invocation，禁止写宿主 git config）；每行冲突路径**必须**经 `decodeGitCQuote` 解码（兜 `quotepath=false` 下 git 对字面 `"`/`\`/控制字符仍强制 C 引号的残余面），非引号形态**必须**原样透传。`gitMerge` 自身的 `merge --no-ff` 调用**禁止**加该参数（其 stdout 不做路径解析，保持最小面）。

#### 场景：主路径

- Given worker 分支与主干对中文文件名（如 `导入模板框线/说明.md`）同区域各自改动后执行 gitMerge 产生冲突
- When `_listConflictFiles` 列举冲突文件
- Then 返回的 `conflicts[].file` 为未转义中文原文（修复前为带引号八进制转义形态，且后续 readFile 失配使 marker_lines 落 catch 归 0）

#### 场景：残余强制引号

- Given 冲突文件名含字面双引号（git 在 quotepath=false 下仍强制 C 引号包裹该行）
- When `_listConflictFiles` 解析该行
- Then 解码还原出含字面 `"` 的原文件名，readFile 以真实路径命中

### FR-02: daemon 单测覆盖中文冲突文件名解析，真实 git 集成实测中文文件名 merge 冲突：conflicts[].file 为原文且 marker_lines 正确计数

- daemon mock 单测**必须**覆盖：冲突列举命令构造含 `-c core.quotepath=false`、C 引号中文路径行解码进 `conflicts[].file`；真实 git 集成测试（不 mock execFile）**必须**构造中文文件名 merge 冲突并断言 `conflicts[].file` 与真实路径逐字符相等、`marker_lines` 为实际冲突标记行数。

#### 场景：真实仓端到端

- Given 真实临时仓含中文文件名、主干与 worker 分支同区域分叉提交
- When 调用 gitMerge 触发真实 merge 冲突
- Then `ok:false`、`conflicts[].file` 与真实中文路径逐字符相等、`marker_lines` ≥ 2 且与文件内标记行数一致

### FR-03: 跑 git merge 相关既有测试全绿，daemon tsc 零错

- `host-fs-handler-worktree.test.ts` 的 git_merge 既有用例（WT3/WT3b/WT4/WT4b/WT4c）**必须**全绿（插入参数不破坏既有命令构造断言），daemon `tsc --noEmit` **必须**零错误。

#### 场景：主路径

- When 跑 sillyhub-daemon vitest（worktree 测试文件）与 tsc --noEmit
- Then 全部用例通过、编译零错误

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/host-fs-handler-worktree.test.ts「WT4d 冲突列举命令带 -c core.quotepath=false + C 引号中文路径解码」
FR-02: sillyhub-daemon/tests/host-fs-handler-git-log-quotepath.test.ts「真实 git 中文文件名 merge 冲突：conflicts[].file 原文 + marker_lines 计数」
FR-03: sillyhub-daemon/tests/host-fs-handler-worktree.test.ts「WT3/WT3b/WT4/WT4b/WT4c 既有回归全绿」（tsc 以 pnpm exec tsc --noEmit 验证，无独立测试文件）
