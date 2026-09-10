# ai-toolbox 供应商 / MCP / Skills / 插件管理能力调研

- 调研日期：2026-09-10
- 调研对象：github.com/coulsontl/ai-toolbox（本地克隆 `C:\Users\qinyi\IdeaProjects\ai-toolbox`，commit `369af98`，2026-09-10）
- 调研动机：SillyHub 在供应商切换之外的"配置资产管理"（MCP 库、技能库、插件）能力欠缺，学习该项目的成熟模式
- 配套方案：`docs/proposal-config-management-capability-2026-09-10.md`（基于本调研的平台补强方案）
- 参考先例：`research-multica-agent-adaptation.md`（multica 调研，agent 运行时抽象的输入）

## 0. 项目概况

ai-toolbox 是跨平台桌面应用（Tauri 2.x + Rust 后端 + React 19 + AntD 6 + Zustand + SQLite），定位"个人 AI 工具箱"，一站式管理各类 AI 编程 CLI 的配置。1.4k star，MIT，更新活跃。支持 15+ 工具：Claude Code / Claude Desktop / Codex / Gemini CLI / OpenCode / OpenClaw / Grok / Kimi / Cursor / Windsurf / Pi / Hermes / DSH / Qwen / Antigravity 等。

核心功能：供应商切换、本机代理网关（协议转换/故障切换/用量统计）、MCP 管理、Skills 管理、会话管理、WSL/SSH 同步、备份。

## 1. 统一设计模式（最值得学的部分）

四个管理模块全部建立在同一架构模式上：

> **中央主数据（SQLite JSONB）是唯一事实源；工具的运行时配置文件永远只是"投影"；单向推送（中央 → 工具），反向只有显式"导入"；所有变更走统一事件总线联动。**

| 模块 | 中央主数据 | 投影目标 | 核心难点 |
|---|---|---|---|
| 供应商 | 每工具一张 JSONB 表 + `is_applied` 唯一生效标志 | settings.json / config.toml+auth.json / .env / opencode.json | 写文件时的保守合并（不破坏用户手工字段） |
| MCP | `mcp_server` 表（统一格式）+ `enabled_tools` | 17+ 工具 × 5 种格式的转换矩阵 | 一份定义 → N 种方言 |
| Skills | 中央仓库目录 + 目录级 SHA-256 | 20+ 工具的 skills 目录（symlink/junction/copy） | 分发与更新的安全守卫 |
| 插件 | 无中央存储（委托 CLI）/ 配置桥 | `~/.claude/plugins/` 状态 JSON、omo.jsonc | 判断哪些自己做、哪些委托上游 |

支撑这个模式的四个横切机制：

1. **JSONB 通用存储层**（`tauri/src/db/`）：所有表结构统一为 `id + data(JSONB) + created_at + updated_at`，业务字段全在 JSONB 里，用 `json_extract` 表达式索引查询。通用 CRUD（get/list/put/create/delete/patch_fields）+ `db_update_applied_status`（事务内先全表清 `is_applied` 再置目标 true，保证"当前生效"唯一）。
2. **恢复即重放**（`reapply_applied_runtime.rs`）：备份恢复后按固定顺序把每个表中 `is_applied=true` 的记录重新写到运行时文件。体现"SQLite 是事实源、运行时文件是投影"——投影丢了随时可重建。
3. **统一事件契约**：`config-changed`（供应商/通用配置）→ 托盘刷新 + 网关缓存清空 + 前端刷新；`mcp-changed` → WSL 同步 + 前端刷新；`skills-changed` → 前端刷新。事件不保存状态只触发动作，监听方集中在 `lib.rs`。
4. **反向导入有去重规则**：同名同配置 skip、同名异配置改名复制（绝不静默覆盖）；导入来源打 `source_provider_id`（如 `ccs:{app}:{raw_id}`）做持久去重键。

## 2. 供应商管理

### 2.1 数据模型

每工具一套平行四元组（Record/Provider/Content/Input），见 `tauri/src/coding/claude_code/types.rs`（其他工具同构）：

