# Round 1 独立审查结论（fail，留档）

author: qinyi
created_at: 2026-08-23 09:15:00

> Round 2（2026-08-23）：specVerdict=fail / qualityVerdict=pass——5/6 blocker 闭合，剩 NEW-1（D-009 凭证通道被 mcp-config.ts:288-296 spike-01 反证）+ 2 个 P2（§5:51 旧句与 D-010 矛盾；§7.1 created_at 无 DTO 来源）。
> Round 2 修正：D-009@v2（凭证走 per-server env 写 0600 tmpfile，`${VAR}` 展开列为 R-03 spike 加固项）；§5 旧句更正；FileMetaResp 补 created_at；§7.2 补 WRITE⊇READ 种子角色软假设说明。

第一轮 Design Grill（独立子代理，2026-08-23）：specVerdict=fail / qualityVerdict=fail。

## Unresolved Blockers（6 项，已全部进入 v2 修正）

| ID | 优先级 | 问题 | v2 修正决策 |
|---|---|---|---|
| UB-01 | P0 | File 表无 description 列，§7 响应契约与 §8「无新列」矛盾 | D-006@v2：File 加 description 列（nullable）+ alembic 迁移 |
| UB-02 | P0 | AgentRun 无 workspace_id 列，_can_access agent_run 分支不可实现 | D-004@v2：解析链 target_workspace_id ?? mission.workspace_id ?? task，NULL 兜底 deny |
| UB-03 | P1 | 直写 AgentRunLog 不经 Redis publish，实时 SSE 收不到 | D-011@v1：写行后 publish（复用 publish_submitted_messages 语义） |
| UB-04 | P1 | .mcp.json 写 workDir 污染用户真实仓库 + 内嵌 daemon 凭证落盘 | D-009@v1：tmpdir 临时文件 0600+run 终清理；凭证走 spawnEnv 白名单不落盘 |
| UB-05 | P1 | R-02 白名单缓解无文件归属；mcp__x__* 通配符未验证 | §6 补 execution.py 行；用整服务器名 mcp__sillyhub-file |
| UB-06 | P1 | run 页 listFiles 非 admin 把 run UUID 当 workspace id → 404 | D-010@v1：run 页数据源改 GET /api/agent/file-artifacts?run_id= |

## 附带修正（P2/P3）

- 挂载点定案：agent/router.py:905（非 main.py）
- GET /api/agent/file-artifacts 鉴权降为 WORKSPACE_READ（读操作，普通成员可列）
- 直写行 catch IntegrityError（dedup_key 撞部分唯一索引）视作已写入；幂等措辞收敛为「重放防护」
- profile mcp_refs 过滤交互补进兼容策略（sillyhub-file 与 sillyhub-daemon 同语义受过滤）
- D-006@v1 证据引文失实修正（owner_type 实为 String(64) NOT NULL）
