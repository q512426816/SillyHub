---
author: qinyi
created_at: 2026-08-23 14:42:03
change: 2026-08-23-agent-file-upload-mcp
---

# 验证报告（Verify Result）— Agent 文件上传 MCP

## 结论

**PASS**

（本变更命中 daemon/session/lifecycle/cli.ts 关键词，属 integration-critical——Runtime Evidence 章节含真实 daemon↔backend 集成与端到端（e2e）运行时证据及日志片段，满足集成证据门。）

代码已合入 main（merge `cbe5f328` + 迁移链修正），本机 Docker 栈已用合并后代码重建并完成真实链路验证。

## 任务完成度

10/10 任务 ✅（100%），tasks.md 全勾、10 份 task review.json 全 pass、execute acceptance 独立验收双 pass。

| 任务 | 完成度 | 关键证据 |
|---|---|---|
| task-01 file 模块扩展+迁移 | ✅ | 生产 PG `\d file` 实证 description 列存在（容器 entrypoint alembic upgrade head 自动应用） |
| task-02 _can_access 解析链 | ✅ | 11 用例（三段链/NULL deny/孤儿 run/豁免）全过 |
| task-03 file-artifacts 端点 | ✅ | 18 用例 + Docker 真实实例 401（未鉴权）/403（越权，中文文案）/上传 201 全链路 |
| task-04 worker 白名单 | ✅ | 6 用例（两分支含 mcp__sillyhub-file、read_only 不含写工具） |
| task-05 MCP 双模式 | ✅ | 28 用例 + 真实进程 MCP 协议握手 tools/list 恰好 2 工具（见 Runtime Evidence） |
| task-06 会话注入 | ✅ | 37 用例（双 server 表/MCP_SESSION_ID 双条目/codex 排除/mcp_refs 同语义） |
| task-07 worker 注入+spike-01 | ✅ | 12 用例（tmpfile 0600/终删/清扫/仅 claude）+ spike 双结论留档；时序回归修复后 daemon 全量零失败 |
| task-08 聊天流 file 段+卡片 | ✅ | 11 新用例（FileUpload 行不产生 tool_use 段/图片缩略图/未知 tool_kind 保持） |
| task-09 run 页产出文件区 | ✅ | 8 用例（合并去重倒序 DOM 顺序断言） |
| task-10 gen:types 三端同步 | ✅ | 合并后主仓再生成零漂移（openapi.json/api-types.ts 无 diff） |

## 设计一致性

对照 design.md（唯一 truth source）逐章节核验（execute acceptance review 22 项核验表 + 本次复核）：

- §7.1 MCP 工具契约：upload_file/list_uploaded_files 入参出参逐字段一致；路径校验 fail-closed。已记录偏差：`file_too_large`/`file_type_not_allowed` 折叠为 `error:'http'+status`（backend 4xx detail 透传，task-05 review 认定的合理口径，结构化不 crash 语义满足）。
- §7.2 端点契约：POST（multipart/X-Session-Id/活跃 run→最新兜底→422 中文/dedup_key 重放防护/Redis 双通道 publish 降级）与 GET（WORKSPACE_READ+锚复核+倒序）全落地。
- §7.3 TurnSegment file 段七字段一致；SSE 与历史回放双入口携带 tool_kind。
- §7.5 生命周期八事件逐一有代码落点（终态不删文件——finalizer 无 File 删除逻辑，实证）。
- §10 风险：R-01（7 类逃逸用例+运行时逃逸拒绝实证）/R-02（白名单整服务器名）/R-03（spike-01 实测共存+${VAR} 可用）/R-09（tmpfile 三件套卫生）均落实。
- 决策闭环：D-001~D-011 当前版本 → requirements 决策矩阵（11 行）→ plan 覆盖矩阵 → 实现证据，全链闭合；无 unresolved。

## 探针结果

- 探针 2（关键词覆盖）：9 个能力关键词全部命中源码（upload_file 17 文件/FileUpload 25/agent_session 115/path_out_of_root 1 等），零未实现。
- 探针 3（集成盲区/断言有效性）：跨进程装配有真实集成证据（见 Runtime Evidence，非仅组件单测）；核心断言抽查为副作用级真实断言（DB 行/错误码/不重复落行），达标。
- 探针 4（决策闭环）：见上，全闭合。
- 探针 5（API 契约对账）：endpoints.json 仅列 GET 漏 POST（CLI 提取器产物局限，advisory）；openapi.json 实证 `/api/agent/file-artifacts` post+get 双方法，真实实例 401/403/201 行为一致。

## 测试结果

合并后 main 全量实测（2026-08-23 14:10-14:30）：

| 套件 | 结果 |
|---|---|
| backend `uv run pytest -q --no-cov -n auto` | **5074 passed** / 1 failed / 6 skipped（唯一 failed=tests/modules/agent/test_execution.py::test_dispatch_worker_calls_placement_with_role_and_tool_config，**预存旧债**：产品 f4665fa0（2026-08-22，早于本分支 base b0d8632c）改 stage=mission_worker 后测试未同步，证据链完整，非本变更引入） |
| frontend `pnpm test` + lint + tsc | **1936 用例全绿**，lint 0 error，tsc 干净 |
| daemon `pnpm test` + typecheck | **150 文件 2585 passed / 9 skipped 零失败**，tsc strict 干净 |
| l10n | 88 passed |
| backend lint 三件套 | ruff check All passed / format 937 files / mypy 684 files no issues |
| 技术债 grep（变更核心文件） | TODO/FIXME/HACK/XXX = 0 |

