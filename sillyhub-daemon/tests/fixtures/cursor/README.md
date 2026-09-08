# cursor-agent stream-json 真实帧样本（task-01 Wave 0 前置实测）

## 样本来源

- 采集时间：2026-09-08
- 采集环境：Windows 10（Git Bash），cursor-agent 版本 `2026.06.16-20-30-07-a07d3ac`
  - 入口：`%LOCALAPPDATA%\cursor-agent\versions\2026.06.16-20-30-07-a07d3ac\node.exe` + 同目录 `index.js`
  - （官方 `cursor-agent.cmd/ps1` shim 损坏，见 ql-20260620-002-f8c1，故直跑版本目录入口）
- 账号：Free 计划，`apiKeySource: "login"`（浏览器登录态）
- 运行 cwd：`C:\Users\qinyi\AppData\Local\Temp\cursor-task01`（系统 TEMP 探针目录，空目录、非 git 仓库）
- `--model auto` 为必带项（不带会报 Named models unavailable）

## 采集命令

统一前缀（Git Bash 形式）：

```bash
V="$LOCALAPPDATA/cursor-agent/versions/2026.06.16-20-30-07-a07d3ac"
"$V/node.exe" "$V/index.js" -p --output-format stream-json --force --trust --model auto [附加参数] "<prompt>" > <输出>.ndjson
```

| 文件 | 附加参数 | prompt | 帧数 | 用途 |
| --- | --- | --- | --- | --- |
| `turn1-fresh.ndjson` | （无） | `My secret code is Zebra-42. Remember it for later. Just reply: OK.` | 8 | 验证 A：全新会话帧形状（system/init 携带 session_id） |
| `turn2-resume.ndjson` | `--resume c482aaa1-d2c7-4ec8-816b-6157ef58800f`（turn1 的 session_id） | `What is my secret code? Answer with the code only.` | 6 | 验证 B：resume 记忆连续性（回答 Zebra-42，通过） |
| `create-chat-probe.ndjson` | `--resume 4567240b-5393-4637-a5ee-f2f1a6f4ee69`（`create-chat` 子命令返回的 ID） | `Reply with exactly: pong` | 12 | 验证 C：create-chat ID 可作 --resume 兜底（通过） |
| `tool-use-probe.ndjson` | （无） | `Use the shell tool to run: echo toolprobe. Then report the output.` | 16 | 补充样本：tool_call 帧形状 + connection/retry 传输帧（任务卡 3 文件之外的补充，供 task-03 归一化器 golden 测试覆盖工具帧） |

`create-chat` 采集方式（stdout 直接输出裸 UUID，无 JSON 包装）：

```bash
"$V/node.exe" "$V/index.js" create-chat
# → 4567240b-5393-4637-a5ee-f2f1a6f4ee69
```

## 帧型清单（实测观测）

| type/subtype | 出现文件 | 说明 |
| --- | --- | --- |
| `system`/`init` | 全部 | 字段：`apiKeySource` `cwd` `session_id` `model` `permissionMode`（无 mcp_servers/tools 等 Claude 同位帧字段） |
| `user` | 全部 | 回显本轮用户 prompt（Claude Code 仅在 tool_result 时发 user 帧；cursor 每轮回显） |
| `assistant` | 全部 | `message.content` 为块数组，实测仅 `{"type":"text","text"}` 块；**无 tool_use 块**（工具调用走独立 tool_call 帧） |
| `thinking`/`delta`、`thinking`/`completed` | 全部 | 顶层独立帧（非 assistant message 内块）；delta 为增量文本，completed 无 text |
| `tool_call`/`started`、`tool_call`/`completed` | tool-use-probe | 顶层独立帧：`call_id` `tool_call`（判别联合，如 `shellToolCall`，completed 带 `result.success.{exitCode,stdout,stderr}`）`model_call_id` |
| `connection`/`reconnecting`、`connection`/`reconnected` | tool-use-probe | 传输层帧：`attempt` `endpoint_url` |
| `retry`/`starting` | tool-use-probe | 传输层帧：`attempt` `is_resume` |
| `result`/`success` | 全部 | 收尾帧：`duration_ms` `duration_api_ms` `is_error` `result` `session_id` `request_id` `usage`；usage 字段为 camelCase：`inputTokens` `outputTokens` `cacheReadTokens` `cacheWriteTokens`（与 Claude Code 的 snake_case 命名不同） |

## 脱敏说明

- 已全量扫描 token/api key/bearer/authorization/secret/password/sk-/cookie 关键词：无凭证类残留（`apiKeySource: "login"` 仅为来源标签，非凭证值；`*Tokens` 字段为 token 计数）。
- `cwd` 字段保留本机用户名路径（`C:\Users\qinyi\...`），按任务约定路径可保留。
- `endpoint_url` 为 cursor 公网 API 域名（`https://agentn.global.api5.cursor.sh`），非机密，保留。
- `call_id` 字段值内含字面 `\n`（原始样本如此，JSON 字符串内的合法转义），未做改写；帧结构与字段名均保持原样。

## 逐行 JSON 校验

```bash
node -e "const fs=require('fs');for(const f of ['turn1-fresh','turn2-resume','create-chat-probe','tool-use-probe']){fs.readFileSync('tests/fixtures/cursor/'+f+'.ndjson','utf8').split(/\r?\n/).filter(Boolean).forEach(l=>JSON.parse(l))};console.log('fixtures ok')"
```

