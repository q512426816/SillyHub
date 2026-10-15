---
author: qinyi
created_at: 2026-10-15 12:08:02
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 在单聊创建表单选择 dsh 引擎、配置 LlmProvider、与会话交互、审批权限请求 |
| daemon | 探测 dsh 二进制、spawn ACP 子进程、事件归一化落库、权限代答桥 |
| backend | provider 枚举校验、lease/claim 管线、群附件门控、caps 镜像 |
| dsh 子进程 | ACP v1 服务端（initialize/session 方法面/通知/权限请求） |

## 功能需求

### FR-01: dsh 引擎注册与探测
Given daemon 所在机器安装了 dsh（版本 ≥0.2.1）
When daemon 启动执行 agent 探测
Then agent-detector 第 13 项命中（SILLYHUB_DSH_PATH env 覆盖 → PATH which），`--version` 解析入 MIN_VERSIONS 校验（低于 0.2.1 输出与四引擎同格式警告，不硬拒），路径经 _agentPaths 可被 dsh 驱动取用（D-001/D-002）

### FR-02: dsh 单聊会话全链路
Given 探测到 dsh 且用户在单聊创建表单选择 dsh 引擎
When 提交创建（provider='dsh' 经 backend InteractiveProviderLiteral 校验通过）
Then daemon spawn `dsh --profile acp`（Windows .cmd shim 解析），initialize 握手 + session/new（cwd），每轮 session/prompt 的 session/update 通知归一化为 AgentEvent 落 AgentRunLog（assistant 消息/thought/tool_call/tool_result），前端按现有会话流渲染（提交粒度，无打字机）；握手/协议失败 → 结构化 error + 会话 failed（D-003）

### FR-03: 打断
Given dsh 会话有 in-flight prompt
When 用户打断
Then 驱动发 session/cancel，turn 终止落库，子进程保持可续用

### FR-04: 权限代答
Given dsh 会话 manual_approval=true 且收到 session/request_permission
When 服务端请求到达
Then 桥接现有 sessionPermission/PERMISSION_REQUEST 管线：allow → 回 ACP allow 选项；deny/无注入/超时 → fail-closed reject；manual_approval=false 或 ask_user_only=true 时自动放行（对齐 codex _handleApproval 语义）

### FR-05: 模型路由（平台接管）
Given 会话绑定了 LlmProvider（base_url/api_key/model）
When daemon 创建 dsh 会话
Then per-session DSH_HOME 写 profiles/acp/cordis.patch.yml（llm-pi-ai 自定义路由：api 按 base_url 形态判 anthropic-messages/openai-completions，apiKeyEnv 指向注入变量），env 注入密钥，session/set_config_option 设初始 model；热切换（provider_config_changed）重写 patch + 重设 model。未绑定时不写 patch/不注 env，dsh 用本机默认模型

### FR-06: caps 如实申报与三端镜像
Given dsh 引擎注册
Then PROVIDER_CAPS dsh 条目 16 键如实（Grill 修正后口径：compact=false/steering=false/dialog='native'/permission_dialog=true/multimodal=false/sessionFork='none'/subagent=false/edit_patch=false，其余 true 详见 design 接口定义），gen-provider-caps.mjs 刷新 backend/frontend 镜像；compact/steering 等走 caps 现有自动拒绝路径

### FR-07: 群附件门控口径统一
Given 群消息带附件且目标成员引擎为 X
When 触发成员
Then 发送侧（messages.py:791-797）与触发侧（shadow.py:266-273）门控均按 get_provider_caps(X)["attachments"] 判定（与单聊 attachments.py:59 对齐，两处同口径）：claude/pi/cursor/dsh 放行，codex/未知引擎拒绝（现行"仅 claude"硬编码删除；pi/cursor 群附件从拒变放为有意行为变化，R-03）

### FR-08: 前端单聊引擎选项
Given dsh 在该 runtime 探测可用
When 用户打开单聊创建入口
Then SESSION_ENGINE_OPTIONS 含 dsh（图标/标签）；群聊 ENGINE_OPTIONS 不变

## 非功能需求
- 兼容性：未装 dsh 的机器引擎不可见/禁用，现有三引擎零回归；无表结构变更；provider 枚举扩展经 gen:types 双义务同步（frontend + sillyhub-daemon api-types，CLAUDE.md 规则 21）
- 生命周期：dsh 子进程随会话 driver close 三重自灭（stdin EOF 优雅退出 / 清理阶梯 / daemon 崩溃后管道断裂 EOF）；per-session DSH_HOME 随现有清理管线
- 平台：Windows/Linux/macOS 三平台兼容（.cmd shim、路径分隔符）

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | agent-detector 第 13 项探测（env 覆盖 → PATH → 不可用），用户自装 |
| D-002@v1 | FR-01, FR-02 | MIN_VERSIONS dsh (0,2,1) 警告不硬拒；握手失败结构化错误兜底 |
| D-003@v1 | FR-02, FR-03, FR-04 | 自研 ACP 驱动（json-rpc 基建复用 + 方法面映射 + 代答桥） |
| D-004@v1 | （rejected 登记） | 官方 ACP SDK 客户端落选——不引入依赖，无 FR 覆盖需求 |
| D-005@v1 | （rejected 登记） | headless 批处理落选——批处理层不在范围，无 FR 覆盖需求 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-06: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-07: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-08: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
