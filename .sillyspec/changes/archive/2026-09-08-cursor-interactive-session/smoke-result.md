---
author: qinyi
created_at: 2026-09-08 16:35:00
---

# 真实 Cursor 会话全链路冒烟结果（task-10 / FR-06）

> 环境：本机 docker compose 本地栈（backend `127.0.0.1:8001`，冒烟前热补
> worktree 的 `provider_caps.py` + `schema.py` InteractiveProviderLiteral 含
> cursor；frontend 容器**未**热补白名单——UI 引擎列表项见下方处置）。daemon
> 用 worktree 构建实跑（`.sillyspec/.runtime/worktrees/2026-09-08-cursor-interactive-session/sillyhub-daemon`，
> `pnpm run build`，build-id `e982c90b-20260908162123`），`SKIP_DAEMON_SELF_UPDATE=1`。
> cursor-agent 已 login（`versions/2026.06.16-20-30-07-a07d3ac`，status Logged in）。
> 冒烟期间临时停掉连远程的正式 daemon，结束后已按原命令行恢复。
> 认证：本地用户 `admin2` + 临时 API key（冒烟后应 revoke，不入库明文）。

对照手册 §8 + task-10 acceptance（双轨 / SSE 事件轨 / usage / resume /
interrupt / caps / model_select / claude 零回归）。

## 结果总览

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | daemon 探测 cursor available | ✅ PASS | 启动日志 `agents_detected` / `runtime_lock_acquired` / `daemon_registered` 均含 `"cursor"`；API 侧可建 `provider=cursor` 会话 |
| 2 | 创建 cursor 会话 + 首 turn | ✅ PASS | session `d8671476-6341-4760-a8c9-e6a274a44d92`，run `6e814935-7aee-47f9-9251-7a7fa32b2a43`：`agent_session_id=0d615c8a-cf2f-4bae-8547-672d06f7748b`；run `completed` / exit 0；usage input=8323 output=58 |
| 3 | 双轨落库（文本前缀 + metadata.agent_event） | ✅ PASS | 同 run：`[THINKING]…`（ev=thinking）+ `[ASSISTANT] pong`（ev=text）；`GET /api/daemon/sessions/{id}/logs` 可见 channel=stdout + metadata.agent_event.type |
| 4 | SSE / 事件轨可达 | ✅ PASS（API 轨） | create 响应带 `stream_url=/api/daemon/sessions/.../stream`；事件已按 AgentEvent 落库（与 SSE 同源上报链）。**未**在浏览器做结构化渲染截图——处置：frontend docker 未热补白名单，UI 渲染归 worktree apply + 前端镜像重建后复验；agent-log normalize 单测已在 task-09 全绿 |
| 5 | usage 落库 | ✅ PASS | run 终值 input_tokens/output_tokens 非空（首轮 8323/58；resume 轮 8647/172） |
| 6 | resume 记忆连续（`--resume chatId`） | ✅ PASS | inject 追问「上一句要求回复的单词」→ run `ed9d81fc-1911-4daf-bdae-9776d83ac387` completed；`[ASSISTANT] pong`（thinking 亦提到 previous message … "pong"） |
| 7 | interrupt → interactive_interrupted | ✅ PASS | 长轮 count 1..80（run `061423dc-586e-4e30-9876-f3e7adc3b674`）running 中 POST interrupt → run 终态 `failed` / exit 1 / `error_code=interactive_interrupted`（区别 PI 报 success 偏差） |
| 8 | caps 门控（false 项默认拒绝） | ✅ PASS（数据面） | worktree `PROVIDER_CAPS.cursor`：`mcp=false, permission_dialog=false, multimodal=false, subagent=false, edit_patch=false`；`resume/thinking/model_select=true`。UI 隐藏未在本机 frontend 容器复验——处置同 #4 |
| 9 | model_select（`--model`） | ✅ PASS | create 带 `model=auto` → session `f7fed19a-…` run `0f989fad-…` completed；`[ASSISTANT] model-auto-ok` |
| 10 | claude 零回归 | ✅ PASS | session `77d72677-…` run `8d62314c-…` completed/exit 0；`[ASSISTANT] claude-regression-ok`（同 worktree daemon 栈） |

## 处置 / 发现

- **F-UI（P2，环境）**：docker frontend:3001 仍是冒烟前镜像，无 cursor 引擎白名单；本次冒烟走 API 全链路，不阻断 daemon/backend 验收。复验：`worktree apply` 后重建 frontend 镜像，门户/对话框选 Cursor + caps 隐藏项目视。
- **F-ENV（记录）**：正式 daemon 默认连远程 `crrcdt.ppdmq.top`，本地 8001 无在线 daemon 时 create 报 `NoOnlineDaemonError`；冒烟需临时切换 worktree daemon 并恢复。
- **F-ENC（记录）**：PowerShell 默认编码会把中文 prompt 打成 `????`，resume 题须 UTF-8 bytes 直发。

## 结论

核心链路（CursorDriver 每轮 respawn → normalizeCursorFrame → 双轨落库 →
usage → resume 记忆 → interrupt=`interactive_interrupted` → model=auto →
claude 零回归）在真机 cursor-agent + 热补 backend Literal 上实证。UI 白名单/
SSE 浏览器渲染留 apply 后复验，不阻塞本变更代码验收。