- `settings_config: String`——核心字段，JSON 字符串装着该工具的原生配置片段（Claude 是 `{env: {ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_DEFAULT_*_MODEL}}`）
- `is_applied`（当前生效）、`is_disabled`、`sort_index`、`category`（official/third_party/custom）
- `source_provider_id`（导入去重）、`notes`/`icon`/`website_url`
- `extra_settings_config` + 合并策略（Claude 特有：ProviderOverridesCommon / CommonOverridesProvider / MergeCommonAndProvider）
- OpenCode 例外：供应商是整个 opencode.json 内的 `provider` 映射，无行表

### 2.2 Apply 语义（精华：保守合并写出）

切换供应商 = "DB 记录 + 公共配置深合并 → 保守写出工具原生文件"。每个工具都有"保留用户手工/运行时自有字段"的合并策略：

- **Claude**（`claude_code/settings_merge.rs`）：只替换 `KNOWN_ENV_FIELDS` 清单内的 env 键
- **Codex**（`codex/commands.rs` 的 `write_codex_config_files`）：config.toml 用"上一份管理配置 → 新管理配置"的**差量替换**，用户手工加的非托管 TOML 段原样保留；auth.json 只替换托管字段、保留运行时 OAuth 数据
- **Gemini**：`.env` 文本级合并 + settings.json JSON overlay

配套语义：`select`（只改 DB 不写文件）与 `apply`（写文件）明确区分；删除 provider 只删 DB 记录不动运行时文件；空库首次启动从磁盘自动导入当前配置为默认 provider；每次 apply 记录 `provider_last_used` 供"最近使用"排序。

### 2.3 联动与导入

apply 后发 `config-changed` → 清空网关供应商解析缓存 + 重建托盘菜单 + 前端刷新 + WSL 同步。导入两条链：All API Hub（读浏览器扩展 LevelDB）、CC Switch（只读其 SQLite），去重靠 `sourceProviderId`。

### 2.4 前端共享层

`web/features/coding/shared/` 是"交互语义层"：management 通用控件（卡片/搜索/排序/批量/虚拟网格）、供应商列表语义（搜索/排序模式/批量选择）、连通性批量测试（并发 5）、表单折叠区（自定义请求头/模型重写/计费）、导入弹窗骨架。各工具页持有自己的 service，向 shared 组件注入回调。

## 3. MCP 管理

### 3.1 数据模型（`tauri/src/coding/mcp/types.rs`）

统一格式的 `McpServer`：

- `server_type`（stdio/http/sse）+ `server_config`（stdio → `{command,args,env}`；http → `{url,headers}`；可携带 Codex 专属超时字段）
- `enabled_tools: Vec<String>`——同步到哪些工具的 key 列表（这是"作用域绑定"的表达）
- `sync_details`——每工具最近同步结果 `{tool: {status, synced_at, error_message}}`
- `management_enabled` + `disabled_previous_tools`——禁用时记住历史绑定，重新启用可恢复
- `user_group/user_note/tags/sort_index`——纯内部元数据，不写工具配置
- 收藏 `FavoriteMcp`（预置 7 个常用模板，新增弹窗快速选择）、分组 `McpGroup`（成员按 `user_group` 文本匹配，无外键）

### 3.2 转换矩阵（`mcp/config_sync.rs`，2177 行，核心资产）

一份中央定义推到 17+ 工具，方言差异全部收敛在此：

| 差异点 | 处理方式 |
|---|---|
| 文件格式 | json / json5（容忍注释）/ toml（toml_edit 保留用户注释）/ yaml（字节级 section 切片，文件其余部分逐字节保留）|
| 字段名 | Codex headers→`http_headers`；Gemini http→`httpUrl`；OpenCode `stdio→local` 且 command+args 合并为数组 |
| 启用/禁用 | 多数工具禁用=删条目；OpenCode 特例写 `enabled:false` |
| 平台适配 | Windows 本机给 npx/node 包 `cmd /c`；入库时 `unwrap_cmd_c` 归一化剥掉（DB 存可移植形态，写出时按目标平台决定是否包）|

### 3.3 同步与导入

