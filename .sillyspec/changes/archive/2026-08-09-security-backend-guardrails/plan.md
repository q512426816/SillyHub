---
plan_level: full
author: qinyi
created_at: 2026-08-09T20:49:11
---

# 实现计划（Plan）— 后端防护加固：incident 状态机转换校验 + SSRF 三连

## Spike 前置验证
| Spike | 验证内容 | 不通过后果 |
|---|---|---|
| spike-01（并入 task-01 验收） | `app/core/ssrf.py` import `tool_policy` 无循环导入 + ToolPolicy ORM 表间接注册无运行期副作用 | task-01 重构为不依赖 tool_policy（内联 IP 判定），但 D-003 已评估可接受、Grill X-03 证实无环，预计通过 |
| spike-02（并入 task-04 验收） | grep 现存 repo_url 数据/种子/测试无 `file:///`/裸路径形式 | 若发现既有数据用 file://，按 D-004 评估迁移（企业场景应全 https/ssh，预计无） |

> 技术方案确定性强（复用已落地原语 + 已 Grill 证实），Spike 合并进对应 task 的验收步骤，不单列。

## Wave 1（并行，无依赖）
- [x] task-01: 新建 SSRF 统一入口 `app/core/ssrf.py`（assert_public_url 全量 + assert_safe_repo_url 协议白名单 + UnsafeRepoUrl 400）（覆盖：FR-07/08/10, D-003/004）
- [x] task-02: incident 状态机转换校验（INCIDENT_TRANSITIONS 放宽版图 + update() 插入 assert_transition + 重开清字段）（覆盖：FR-01~06, D-001/002/006）

## Wave 2（依赖 Wave 1 的 task-01）
- [x] task-03: mcp webhook SSRF 双查（create 注册前 + _deliver_one 投递前 assert_public_url，best-effort catch）（覆盖：FR-08/09, D-003）
- [x] task-04: worktree clone 协议白名单（clone_bare 前 assert_safe_repo_url，含 Windows 盘符收紧）（覆盖：FR-07, D-004）
- [x] task-05: http_get 逐跳 SSRF 复查（follow_redirects=False 手动 ≤3 跳 + 每跳 assert_public_url + 缺 Location 处理）（覆盖：FR-10, D-005）

## Wave 3（依赖 Wave 1+2 实现）
- [x] task-06: 测试 incident 转换校验（test_fsm.py：合法边全覆盖 + 非法边拒 422 + 重开清字段 + 同态幂等 + resolved→resolved 不刷时间戳）（覆盖：FR-01~06, AC-1/3/4/5）
- [x] task-07: 测试 SSRF 三连（test_ssrf.py / test_webhook_ssrf.py / test_repo_url_guard.py：IPv6/重定向/注册内网/协议白名单含 C:\foo）（覆盖：FR-07/08/09/10, AC-6/7/8/9）

## Wave 4（收尾）
- [x] task-08: 文档收尾（CONCERNS.md incident+SSRF 三连条目标 ✅ + backend.md 变更索引）（覆盖：NFR-01 文档同步）

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 新建 core/ssrf.py 统一入口 | W1 | P0 | — | FR-07/08/10, D-003/004 | façade 复用 tool_policy 原语；spike-01 冒烟并入 |
| task-02 | incident FSM 转换校验 | W1 | P0 | — | FR-01~06, D-001/002/006 | 复用 ppm/common/fsm.assert_transition；router 零改 |
| task-03 | mcp webhook SSRF 双查 | W2 | P0 | task-01 | FR-08/09, D-003 | create 硬拒 400 + deliver best-effort |
| task-04 | worktree clone 协议白名单 | W2 | P0 | task-01 | FR-07, D-004 | scp-like 加 hostname 字符类+长度≥2 挡 C:\foo；spike-02 grep 并入 |
| task-05 | http_get 逐跳复查 | W2 | P0 | task-01 | FR-10, D-005 | 手动 ≤3 跳每跳 assert_public_url |
| task-06 | 测试 incident FSM | W3 | P0 | task-02 | FR-01~06 | test_fsm.py |
| task-07 | 测试 SSRF 三连 | W3 | P0 | task-01/03/04/05 | FR-07/08/09/10 | 三测试文件，DNS mock 防 flaky |
| task-08 | 文档收尾 | W4 | P1 | task-02~07 | NFR-01 | CONCERNS + backend.md 变更索引 |

## 关键路径
task-01（ssrf 入口）→ task-03/04/05（三出站点接入，并行）→ task-07（SSRF 测试）→ task-08。task-02（incident）独立支线 → task-06。最长路径 task-01→task-05→task-07→task-08。

## 全局验收标准
- [ ] 后端全量相关测试通过：`cd backend && pytest app/modules/incident app/modules/mcp_gateway app/modules/worktree app/modules/tool_gateway app/core -q`（含新增 test_fsm/test_ssrf/test_webhook_ssrf/test_repo_url_guard）
- [ ] 现有功能零回归：incident/test_service+test_router、mcp/worktree/tool_gateway 既有用例全绿（NFR-01/AC-10）
- [ ] 导入冒烟：`python -c "import app.core.ssrf; import app.modules.incident.service; import app.modules.mcp_gateway.service; import app.modules.worktree.git_runner; import app.modules.tool_gateway.service"` 无循环导入
- [ ] ruff format：所有改动的后端 .py 文件提交前 `ruff format`（pre-commit hook 拦截）
- [ ] （brownfield）未配置新功能时行为不变：公网 webhook/clone/http 请求照常、incident 现有 open→investigating/resolved 照常
- [ ] 不碰 OpenAPI/DTO/migration → 无需 gen:types（NFR-03）

## 覆盖矩阵（decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02, task-06 | AC-1（放宽版图合法边 + 非法边拒 422） |
| D-002@v1 | task-02, task-06 | AC-3（重开清 resolved_at/by） |
| D-003@v1 | task-01, task-03, task-05, task-07 | AC-7/8/9（ssrf 统一入口 façade） |
| D-004@v1 | task-01, task-04, task-07 | AC-6（worktree 只禁危险协议放行内网 git + C:\foo 拒） |
| D-005@v1 | task-05, task-07 | AC-9（http_get 逐跳复查 IPv6+重定向） |
| D-006@v1 | task-02, task-06 | AC-2/4/5（非法值 400 / 非法转换 422 / 同态幂等） |
