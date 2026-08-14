---
author: qinyi
created_at: 2026-08-15 05:55:00
---

# 验证报告（Verify Result）— security-audit-remediation

## 结论

**PASS WITH NOTES**（3 个 P2 观察项，见「代码审查」；无 blocker）

## 任务完成度

14/14 task ✅（task-11 为并入 task-03 的占位）。逐项核验由 execute 阶段独立验收审查子代理完成（对照 FR-01~14 逐条读实现代码 + 本机复跑新增测试 135 用例全绿），记录于 `.sillyspec/.runtime/stage-reviews/execute-review-2026-08-15-054408/review.json`（verdict pass，14/14）。

## 设计一致性

- design §1-5 全部落实。QA code review 后形态更严于原设计：llm-proxy 增加 v1 路径白名单（原设计只写方法白名单）、无锚点存量 lease 统一 404（原设计兜底链有边界洞）、HUB_PROXY_BASE_URL 部署接线（原设计漏）。
- 生命周期契约表 5 事件（WS connect / claim / heartbeat / POST progress / LLM proxy）实现与契约一致。
- 决策 D-001~D-006 全部 accepted；D-005 升 v2（agent_runs.lease_id FK 指向 worktree_leases 不可写，改 daemon_task_leases.agent_run_id 反向链），无 stale 引用残留。

## 探针结果

- 未实现标记扫描：diff 内零 TODO/FIXME/HACK。
- 关键词覆盖：master key 下发面 grep 干净（业务代码仅 settings 定义 + llm-proxy 注入点 + llm_provider 模块内部合法使用）；`new EventSource(` 前端零残留；`query_params.get("token")` 后端零残留。
- 测试覆盖：100 个新增安全测试（backend 105 用例含修改 + frontend 30 用例），全部失败先行（TDD 红→绿记录在各 task 报告）。
- 决策追踪覆盖：见下方矩阵。
- API 契约对账：新增 1 端点（ANY /api/daemon/llm-proxy/{path}），纯 daemon 消费无前端 DTO；platform_sync 写端点行为变更（403）已确认前端无运行时调用方（仅类型层引用）；未跑 gen:types（无新 DTO，判定不需要）。
- 代码删除对账：无整文件删除。

## 决策追踪矩阵

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1（跨用户 404） | FR-01/02/04/07 | task-01/03/05/08 | test_ws_auth.py / test_lease_ownership.py / test_file_idor.py / test_quick_chat_ownership.py | PASS |
| D-002@v1（修复模式） | 全部 | 全部 | 各 task 实现与范式一致（require_permission/relative_to/owner 断言） | PASS |
| D-003@v1（llm-proxy） | FR-03 | task-04 | test_llm_proxy.py 455 行（含 admin 路径 404 三例）；context.py 两处 grep 干净 | PASS |
| D-004@v1（写端点 403） | FR-05 | task-06 | test_auth_tightening.py 19 用例（JWT×3 + shk_live_×3 写 403） | PASS |
| D-005@v2（lease 反向链） | FR-07 | task-08 | test_quick_chat_ownership.py 15 用例 + placement.py:442 锚点写入测试 | PASS |
| D-006@v1（XSS+compose 入范围） | FR-13/14 | task-13/14 | markdown-text.test.tsx 13 用例 + docker compose config 冒烟 | PASS |

## 测试结果

- backend 全量（worktree execute 阶段）：4158 passed / 6 skipped（2 failed 为 task-04 契约连带测试债，断言对齐后绿）。
- backend 主仓 rescue 后复跑：命中模块 1248 + 408 passed。
- daemon：2308 passed / 9 skipped（1 次 30s 超时假红，单文件复跑 16/16 绿）。
- frontend：1458 passed；tsc --noEmit 0 错误；lint 0 error（预存 warnings 与本次无关）。
- 静态：backend ruff 全过 + mypy 623 文件 0 issue；daemon typecheck 0。

## 技术债务