- **单向推送**：工具文件从不被反向解析为真相。改名时旧名字条目必须先从各工具删除再重同步（否则残留旧条目继续被工具加载——AGENTS.md 记录的历史坑）
- **反向导入**：`mcp_scan_servers` 扫描所有工具配置 + Claude 插件 `.mcp.json` + CC Switch DB，按 name 去重；`mcp_import_from_tool` 落库时同名同配置 skip、同名异配置改名复制
- **版本检测**：`package_version.rs` 查 npm/PyPI registry 显示"latest 实际版本号"（前端解析命令行识别 npx/uvx 包名）

### 3.4 前端

`web/features/coding/mcp/`：搜索（name/type/config 摘要/tags，useDeferredValue 延迟）、标签筛选（AND）、平铺（拖拽排序）/分组双视图、批量操作（加/移除某工具、设置分组、删除、启停管理态）、详情抽屉（配置+同步明细）、导入 JSON（粘贴 mcpServers JSON 建库并触发全量同步）、清单导出/导入（inventory JSON）。

## 4. Skills 管理（设计最完整的模块）

### 4.1 中央仓库

唯一事实源 = `app_data_dir/skills/<skill-name>/` 目录（可迁移、可便携化存储）。每个 skill 记录：`source_type`（git/local）、`source_ref`（URL 或路径）、`source_revision`（git commit）、`central_path`（仓库内相对路径）、`content_hash`（目录级 SHA-256：相对路径+文件字节累积）。工具运行时目录（`~/.claude/skills` 等 20+ 个）永远只是分发目标。

### 4.2 分发三级降级（`skills/sync_engine.rs`）

symlink → Windows junction → copy。中央仓库改一处、所有工具立即生效（symlink 场景）；Cursor 等不支持 symlink 的工具强制 copy。安全守卫：`ensure_source_target_not_overlapping` 拒绝源目标重叠（防止删目标时误删中央源）；删除逻辑正确区分 Unix symlink / Windows junction / 目录。

### 4.3 Git 安装与自动更新

- 安装（`skills/installer.rs`）：`git clone --depth 1 --filter=blob:none` 浅克隆到内容寻址缓存（SHA-256(clone_url+branch)，TTL 复用 + 全局锁）；仓库内多个 skill 时报错码让前端弹选择器；frontmatter 只解析 name/description（自写 185 行 YAML 子集解析器，支持块标量）
- 更新：拉到 staging → hash 比对（相同则跳过文件操作只刷 DB，避免定时更新无谓 churn）→ 原子换名 + 重同步 copy 目标；更新前自动备份（每 skill 保留 5 份）
- 自动更新：60 秒 tick + cron 解析（默认每天凌晨 3 点），静默跑不发事件
- **onboarding 收编**：首次使用时扫描所有已装工具的 skills 目录 + Claude 插件 skills + 额外源，按名称分组、内容指纹标冲突，勾选后收编进中央仓库——冷启动关键 UX

### 4.4 内容哈希贯穿全链路

更新去重 / DB 一致性纠偏（用户直改中央目录后回写 hash）/ onboarding 冲突检测 / 描述缓存键。配合 git `source_revision` 构成双层版本感知。注意这是"指纹式内容寻址"（用于变更检测），不是 CAS 文件系统——存储仍按 skill 名分目录。

## 5. 插件管理（四种体系、两个决策)

1. **Claude 官方插件——完全委托 CLI**：不自建安装逻辑，包装 `claude plugin marketplace add/install/enable ...` 子命令，事后读 CLI 落盘的 `installed_plugins.json` / `known_marketplaces.json` 展示。唯一自主动作是改 `autoUpdateEnabled`（全局锁 + before/after 快照防 CLI 覆写）。**判断标准：上游有权威 CLI 时不要重做 git clone/安装逻辑。**
2. **Oh My OpenAgent / Slim——配置桥模式**：插件本身由 opencode.json 的 `plugin` 数组启用，模块管理的是插件的配置方案（多 profile + apply + `__local__` 本地文件桥接记录），完整复用供应商管理的 CRUD/apply/事件机制。
3. **opencode plugin 字段**：数组增删 + 收藏表 + 互斥插件规则 + 托盘快捷切换。

插件与 MCP/Skills 不共用中央存储，仅事件联动：插件操作后同时发 `config-changed`/`mcp-changed`/`skills-changed`（因为插件可捆绑 MCP servers/skills/agents/hooks/LSP）。

