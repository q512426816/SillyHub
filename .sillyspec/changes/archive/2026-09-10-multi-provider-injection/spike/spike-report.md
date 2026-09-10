# Spike 报告：codex / pi / cursor-agent 供应商凭证注入面实测

- 日期：2026-09-10
- 机器：Windows 10 19045（Git Bash）
- 版本：codex-cli 0.147.0（`/c/nvm4w/nodejs/codex`）、pi 0.81.1（`/c/nvm4w/nodejs/pi`）、cursor-agent 2026.09.08-6caf4ff（`C:\Users\qinyi\AppData\Local\cursor-agent\cursor-agent.cmd`）
- 方法：本地 mock HTTP 端点（`mock_server.py`，127.0.0.1:18999）记录每个请求的 path / Authorization 前缀 / model 字段到 `mock-log.jsonl`，对 `/v1/chat/completions`、`/v1/models`、`/v1/responses`、`/v1/messages` 返回最小合法 JSON（含 SSE 流）。判据：**CLI 是否认某注入面 = mock 日志里有没有它的请求**。全程不消耗真实 key（一次意外除外，见 A1 备注）。
- 证据文件：同目录 `a1-*` 至 `c1-*`（stdout/stderr/写入的配置副本）、`cursor-agent-help.txt`、`mock-log.jsonl`（24 条）。

## 结论矩阵

| CLI | 注入路径 | 结论 | mock 命中证据 |
|---|---|---|---|
| codex | A1 env：`OPENAI_API_KEY` + `OPENAI_BASE_URL`，空 CODEX_HOME | **不生效（端点不可重定向）** | 0 次命中；连默认 openai 端点重连 5 次超时。二进制无 `OPENAI_BASE_URL` 字符串 |
| codex | A1 附：env 变量全集 | 事实 | 二进制 grep：仅 `OPENAI_API_KEY`、`CODEX_API_KEY`、`CODEX_ACCESS_TOKEN`、`CODEX_REFRESH_TOKEN_URL_OVERRIDE`、`CODEX_HOME` |
| codex | A2 CODEX_HOME 写盘：auth.json `{"OPENAI_API_KEY":"..."}` + config.toml `[model_providers.X]` base_url + `wire_api="responses"` | **生效（完整闭环）** | `POST /v1/responses`，`Bearer sk-mock-123`，model=mock-model，stdout 输出 mock 回复，exit=0 |
| codex | A2 附：`wire_api = "chat"` | **明确拒绝** | `Error loading config.toml: wire_api = "chat" is no longer supported. How to fix: set wire_api = "responses"`（0.147.0 已移除 chat） |
| codex | A3a `-c` 只给 provider 表（base_url/wire_api），无任何 key | **生效（请求发出但无鉴权头）** | `POST /v1/responses`，auth 空（auth_len=0）。自定义 provider 不强制要求 key |
| codex | A3b `-c` + env `OPENAI_API_KEY` | key 不贴 | auth_len=0。OPENAI_API_KEY 不作用于自定义 provider |
| codex | A3c `-c 'model_providers.X.experimental_bearer_token="..."'` | **生效（纯命令行完整链路）** | `Bearer sk-mock-bearer-789`（auth_prefix `Bearer sk-mock-beare`） |
| codex | A3d env `CODEX_API_KEY` + `-c` provider 表 | **生效（key 可经 env）** | `Bearer sk-mock-codexkey-000` |
| pi | B1 auth.json `{"mockprov":{"type":"api_key","key":"..."}}` + models.json providers + settings.json | **生效（完整闭环）** | `POST /v1/chat/completions`，`Bearer sk-mock-123`，model=mock-model，stdout "mock says hi"，exit=0 |
| pi | B1 附：auth.json 用 `{"apiKey":"..."}` 形状 | 不生效 | `No API key found for the selected model.`（pi 官方形状是 `{"type":"api_key","key":"..."}`，与 ai-toolbox UI 投影不同） |
| pi | B2 models.json 内联 `apiKey`（单文件注入，无 auth.json） | **生效** | `Bearer sk-mock-inline-222` |
| pi | B3 CLI `--api-key`（需同时 `--provider`+`--model`） | **生效** | `Bearer sk-mock-flag-333`；不带 model 时报 `--api-key requires a model to be specified` |
| pi | B4 覆盖内置 `openai` provider baseUrl + env `OPENAI_API_KEY` | **生效（key 留 env、不落盘）** | `Bearer sk-mock-env-openai` |
| pi | root 重定向 | 生效 | `PI_CODING_AGENT_DIR=$TMP` 全程生效（模型解析、auth、settings 都从临时目录读） |
| cursor | C1 `--api-key sk-mock-123 --endpoint http://127.0.0.1:18999 -p` | **传输层生效 / 供应商层不可用** | 2 次命中：`POST /aiserver.v1.DashboardService/GetMe`（Bearer JWT，本地已存 Cursor 登录态）+ `POST /auth/exchange_user_api_key`（Bearer sk-mock-123）。CLI 报 `The provided API key is invalid.` 后退出 |
| cursor | 自定义 OpenAI 兼容 provider | **不存在该面** | bundle（2026.09.08-6caf4ff）grep 无 `OPENAI_API_KEY`/BYO provider；协议为 Cursor 私有 ConnectRPC（`/aiserver.v1.*`），key 需向 Cursor 云换取 session token |

## 关键事实与设计含义

