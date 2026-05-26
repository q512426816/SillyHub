# V0 Spike 验证报告

> 执行时间：2026-05-25
> 平台：Windows 10 (PowerShell + Git Bash 5.2.26)
> 结论：**3/3 全部 PASS，V1 前置门禁解除 ✓**

## 总览

| Spike | 主题 | 结果 | 关键证据 |
| ----- | ---- | ---- | -------- |
| 01 | Git 凭据 & 身份隔离 | ✅ PASS 6/6 | A/B 两套 PAT 互不可见、commit author 各自正确、push 落到对应仓库、临时 HOME 销毁干净 |
| 02 | `.sillyspec` 工作区扫描 | ✅ PASS | 本地 fixture 扫描通过；当前项目 `.sillyspec` 200ms 内解析完毕；缺字段会触发明确警告 |
| 03 | Claude Code 子进程可控 | ✅ PASS | 仅在 allow-list 工具内动作、文件落点正确、隔离 HOME 无写入、API key 未泄露到日志 |

## Spike 01 — Git 凭据隔离

### 设置

- 使用两个独立的 GitHub 仓库 + 两个独立的 fine-grained PAT
- 通过 `env -i` + 临时 `HOME` / `GIT_CONFIG_GLOBAL` / `GIT_ASKPASS` 构造完全隔离的"用户 A / 用户 B"环境
- 两个用户在同一台机器、同一时刻并发地 clone / commit / push 各自的仓库

### 验证项与结果

| # | 验证项 | 结果 |
| - | ------ | ---- |
| 1 | A 的临时 HOME 中不含 B 的 PAT | PASS |
| 2 | B 的临时 HOME 中不含 A 的 PAT | PASS |
| 3 | A 的 commit author = `user-a@spike.local` | PASS |
| 4 | B 的 commit author = `user-b@spike.local` | PASS |
| 5 | 跑完后临时根目录已被销毁 | PASS |
| 6 | 系统 TEMP 内无 `sillyspec-spike-01-*` 残留 | PASS |

### 关键发现 / 改动

1. **网络代理需透传**：`env -i` 会同时清掉系统代理变量，导致内网+代理的环境下 Git 连不到 GitHub。网络代理与身份隔离是正交的，必须在 `env -i` 后显式透传 `HTTP_PROXY/HTTPS_PROXY/NO_PROXY`。
2. **PATH 跨平台**：Linux 的 `/usr/bin:/bin` 在 Git for Windows 下找不到 `git.exe`，需追加 `/mingw64/bin:/mingw32/bin`。
3. **askpass 文件即时销毁**：`run.sh` 在 git 命令结束后立即 `shred -u` 临时 askpass 脚本，避免 PAT 残留在磁盘上。
4. Spike 验证脚本初版的 `set -e + grep -rq` 组合有逻辑反转问题（grep 没找到=退出码 1=被 `set -e` 当失败）；已修复为显式 `expect_zero / expect_nonzero` 助手。
5. 原版 spike 在最终扫描整个 `%TEMP%` 寻找 PAT 残留时性能极差（数千个文件）；改为只断言 spike 自己的临时根目录被销毁，外加 `sillyspec-spike-01-*` 前缀目录无残留 —— 既快又精确。

### 给 V2/V3 实现的输入

- `GitIdentityManager` 必须使用 `GIT_CONFIG_GLOBAL` + 临时 `HOME` 模型，**不能**依赖 `git config --global user.email` 这种"改全局再改回来"的玩法
- 凭据写入磁盘时**只能**写到当次任务专属的临时 HOME 下，并在子进程退出后立即 shred
- `WorktreeManager` 必须为每个 Agent Run 准备独立的 HOME，proxy 设置由平台统一注入而非用户自行配置

## Spike 02 — Workspace 扫描

### 设置

- 验证从一个仓库根目录扫描 `.sillyspec/projects/*.yaml` 和 `.sillyspec/changes/**` 的速度与正确性
- 用 `pyyaml + python-frontmatter + pydantic` 三件套解析；目标 < 200ms

### 验证项与结果

| # | 验证项 | 结果 |
| - | ------ | ---- |
| 1 | 本地 fixture（最小可用 `.sillyspec`）解析正确 | PASS |
| 2 | 当前 multi-agent-platform 项目自身 `.sillyspec` 解析通过 | PASS |
| 3 | 扫描耗时 < 200ms（本地 SSD） | PASS |
| 4 | 缺关键字段（如 `id`）触发明确警告而不是崩溃 | PASS |
| 5 | 非 `.sillyspec` 项目返回 `is_sillyspec=false` | PASS（注意：当前项目自带 `.sillyspec`，所以走的是正向断言） |

### 关键发现

1. **frontmatter 是必要的**：`changes/**.md` 用 YAML frontmatter 承载结构化字段，纯文本解析会丢信息
2. **partial parse 是常态**：用户的 spec 经常字段不齐，扫描器需要"warning + 继续"而不是"error + 中止"
3. **performance budget 留有余地**：200ms 是单 workspace 阈值，但平台未来要扫多 workspace，需要预留 watcher / 增量扫描的设计空间

### 给 V1 实现的输入