## 6. 工程实践亮点

- **模块级 AGENTS.md 文化**：每个模块目录有自述文档（职责/Source of Truth/Why/关键流程 mermaid/历史坑），坑记录极详尽（如"改名先删旧条目"、"select 与 apply 区分"、"空串占位视为未配置"）
- **原子写**：临时文件 + rename；破坏性操作前自动备份
- **保守合并铁律**：平台写用户配置文件时永远只动"自己管理的字段"，托管清单显式化（KNOWN_ENV_FIELDS / managed-config 差量）
- **超时与防阻塞**：UNC/网络路径读文件 spawn_blocking + 超时；CLI 版本探测每参数尝试有界超时
- **恢复编排**：备份恢复按固定顺序 reapply（本机配置 → Skills → MCP），恢复中不发事件避免并发同步

## 7. 与 SillyHub 现状差距对照

| 能力 | ai-toolbox | SillyHub 现状（2026-09-10 实测） | 差距 |
|---|---|---|---|
| 供应商 | 15+ 工具全覆盖，运行时文件保守写出，导入去重 | `llm_provider` 模块较完整（加密 key/set-default/**WS 热切换**，这部分反而领先）；但 daemon 只有 `ClaudeCredentialInjector`（`sillyhub-daemon/src/credential-injector.ts:217`），codex 无 injector、无 config.toml 写盘，靠 CLI `-c` 覆盖 | codex/gemini 供应商注入断层 |
| MCP | 中央库 + 17 工具格式矩阵 + http/sse + 反向导入 + 分组收藏 | settings 表两个 KV（`mcp.platform_default` + `mcp.whitelist`，`backend/app/modules/settings/router.py:160`）+ workspace `.mcp.json` + daemon spawn 注入（`sillyhub-daemon/src/mcp-config.ts`，仅 stdio，D-017 防 SSRF 设计决策） | 无独立 MCP 实体表/资产库，无导入，无同步诊断；stdio-only（安全决策非缺陷） |
| Skills | 中央仓库 + 哈希 + symlink 分发 + git 源 + 自动更新 + onboarding 收编 | sillyspec-* 文件扫描 + `CustomSkill` DB（用户隔离）→ tar.gz bundle → daemon 复制到隔离目录 `.claude/skills`（`backend/app/modules/agent/skills_bundle_service.py`） | 无 git 源、无版本更新、无 per-workspace 绑定、无收编 |
| 插件 | 四体系 | 仅 `enabledPlugins` 透传（settings.json 白名单 4 键之一，`sillyhub-daemon/src/claude-settings.ts`） | 完全空白 |

### 哲学差异（决定哪些能搬哪些不能搬）

- ai-toolbox 是**单用户本机桌面**：写宿主全局配置文件（`~/.claude/settings.json`），symlink 到宿主工具目录，靠托盘/WSL 联动
- SillyHub 是**服务端多用户平台**：会话级隔离配置目录（`$CLAUDE_CONFIG_DIR`）+ spawn 注入 + env 优先级层——这套更干净更安全，**不应照搬**"写宿主全局文件"的做法
- 但"**中央主数据 + 投影 + 单向推送 + 显式导入**"模式完全适用：投影目标从"宿主全局配置"换成"会话隔离目录 / workspace 文件"
- SillyHub 独有优势应保留：供应商热切换（WS 推送 PROVIDER_CONFIG_CHANGED）、密钥不出 backend（litellm_proxy 形态）、用户级隔离

## 8. 源码阅读路径（按性价比）

1. `tauri/src/db/`——JSONB 通用层（4 个文件，理解统一表结构）
2. `tauri/src/coding/mcp/config_sync.rs`——转换矩阵（本案最值得抄的部分）
3. `tauri/src/coding/skills/sync_engine.rs` + 模块 AGENTS.md——分发与安全守卫
4. 任一工具 `commands.rs` 的 `apply_config_to_file`——保守合并写出
5. `tauri/src/lib.rs:1141-1162`——事件集中监听
6. 各模块目录下的 AGENTS.md——坑记录（改任何相关代码前必读）
