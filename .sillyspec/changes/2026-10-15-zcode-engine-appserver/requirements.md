---
author: qinyi
created_at: 2026-10-15 13:25:24
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 在单聊创建表单选择 zcode 引擎、配置 LlmProvider、与会话交互、审批权限请求 |
| daemon | 三段式探测 ZCode 引擎、spawn app-server 子进程、事件归一化落库、权限代答桥、per-session 配置面写入 |
| backend | provider 枚举校验、lease/claim 管线、caps 镜像 |
| zcode 子进程 | ZCode 私有协议服务端（信封/session 方法面/通知/服务端主动请求） |

## 功能需求

### FR-01: zcode 引擎注册与探测
Given daemon 所在机器安装了 ZCode Desktop（内嵌引擎版本 ≥0.16.9）
When daemon 启动执行 agent 探测
Then 探测项命中（SILLYHUB_ZCODE_PATH env 覆盖 → PATH which zcode → Desktop 固定安装路径回退 fallbackPaths，含平台变量展开；.cjs 目标经 process.execPath 执行版本探测），`--version` 解析入 MIN_VERSIONS 校验（低于 0.16.9 输出与四引擎同格式警告，不硬拒），路径经 _agentPaths 可被驱动取用（D-001/D-004）

### FR-02: zcode 单聊会话全链路
Given 探测到 zcode 且用户在单聊创建表单选择 zcode 引擎
When 提交创建（provider='zcode' 经 backend InteractiveProviderLiteral 校验通过）
Then daemon spawn `node <zcode.cjs> app-server --cwd <dir>`（env ZCODE_DATA_BASE_DIR 指向 per-session 配置面），等 startup/storageState phase=ready 后 session/create（期间自动应答 session/requestRuntimePreferences 与 interaction/requestOfficialMcpAuthHeaders），每轮 session/send 的通知流归一化为 AgentEvent 落 AgentRunLog（stream.chunk channel=text → 文本 token 级增量 / channel=thought → 思考流 / tool_call+tool.lifecycle → 工具生命周期 / usage.delta → ctx_tokens / turn.terminal → 轮终止），前端按现有会话流渲染（token 级打字机）；握手/协议失败 → 结构化 error + 会话 failed（D-005）

### FR-03: 打断
Given zcode 会话有 in-flight 轮
When 用户打断
Then 驱动发 session/stop，turn 终止落库，子进程保持可续用

### FR-04: 权限代答与服务端请求分发
Given zcode 会话收到服务端主动请求
When 请求到达
Then 分发器按方法处理：session/requestRuntimePreferences（create/send 各一道）回默认偏好（15s 超时窗口内）；interaction/requestOfficialMcpAuthHeaders 回空；interaction/requestPermission 在 manual_approval=true 时桥接现有 sessionPermission/PERMISSION_REQUEST 管线（allow → 回 allow 选项；deny/无注入/超时 → fail-closed reject），manual_approval=false 时自动放行（对齐 codex _handleApproval 语义）；interaction/requestUserInput 回 cancelled（阶段 1）

### FR-05: 模型路由（平台接管）
Given 会话绑定了 LlmProvider（base_url/api_key/model）
When daemon 创建 zcode 会话
Then per-session 配置面（ZCODE_DATA_BASE_DIR 重定向的 v2 目录）写 provider_config.json（api.type 按 base_url 形态判 anthropic-messages / openai-chat-completions、baseUrl、access.apiKey 明文、personalModelIds/modelOrder 含所选 model），session/setModel 设初始模型；热切换（provider_config_changed）重写配置 + 重设模型。未绑定时不写 provider_config.json（不覆盖机器默认），zcode 用本机默认已登录 Provider（D-003）

### FR-06: caps 如实申报与三端镜像
Given zcode 引擎注册
Then PROVIDER_CAPS zcode 条目 16 键如实（mcp=false/multimodal=false/attachments=false/subagent=false/dialog='none'/edit_patch=false/steering=false/sessionFork='none'，其余 true——取值依据为协议实测，详见 design 接口定义），gen-provider-caps.mjs 刷新 backend/frontend 镜像；compact/thinking_level/ctx_usage 走 caps 现有通道

### FR-07: 前端单聊引擎选项
Given zcode 在该 runtime 探测可用
When 用户打开单聊创建入口
Then SESSION_ENGINE_OPTIONS 含 zcode（图标/标签）；群聊 ENGINE_OPTIONS 不变

### FR-08: compact 与思考档位通道（可选实现）
Given zcode 会话开启
When 用户触发上下文压缩或切换思考档位
Then 驱动经 session/compact / session/setThoughtLevel 执行（caps.compact=true / thinking_level=true 有协议方法面支撑）

## 非功能需求
- 兼容性：未装 ZCode Desktop 的机器引擎不可见/禁用，现有引擎零回归；无表结构变更；provider 枚举扩展经 gen:types 双义务同步（frontend + sillyhub-daemon api-types，CLAUDE.md 规则 21）
- 生命周期：zcode 子进程随会话 driver close 三重自灭（stdin EOF 优雅退出——R-05 verify 实测记录 / 清理阶梯 / daemon 崩溃后管道断裂 EOF）；per-session 配置面目录随现有清理管线销毁；zcode 会话库机器共享不随平台清理（D-002）
- 平台：Windows/Linux/macOS 三平台兼容（路径分隔符、fallbackPaths 平台变量展开）
- 与 dsh 变更代码不重叠：不碰 messages.py，共同修改文件为增量条目先后适配

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 三段式探测（env → PATH → Desktop 固定路径），用户自装 |
| D-002@v1 | FR-05, 非功能生命周期 | 配置面 per-session 隔离，会话库接受机器共享 |
| D-003@v1 | FR-05 | LlmProvider 接管：per-session provider_config.json 注入 |
| D-004@v1 | FR-01, FR-02 | MIN_VERSIONS zcode (0,16,9) 警告不硬拒；协议失败结构化错误 |
| D-005@v1 | FR-02, FR-03, FR-04 | 自研私有协议驱动（信封层 + 方法面 + 服务端请求分发器） |
| D-006@v1 | （rejected 登记） | 等待官方 ACP/SDK 落选——无 FR 覆盖需求 |
| D-007@v1 | FR-02 | 独立驱动 + 独立信封层 + 每会话一进程（方案 A，用户确认） |
