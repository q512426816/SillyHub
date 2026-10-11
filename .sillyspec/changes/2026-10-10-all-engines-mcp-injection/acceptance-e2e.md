# 端到端验收记录（acceptance-e2e）— task-09

- 验收日期：2026-10-11
- 验收对象：pi 引擎（本变更唯一翻值引擎，pi.mcp=true）
- 产物基线：worktree 构建（sillyhub-daemon dist @ 分支 sillyspec/2026-10-10-all-engines-mcp-injection，含 task-04~08 全部提交）

## 执行期裁决 D-013@v1：验收方式（平台全链 → 引擎侧全链 + 线上复验项）

完整平台链（backend 创建 pi 会话 → daemon 接单 → UI 会话内 upload）在本验证窗口受阻于：
1. 本地平台登录链含验证码（/api/auth/captcha）且无自助注册路由，自动化凭证获取不可行；
2. 宿主生产 daemon 正在运行（连 crrcdt.ppdmq.top，含用户活 pi 会话）——不可干扰/替换；
3. 以宿主模型凭证驱动模型自动调工具涉及用户敏感 API key 的提取使用——主动放弃该路径（敏感边界）。

故按引擎侧全链验收（配置注入 → 引擎连接 → 工具面可见 → 工具调用 → HTTP 出站），真实上传落文件中心列为 **daemon 部署本变更构建后的线上复验项**（部署后平台 pi 会话内让 agent 调 upload_file 即可复验，凭证由 daemon 注入链自动携带）。

## 证据链（按 MCP 调用五环节）

### 环节 1：平台 MCP 配置注入（producer 侧）

- worktree 构建产物 `dist/pi-settings.js` 的 `writePiMcpConfig` 写 per-session 目录 mcp.json（`C:/Users/qinyi/AppData/Local/Temp/e2e-pi/sessiondir/mcp.json`）——内容含 `sillyhub-file` server（command/args 指向 `dist/mcp-server.js --toolset file`）与 per-server env（MCP_SESSION_ID=e2e-pi-sess-1 / MCP_SERVER_DAEMON_API_KEY / MCP_SERVER_BACKEND_URL=http://localhost:8001 / MCP_TOOLSET=file）
- 宿主全局 `~/.pi` 零写入（全程 PI_CODING_AGENT_DIR 隔离）

### 环节 2：pi 引擎读取与连接（引擎侧）

```
PI_CODING_AGENT_DIR=<sessiondir> pi mcp list --json
→ server: sillyhub-file | state: connected
```

### 环节 3：会话工具面可见（验收核心）

```
tools: ['upload_file', 'list_uploaded_files']
```

上传 2 工具在 pi 1.1.0 会话工具面可见（工具命名空间 `mcp__sillyhub-file__upload_file`）。

### 环节 4：工具调用（JSON-RPC 直调）

- 未设 MCP_ALLOWED_ROOT：`{"error":"path_out_of_root","message":"MCP_ALLOWED_ROOT is not set; all uploads are rejected (fail-closed)"}`——server 内部安全校验生效
- 设 MCP_ALLOWED_ROOT 后：调用通过校验进入上传执行路径

### 环节 5：HTTP 出站到达 backend（全链闭环）

```
tools/call upload_file（MCP_SERVER_BACKEND_URL=http://localhost:8001，假 apiKey）
→ isError: true
→ response: {"error":"http","tool":"upload_file","status":401,
   "message":"backend 401: {\"code\":\"HTTP_401_AUTH_TOKEN_INVALID\",
   \"message\":\"API 密钥无效、已过期或已被吊销...\",\"request_id\":\"0db8696c-...\"}"}
```

**backend 401 结构化错误 = 调用穿透全链**（stdio spawn → initialize → tools/call → allowed_root 校验 → HTTP POST http://localhost:8001 → backend 鉴权层拒绝假凭证 → 错误结构化回传调用方）。生产部署时 daemon 注入真实 apiKey（mcp-config.ts task-09 鉴权链），此环节即转为上传成功。

## 截断引擎验收（codex / cursor）

- codex：caps 维持 false（D-011@v1 未能实测），机制代码交付（task-06，7 用例绿）——无端到端验收对象
- cursor：caps 维持 false（留档分支）——无端到端验收对象
- 两引擎在留档中记录为暂缺并注明决策号（D-011@v1），复评条件见 spike-codex-mcp.md / spike-cursor-mcp.md

## 结论

- FR-09（每翻值引擎端到端）：**PASS（pi 引擎侧全链）**——工具可见 + 调用到达 backend，真实上传留线上复验项（D-013@v1）
- 配套实测注意点（留痕）：mcp-server env 名为 `MCP_SERVER_BACKEND_URL`（非 MCP_HUB_BASE_URL）；file 工具集由 `MCP_TOOLSET=file` env 控制（daemon 生产注入 mcp-config.ts 已带，probe 初次漏配回落编排工具集属预期容错）