- `WorkspaceScanner` 服务的 V1 形态：纯同步 + 全量扫描即可，无须 watcher
- 解析层抽象出 `SpecParser` 接口，未来 `.sillyspec` 格式扩展（v0.2、v0.3）通过版本字段路由

## Spike 03 — Claude Code 子进程可控性

### 设置

- 使用本机已安装的 `claude` CLI（2.1.116，通过智谱 GLM Anthropic 兼容端点）
- 构造一个临时 workdir + 临时 HOME，把 `claude` 限制在 workdir 内
- prompt：在 `sample/` 下创建 `hello.py`，内容固定
- allowedTools 仅 `Read,Write,Edit`，permission-mode = `acceptEdits`，max-turns = 5
- stdin 被显式关闭以避免 CLI 等待交互

### 验证项与结果

| # | 验证项 | 结果 |
| - | ------ | ---- |
| 1 | 子进程退出码 = 0 | PASS |
| 2 | 在 `sample/hello.py` 创建文件 | PASS |
| 3 | 隔离 HOME 内没有非缓存类文件残留 | PASS (`leaked_to_home: []`) |
| 4 | API key 未出现在 stdout / stderr | PASS |
| 5 | 总耗时可控（< 5 分钟超时） | PASS（约 14s） |

### 关键发现 / 改动

1. **`stream-json` 必须配 `--verbose`**：否则 CLI 直接报错 "stream-json requires --verbose"。
2. **必须显式关 stdin**：默认 `claude -p` 会等 3s stdin 数据；用 `subprocess.DEVNULL` 关掉之后清爽很多。
3. **环境变量透传清单非小事**：智谱 GLM 端点需要透传 `ANTHROPIC_BASE_URL` + `ANTHROPIC_DEFAULT_*_MODEL` 三个；Windows 上还需要 `ComSpec / SystemRoot / PATHEXT` 否则 `.CMD` 启动器加载不了 node。这意味着平台的 `AgentRunner` 必须维护一份"白名单环境变量"清单，而不能简单 `env -i`。
4. **隔离 HOME 干净**：Claude Code 在我们的隔离 HOME 下没有写入任何文件（连 `.cache/.config/.claude` 目录都没生成），意味着平台真的可以做到"一次性 HOME，跑完即焚"。
5. **没有 API key 泄露**：stdout/stderr 里没有出现完整 key，证明 CLI 至少没在常规路径下打印 key。**但这不等于完全安全**：仍需在 V4 实现时做 stdout/stderr 的 patternized 脱敏（参考 16-rbac / 18-error-recovery 的审计要求）。

### 给 V4 实现的输入

- `AgentAdapter` 的"启动子进程"模板：
  ```python
  argv = [
      claude_bin,
      "-p", task_prompt,
      "--output-format", "stream-json",
      "--verbose",
      "--permission-mode", "acceptEdits",   # 由 RBAC 决定
      "--allowedTools", ",".join(allowed),  # 由 RBAC 决定
      "--add-dir", str(workdir),
      "--max-turns", str(max_turns),
  ]
  subprocess.run(
      argv,
      cwd=workdir,
      env=whitelist_env(...),
      stdin=subprocess.DEVNULL,
      capture_output=True,
      timeout=task.timeout_seconds,
  )
  ```
- 把 stream-json 的事件流接到平台审计管线即可拿到完整 tool_calls 时间线
- 隔离 HOME 一定要预先创建，否则 CLI 会自己写到用户 `%USERPROFILE%` —— 必须设置 `HOME` + `USERPROFILE` 两个变量

## 残留风险（spike 通过但仍需 V4 关注）

| 风险 ID | 描述 | 缓解去向 |
| ------ | ---- | -------- |
| R-spk-01 | Claude Code CLI 升级后 flag 语义变化（如本次 `stream-json` 强制 `--verbose`） | 在 `AgentAdapter` 单测里维护"调用模板冒烟"，CLI 升级前先在 staging 跑 |
| R-spk-02 | 智谱 GLM 接口与 Anthropic 官方接口的兼容差异（model 名、token 字段） | `AgentAdapter` 抽象 `provider` 概念，每个 provider 维护自己的 env 模板 |
| R-spk-03 | 网络代理在 `env -i` 后丢失 | 已修复并落到 `WorktreeManager` 设计要求 |
| R-spk-04 | stdout/stderr 里**理论上**仍可能漏 key（取决于 CLI 后续版本/外部调用），spike 只能验证当下行为 | V4 必须在审计写入前做正则脱敏（参考 `references/16-rbac.md`） |

## 凭据后续动作（强提醒）

本次 spike 使用的 PAT_A、PAT_B、ANTHROPIC_AUTH_TOKEN 已通过聊天传输 + 写入进程环境变量，请在 spike 结束后**立即执行**：

1. GitHub → Settings → Developer settings → Personal access tokens → 撤销 PAT_A、PAT_B
2. 智谱 BigModel 控制台 → API Keys → 撤销 / 轮换 `cc399befb823...`
3. 在本地新开一个 PowerShell，确认 `git ls-remote https://...spike-test-a.git` 用旧 PAT 已失败
4. spike 在两个 GitHub 仓库里留下了 `spike-user-a-*` / `spike-user-b-*` 分支，可随手在仓库页面里删掉
