---
author: flow-machine-draft
created_at: 2026-10-05T17:26:47.337Z
---
# 需求规格（Requirements）— 2026-10-06-opencode-go-direct-anthropic

## 功能需求

> FR 由你撰写：每条 = `### FR-NN: 标题` + 一句带强度词的行为规定（必须=硬性；禁止=红线；
> SHOULD=建议须注理由；可以=可选）；边界情形加场景块 `#### 场景：名` + Given/When/Then 行。
> 标题行是成功标准锚（勿改写——收口做门柱对比）；正文与场景块归你。

### FR-01: 前端 opencode_go 预设 auth_field 修正为 ANTHROPIC_API_KEY（实测 opencode /zen/go/v1/messages 仅认 x-api-key，Bearer 恒 401）

- opencode_go 预设的 auth_field 必须为 ANTHROPIC_API_KEY（Claude Code 据此发 x-api-key 头，唯一被 opencode /zen/go/v1/messages 接受的鉴权形态）；禁止回退 ANTHROPIC_AUTH_TOKEN（Bearer 恒 401 AuthError）。

#### 场景：主路径

- Given 前端预设目录含 opencode_go（anthropic 格式直连 go 端点）
- When 用户从预设新建 OpenCode Go 供应商并发起会话
- Then Claude Code 以 x-api-key 头鉴权，opencode 不返回 401 AuthError

### FR-02: 预设默认模型更新为 deepseek-v4.1-flash 且 4 角色槽全填该模型

- opencode_go 预设的 default_model 与 settings_config_partial.env 中 ANTHROPIC_MODEL 及 HAIKU/SONNET/OPUS/FABLE 四个角色槽必须全为 deepseek-v4.1-flash（go 模型目录在列；副通道请求缺省发内置档位名会被 opencode 拒）。

#### 场景：主路径

- Given opencode_go 预设被选中预填表单
- When 用户仅填 API Key 保存供应商
- Then 预填模型与四角色槽均为 deepseek-v4.1-flash，Claude Code 主/副通道请求模型名均被上游接受

### FR-03: 阿里云服务器 OpenCode Go 供应商行已切 anthropic 直连，真实 Claude Code 端到端会话验证通过（纯文本 + 工具调用）

- 服务器 47.113.145.252 llm_providers 行 OpenCode Go 必须为 anthropic 直连形态（api_format=anthropic / base_url=https://opencode.ai/zen/go / auth_field=ANTHROPIC_API_KEY / model+4 角色槽=deepseek-v4.1-flash / key 平台 cipher 加密），且真实 Claude Code 以该行派生的环境变量完成纯文本与工具调用两类往返。

#### 场景：主路径

- Given 服务器供应商行已按上述形态落库
- When 以注入器同款环境变量（ANTHROPIC_BASE_URL/AUTH_TOKEN→API_KEY/MODEL/4 槽）运行 claude -p（纯文本）与带 --allowedTools Read 的工具调用会话
- Then 两次会话均正常应答（实测 2026-10-06：纯文本「收到」、Read 工具原样返回文件内容）

### FR-04: 前端预设相关测试通过，未跑全量测试

- 本变更必须跑且仅跑前端预设相关测试（llmProviderPresets + 消费预设的 form/list 组件测试）且全绿；禁止跑全量测试（CI 留守，仓库规则 0）。

#### 场景：主路径

- Given 预设与测试断言已修改
- When 运行三个相关测试文件
- Then 20 个用例全过（预设 9 + 表单 6 + 列表 5），未触发全量

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/llm-providers/__tests__/llmProviderPresets.test.ts「opencode_go auth_field 为 ANTHROPIC_API_KEY（/v1/messages 仅认 x-api-key）」
FR-02: test/frontend/src/components/llm-providers/__tests__/llmProviderPresets.test.ts「opencode_go 4 角色槽与主模型全填 deepseek-v4.1-flash」
FR-03: 不适用：运维数据修正 + 真机端到端验证（服务器 DB 行 + claude 2.1.216 直连实测，无仓内自动化测试面；落库证据为服务器 psql 查询 + 本报告实测记录）
FR-04: test/frontend/src/components/llm-providers/__tests__/llmProviderPresets.test.ts「opencode_go 仍为 anthropic（与 opencode_zen_openai 区分）」+ form/list 组件测试 11 例（跑面见 design 文件变更清单）