### Codex（0.147.0）
1. **`wire_api = "chat"` 已被移除**，自定义 provider 只能 `wire_api = "responses"`。目标端点必须实现 OpenAI Responses API（POST {base_url}/responses，SSE 流）。这与 ai-toolbox 旧代码里 chat/responses 两可的假设冲突。
2. 端点重定向**只能**走 `config.toml`（`[model_providers.<id>].base_url`），env 无 base_url 入口；env 有 key 入口但分两种：`OPENAI_API_KEY`（仅内置 openai provider）、`CODEX_API_KEY`（自定义 provider 也贴，实测 Bearer 生效）。
3. 自定义 provider **不强制 key**（无 key 也发请求，Authorization 为空）。
4. 最省事的全链路注入：**纯命令行** `-c model_provider=X -c model_providers.X.base_url=... -c model_providers.X.wire_api="responses" -c model_providers.X.experimental_bearer_token=<key> -m <model>`，零文件、零污染。
5. `CODEX_HOME` 指向临时目录会告警（`Refusing to create helper binaries under temporary dir`）但继续运行；生产注入应放稳定目录（ai-toolbox 的 custom root 模式）。
6. 对未知模型名告警 `Model metadata for 'mock-model' not found. Defaulting to fallback metadata`——不阻断，但生产建议配 model catalog（ai-toolbox 的 `ai-toolbox-codex-model-catalog.json` 机制）。

### Pi（0.81.1）
1. **`PI_CODING_AGENT_DIR` 可整体重定向 root**（本 spike 全程用它隔离 `~/.pi/agent`），settings.json/auth.json/models.json 都从该目录读。
2. auth.json 官方形状：`{"<providerKey>": {"type": "api_key", "key": "<value>"}}`；`key` 支持 `$ENV` 插值、`!command` 命令执行、字面量。**注意与 ai-toolbox pi/AGENTS.md 描述的 credential 形状不同——ai-toolbox 前端存的 `apiKey` 字段形状 pi 0.81.1 不认**（需在主仓库设计时核对 ai-toolbox 实际写出的 JSON；本 spike 实测 `{"apiKey":...}` 被拒）。
3. key 解析优先级（官方文档）：CLI `--api-key` > auth.json > env > models.json 内联 `apiKey`。
4. **models.json 单文件即可完成注入**（providers.<key> = {api, baseUrl, apiKey, models[]}），`api: "openai-completions"` 打 `/chat/completions`（pi 用 OpenAI/JS 6.26.0 SDK，SSE 流）。
5. key 可与文件分离：B4 证明覆盖内置 `openai` provider 的 baseUrl + env `OPENAI_API_KEY` 有效（key 不落盘方案）。
6. `--api-key` 必须伴随 `--model`/`--provider --model`，否则直接报错。

### Cursor Agent（2026.09.08）
1. `--api-key`/`-e --endpoint`（及 env `CURSOR_API_KEY`/`CURSOR_API_ENDPOINT`）在传输层被尊重——endpoint 是全局唯一出口，所有请求（含 GetMe）都打到它。
2. 但协议是 **Cursor 私有 ConnectRPC**：先 `POST /auth/exchange_user_api_key` 把用户 API key 换成 session token，再走 `/aiserver.v1.*`。第三方 OpenAI 兼容端点无法承接 → **不可作为多供应商注入目标**。
3. 本地已有 Cursor 登录态（JWT）会被优先用于部分调用；`--api-key` 与之并存。
4. 无任何自定义 provider 配置文件面（bundle 无 OPENAI/ANTHROPIC key 字符串；`.cursor/*.json` 全是 Cursor 自有配置）。
5. 帮助全文见 `cursor-agent-help.txt`（含 `-H/--header`、`--model`、bedrock 子命令等）。

## 推荐注入路径（按 CLI）

- **codex**：首选「`CODEX_HOME` 指向平台管理的稳定目录 + 写 config.toml provider 表（wire_api 固定 responses）+ auth.json OPENAI_API_KEY」；若要进程级隔离/零写盘，用 `-c model_providers.X.experimental_bearer_token=<key>` 纯命令行注入（或 env `CODEX_API_KEY`）。注意目标端必须支持 Responses API。
- **pi**：首选「`PI_CODING_AGENT_DIR` 指向平台管理目录 + models.json providers 段（api/baseUrl/models）+ auth.json `{"type":"api_key","key":...}`」；key 想避开落盘可用 env（内置 provider key 名）或 `--api-key` flag（须带 --model）。
- **cursor-agent**：**无可行注入面**。要么走 Cursor 云账号（login），要么放弃纳入多供应商体系；`--endpoint` 仅适合自建 Cursor 协议代理，不能当 OpenAI 兼容网关用。

## 附注

- A1 首跑曾误用 `env -u CODEX_HOME`（未赋值），codex 读到真实 `~/.codex`（provider: custom / glm-5.3）并正常出话——那次消耗了用户真实网关一次请求，mock 无命中。修正后所有测试均隔离在临时 CODEX_HOME。
- 临时目录均为 `mktemp -d`（C:\Users\qinyi\AppData\Local\Temp 下），测试后未清理系统配置；`~/.codex`、`~/.pi` 全程未被修改。
- mock 日志：`mock-log.jsonl` 24 条，时间戳 22:13–22:21，可按 ts 与各 *-info.txt 中记录的临时目录对照。
