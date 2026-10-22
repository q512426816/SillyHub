---
author: flow-machine-draft
created_at: 2026-10-21T01:35:13.760Z
---
# 需求规格（Requirements）— 2026-10-21-precommit-cleanup

## 功能需求

### FR-01: .tmp/hooks 会话等价 hook 面删除，仓内无任何链路再引用它（配置注释与知识文档统一指向官方链 + export PRE_COMMIT_HOME 会话指引）

- `.tmp/hooks/` 目录（会话自建的等价 pre-commit hook 面，已被 2026-10-21-precommit-sandbox-entries 官方链替代）**必须**整个删除且不再重建；仓内活跃面（配置/文档注释，归档件属历史留痕不改写）**禁止**再引用 `.tmp/hooks` 作为提交通道——agent 会话提交统一走默认 `.git/hooks` 官方链 + 会话级 `export PRE_COMMIT_HOME="$PWD/.tmp/pre-commit-home"`。

#### 场景：主路径

- Given `.tmp/hooks/pre-commit` 是 2026-10-21-gitlog-quotepath-fix 会话在官方 runner 不可用期自建的等价面
- When 官方链恢复后清理
- Then `.tmp/hooks` 不存在；全仓活跃文件（排除 `changes/archive/` 历史留痕与 `.tmp/` 自身）grep `.tmp/hooks` 零命中

### FR-02: .sillyspec/knowledge 新增「agent 沙箱 python 子树 Low IL 限制」条目：症状（python→msys 嵌套 0xC0000022 崩、profile 缓存写被拒）、根因（沙箱驱动降 IL、token 无 CodexSandboxUsers、DACL 修复无效）、WSL bash 误解析坑（python spawn bash 命中 System32 WSL 而非 Git Bash）、处置（去 msys 入口 + PRE_COMMIT_HOME 会话指引），INDEX 可路由

- `known-issues.md` **必须**新增 🟡 条目，内容**必须**覆盖四要素：①症状（python 子树发起的 msys 进程崩于 `NtCreateDirectoryObject \BaseNamedObjects\msys-2.0S5-*` 0xC0000022；`~/.cache`、uv/pnpm profile 缓存写被拒）；②根因（沙箱驱动把 python.exe 子树 Mandatory Label 降为 Low S-1-16-4096，嵌套 token 同用户但无 CodexSandboxUsers 组、Administrators deny-only，Medium 标签对象目录打不开、拒绝在驱动白名单层——**必须**写明 icacls/DACL 修复无效，禁止再尝试）；③WSL bash 误解析坑（python 子进程 spawn `bash` 按 Windows PATH 命中 `C:\Windows\System32\bash.exe` 而非 Git Bash，本机 WSL 自身 E_ACCESSDENIED）；④处置（hook 入口去 msys 化引 2026-10-21-precommit-sandbox-entries；`export PRE_COMMIT_HOME` 会话指引；node 子树不受影响）。INDEX.md **必须**加对应路由行（关键词含 沙箱/Low IL/msys/0xC0000022/pre-commit/WSL bash/PRE_COMMIT_HOME）。

#### 场景：主路径

- Given 后续 agent 会话在 python 子树内遇到 msys 崩或 profile 写拒绝
- When 按关键词查知识库
- Then 能路由到该条目并按处置指引直接行动，不再重复本变更的整条探针链

### FR-03: sillyspec knowledge search 关键词实证命中；交付提交走默认官方 hook 链留痕

- `sillyspec knowledge search` 以「沙箱 Low IL」类关键词检索**必须**命中新条目（输出留痕进交付提交消息）；交付提交**必须**经默认 `.git/hooks` 官方链完成（仅设会话 PRE_COMMIT_HOME，禁止 core.hooksPath 覆盖与 --no-verify），hook 执行回执写进提交消息。

#### 场景：主路径

- When 执行 search 与交付提交
- Then search 输出含新条目；git log 该提交消息含官方 hook 链回执（assertion-surfaces Passed 等）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：gitignored 运行时残留删除与文档注释核验，无测试面（规则 3）；验证=grep 零命中回执写进交付提交消息。
FR-02: 不适用：纯知识文档（规则 3：纯文档不写测试）；验证=INDEX 路由行在位 + FR-03 search 命中。
FR-03: 不适用：CLI 运行时行为验证（search 输出与 hook 回执留痕提交消息），非测试文件面。