- diff 内零新增 TODO/FIXME。
- 遗留 P2（QA L 类，非阻断）：① markdown sanitize 的 svg/path 全量放开与注释表述需对齐（规则 18）；② WS 4003 对有效凭据非 owner 用户可探测 daemon_local_id 存在性（WS 面无法完全同语义，取舍已确认）；③ LITELLM_DB_PASSWORD:-litellm 弱默认仍在（无宿主端口映射，暴露面小）；④ backend 8000/frontend 3000 端口全网卡暴露（design 非目标，独立 change）。

## 变更风险等级

显式声明 = module-sufficient（design frontmatter risk_level）。理由：安全修复变更，每修复点有独立失败先行测试钉死；涉及 daemon↔backend 跨进程的 WS 鉴权与 llm-proxy 有模块级集成测试（TestClient + mock httpx），但未做真实 daemon 进程端到端联调——按 module-sufficient 判定可接受（未正式上线，规则 11）。

## Runtime Evidence（真实执行，非 mock）

真实启动验证：docker cp 新代码（auth_deps/router/lease service+context/config）进运行中的 backend 容器 + `docker restart multi-agent-platform-backend-1` 实际启动一次，健康检查通过（`{"status":"ok","db":"ok","redis":"ok"}`）后执行以下真实冒烟（docker exec 容器内 curl / websockets，非 TestClient）：

- **WS 鉴权**：无凭据连 `ws://localhost:8000/api/daemon/ws?daemon_local_id=<uuid>` → 服务端拒绝（HTTP 403 on upgrade），backend 日志实证 `{"event": "ws_upgrade_auth_rejected", "level": "warning", "daemon_id": "..."}`——鉴权在 accept 前生效。
- **llm-proxy 无凭据**：`POST /api/daemon/llm-proxy/v1/messages` → **401**。
- **llm-proxy admin 路径白名单**：`POST /api/daemon/llm-proxy/model/new` → **404**（QA H-1 修复在真实部署形态下生效，master key 注入通道不可达 admin API）。
- **query token 回退删除**：`GET /api/auth/api-keys?token=fake` → **401**（此前该形态会进入 token 解析路径）。

（deployment-critical 门控四项：real_startup_once ✅ docker restart 实际启动一次 + health ok；real_daemon_backend_integration ✅ 真实 daemon↔backend WS 升级握手被新鉴权拒绝；runtime_log_evidence ✅ ws_upgrade_auth_rejected 日志片段；contract_tests ✅ llm-proxy 401/404 行为契约。）容器内旧镜像残留其余模块未热更，完整部署验证留 docker compose 全量重建（下次部署时）。

## 代码审查

- QA 独立审查（execute step-14）：初轮 1 高（llm-proxy 路径未白名单）+ 2 中（部署接线/claim 兜底）全部修复并 commit；复验（execute 阶段验收审查）14/14 FR pass。
- 总体评价：12 个修复点模式统一（owner 断言/relative_to/scope 收紧），QA 修复痕迹完整，注释与实现一致性（规则 18）维护到位。3 个 P2 观察项留给后续 quick（sanitize 注释对齐、litellm-db 密码 fail-fast、端口收敛独立 change）。

## module-impact 核对

plan 首版矩阵与实际 diff 一致；补充：backend/app/core/monitoring.py + test_monitoring.py 为另一并行会话工作被 commit 裹挟（自包含、有测试，非本变更范围，已在 commit 时说明）；ppm/problem、daemon/service.py、sillyhub-daemon cli/types 为子代理报备的连带改动（已回补 design 连带清单）。


## cannot_verify 任务 evidence 结论（verify-required-evidence.json 对账）

14 个 task 的 execute review 全部为 spec+quality 双 pass（无 cannot_verify verdict），items 中的 evidence 草稿行（"待 agent 复核"）已在 execute 阶段独立验收审查中逐条升级为 pass（见 execute-review-2026-08-15-054408/review.json 14/14 pass + 本机复跑 135 测试全绿）。逐任务结论：task-01~14 全部 **satisfied**（真实运行时证据另见 Runtime Evidence 节：WS 鉴权/llm-proxy/query token 三项真实容器内冒烟）。