（在 `sillyhub-daemon/` 目录下执行；三个任务卡文件 + 补充 tool-use 样本共 42 行全部通过。）

---

# task-02 补充：非 force 权限行为探针样本（D-003@v2 证据）

## 采集命令（两档各一次，2026-09-08）

同上文环境（版本目录入口直跑、Free 计划、`--model auto` 必带），运行 cwd 为
`C:\Users\qinyi\AppData\Local\Temp\cursor-task02\trust-only` 与 `...\no-flags`（各自独立空目录，非 git 仓库），
均带 GNU `timeout --kill-after=10 120` 超时保护（两次均未触发，进程自然退出）：

| 文件 | 附加参数 | prompt | 帧数 | exit | 用途 |
| --- | --- | --- | --- | --- | --- |
| `probe-trust-only.ndjson` | `--trust`（**无 --force**） | `Create a file named probe-a.txt containing the word apple, then tell me done` | 14 | 0 | 探针一：仅 --trust 时工具是否放行 |
| `probe-no-flags.ndjson` | （**--trust / --force 均不带**） | 同上 | 0（stdout 全空） | 1 | 探针二：无任何信任旗标时的行为 |

```bash
V="$LOCALAPPDATA/cursor-agent/versions/2026.06.16-20-30-07-a07d3ac"
# 探针一
timeout --kill-after=10 120 "$V/node.exe" "$V/index.js" -p --output-format stream-json --trust --model auto "<prompt>" > stdout.ndjson 2> stderr.txt
# 探针二（去掉 --trust）
timeout --kill-after=10 120 "$V/node.exe" "$V/index.js" -p --output-format stream-json --model auto "<prompt>" > stdout.ndjson 2> stderr.txt
```

## 探针一结果（--trust 无 --force）：工具照常执行，无审批帧

- 帧流（14 帧）：system/init（`permissionMode:"default"`，与带 --force 的 task-01 样本同值）→ user 回显 → thinking
  → assistant（"正在创建 probe-a.txt"）→ **`tool_call/started`（editToolCall）→ `tool_call/completed`（result.success：
  path/linesAdded=1/diffString/afterFullFileContent）** → thinking → assistant（"done"）→ result/success（is_error=false）。
- 文件真实落盘：`trust-only\probe-a.txt` 内容 `apple\r\n`（7 字节，od 验证）。
- 无 permission/approval 类帧、无挂死、无降级（未跳过工具改纯文本）。工具直接执行，与基线
  `--force --trust`（task-01 tool-use-probe 的 shellToolCall 直接执行）行为一致——headless `-p` 模式下未观测到任何审批拦截。

## 探针二结果（--trust 也不带）：进程硬拒绝，零帧退出

- exit=1，**stdout 0 字节（连 system/init 都没有）**，文件未创建，非挂死（快速失败）。
- stderr 全文（实测原样）：

  ```
  ⚠ Workspace Trust Required

    Cursor Agent can execute code and access files in this directory.
    Do you trust the contents of this directory?

      C:\Users\qinyi\AppData\Local\Temp\cursor-task02\no-flags

    To proceed, you can either:
      • Run 'agent' interactively to decide
      • Pass --trust, --yolo, or -f if you trust this directory
  ```

- 形态：会话创建前的**工作区信任硬门禁**（进程报错退出），不是帧流内的拒绝/审批帧；
  CLI 自身给出的出路只有 `--trust` / `--yolo` / `-f`（= --force），**不存在 headless 审批通道**。
- ⚠ `probe-no-flags.ndjson` 内容说明：真实 stdout 为空，为保留证据并通过逐行 JSON 校验，文件仅含
  **一行 `type:"probe_capture"` 记录**（内联 stderr 原文与 exit_code）——它**不是 cursor-agent 的流帧**，
  下游归一化器/黄金测试请按 type 过滤忽略。

## 两档差异小结

- `--trust` 是 headless 启动的**硬前提**：无它进程直接 exit=1 零帧；有它（无论是否 --force）工具直接执行。
- 未观测到 `--force` 在本场景（文件写工具）带来的行为差异；但 stderr 提示 `-f`/`--yolo` 与 `--trust` 同列，
  均为"信任该目录"级别的放行旗标。

## 脱敏说明（task-02 样本）

- 关键词全量扫描（token/apikey/bearer/authorization/secret/password/sk-/cookie/credential）：仅命中
  usage 计数字段（`inputTokens` 等）与 `apiKeySource:"login"` 来源标签，同 task-01 口径，无凭证残留。
- `cwd` / `path` / `diffString` 中的本机用户路径按约定保留；`stderr` 内路径同理保留。

## task-02 样本逐行 JSON 校验

```bash
node -e "const fs=require('fs');for(const f of ['probe-trust-only','probe-no-flags']){fs.readFileSync('tests/fixtures/cursor/'+f+'.ndjson','utf8').trim().split(/\r?\n/).forEach(l=>JSON.parse(l))};console.log('task02 fixtures ok')"
```

（15 行全部通过；task-01 四份样本未改动，六份合计校验通过。探针后确认无残留 cursor-agent node 进程。）