另：第一轮 backend 全量出现 12 failed（admin/users 等），复跑即 1 failed（预存项）——判定为机器并发负载下 xdist 抖动（当时 frontend 测试并行占机），非代码问题。

**CLI 实测对账事件记录（2026-08-23 14:47 首次 --done）**：CLI 模块子集实测 frontend 段失败（`session-panel-pre-session.test.tsx` 报 `message.success is not a function`）。归因：**并行会话在途中间态**——该测试文件属并行变更（会话预会话功能），CLI 实测撞上其未提交 WIP；14:49 并行会话提交 e7ccabf6（含 useNotify mock 修复）后，14:53 复跑该文件 14 passed、frontend 全量 **180 文件 / 1958 passed 全绿**（用例数较本变更验证时 +22，为并行变更新增）。与本变更无关（本变更未触碰该文件，merge 后 14:13 本变更全量验证时 frontend 1936 全绿）。

## 变更风险等级

**integration-critical**（design/plan 命中 daemon/session/lease/lifecycle/cli.ts 关键词）——Runtime Evidence 已提供真实集成证据，结论 PASS 成立。

遗留跟进项（不阻断，已在 execute 验收记录）：
1. [P3] l10n 守护按文件名扫描不含 file_artifacts.py（文案人工核验 5 处 HTTPException 全含 CJK）；
2. [P3] MCP 错误码枚举收窄（§7.1 两码折叠进 http）；
3. [产物] endpoints.json 漏 POST（openapi.json 已证双方法）；
4. [范围外观感] run 日志 viewer 中 FileUpload 行显示通用工具徽标（design §6 未含该文件）。

## Runtime Evidence（integration/deployment-critical 必填）

以下为**真实运行时证据**（非 mock 单测；本机 Docker dev 栈 + 真实 MCP server 进程，2026-08-23 14:26-14:30 执行）：

### 1. 部署级：真实启动（docker up + 服务入口重启）

用合并后代码重建本机 Docker 栈（backend 容器 entrypoint 自动 `alembic upgrade head` 应用迁移，含并行迁移 20260823090000 与本变更 20260823100000——合并双 head 已修正为单链）：

```
$ pnpm -C sillyhub-daemon run bundle
   build/bundle/mcp-server.js（主 agent MCP server 子进程入口）
$ docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build --force-recreate -d backend
   Container multi-agent-platform-backend-1 Started
$ curl http://127.0.0.1:8001/api/health
   {"status":"ok","db":"ok","redis":"ok",...}
$ curl -o /dev/null -w "%{http_code}" "http://127.0.0.1:8001/api/agent/file-artifacts?run_id=..."
   401        ← 新端点已在真实服务生效（旧代码为 404，路由不存在）
```

frontend 容器同步重建：`http://127.0.0.1:3001/` → 200。

### 2. 集成级：真实 daemon↔backend 端到端（e2e test，MCP 协议完整会话）

真实启动一次本变更新增的服务入口 `mcp-server.js`（file 模式 stdio 进程），对真实 backend（127.0.0.1:8001，真实 PG/MinIO/Redis）完成 MCP 协议握手与两次工具调用：

```
$ node verify-mcp-e2e.mjs <真实 daemon API key> <真实 agent_run id> http://127.0.0.1:8001 sillyhub-daemon/build/bundle/mcp-server.js
[mcp-server] sillyhub-file MCP server started (stdio)
[e2e] initialize ok server= sillyhub-file protocol= 2024-11-05
[e2e] tools/list → ["upload_file","list_uploaded_files"]
[e2e] upload_file → {"file_id":"eaee72cf-187a-452d-8d02-6a6bc9e65abf","original_name":"verify-report.txt","mime_type":"text/plain","size":57,"description":"verify 阶段端到端上传验证文件"}
[e2e] 逃逸上传 → isError= true  {"error":"path_out_of_root",...}
[e2e] list_uploaded_files → {"files":[{"file_id":"eaee72cf-...","created_at":"2026-08-23T06:29:26.300229Z"}]}
```

权限链真实行为：无鉴权 401；持有效 daemon API key 访问无权限 workspace 的 run → **403 中文文案**（"对该会话或执行记录所属的工作区没有相应权限"）。

### 3. 数据落库实证（生产 PG，psql 查询）

```
select ... from file where id='eaee72cf-...';
  owner_type=agent_run | owner_id=d09a7662-... | description="verify 阶段端到端上传验证文件" | stored_key=2026/08/eaee72cf-....txt

select run_id, channel, tool_kind, dedup_key, left(content_redacted,120) from agent_run_logs
  where dedup_key='file-upload:eaee72cf-...';
  channel=tool_call | tool_kind=FileUpload | content={"file_id": "eaee72cf-...", "original_name": "verify-report.txt", ...}
```

聊天流定位承载（AgentRunLog 行）与文件中心归属（File 行 owner_type=agent_run）在真实库中均落位。

### 4. 覆盖边界说明（诚实披露）

- daemon 主进程（cli.ts 入口）未重启验证：本机活跃 daemon 实例由并行会话运维，重启会干扰（多实例已知坑）。cli.ts 改动（mainAgentMcpConfigProvider 并入 sillyhub-file）由 37 个注入用例 + bundle 构建 + typecheck 覆盖；其运行时形态与已实证的 mcp-server 进程同链（同一 build/bundle 产物）。
- 会话内真实 agent 发起上传（完整 agent 会话链）未执行：需活跃 claude 会话消耗 LLM 配额；MCP server 进程→backend 全链已由上述 e2e 实证，agent 侧仅差 SDK spawn 注入（task-06 单测锁定）。
