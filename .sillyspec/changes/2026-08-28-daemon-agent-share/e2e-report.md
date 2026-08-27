---
author: qinyi
created_at: 2026-08-28 07:40:00
---

# E2E 实测报告 — 2026-08-28-daemon-agent-share

> 环境：本机 Docker Compose（backend 含本变更加 D-012/D-013/DTO 修复；宿主机 daemon 升级至
> build 10009f18-20260828070607 含 D-011 overlay）。账号：admin/admin123（平台管理员）、
> 180024/180024（multi-agent-platform 工作区业务成员）。测试后所有会话已结束、违规写文件已清理。

## E2E-A：工作区共享守护进程（全过 ✅）

| # | 步骤 | 结果 |
|---|---|---|
| A1 | 180024 视角 `GET /api/daemon/machines` | ✅ shared_to_me 含 admin 在线机器（共享人「系统管理员」+7 引擎明细，含在线态——task-13 契约 live 生效） |
| A2 | 180024 钉定共享机器 claude runtime 创建会话 | ✅ HTTP 201（旧版此处 owner-only 404）；run completed |
| A3 | 借用审计落库 | ✅ daemon_borrow_audit 新行：borrower=180024 / lender=admin / workspace=b97f8231 / **grant_id=2439a83f 非空** / usage 回填 completed |
| A4 | FR-03 越权四连（PATCH 别名 / PUT 可写目录 / DELETE / disable） | ✅ 全部 404（owner-only 语义保持，不泄露存在性） |

## E2E-B：平台共享智能体（发现 1 个已修复缺陷 + 1 个未定位缺陷 ⚠️）

| # | 步骤 | 结果 |
|---|---|---|
| B1 | admin 创建共享智能体（档案 857f7582 + 自己在线 runtime + 源码工作区 b97f8231 + writable_dir=C:/Users/qinyi/e2e-shared-output） | ✅ 201（五重校验通过，visibility_promoted=false） |
| B2 | 180024 视角 active 列表 | ✅ 1 条（档案名/provider/runtime_online） |
| B3 | 180024 **只传共享档案**（无 runtime_id/provider）创建会话 | ✅ 201（**缺陷①已修复**：原 DTO validator 422，修复=放行 agent_profile_id 形态+2 回归用例，31 绿） |
| B4 | 服务端强制项核验 | ✅ runtime 钉定=admin claude runtime；cwd=C:\...\multi-agent-platform（源码工作区）；lease tool_config=七工具无 Bash；lease effective_allowed_roots=[writable_dir]（claim payload 双键实测）；daemon_borrow_audit 零新增（D-007） |
| B5 | 实测① 写 writable_dir 内（e2e-inside.txt） | ✅ 文件写入成功 |
| B6 | 实测③ Bash 写 | ✅ **被拒**：`read_only: tool 'Bash' not in allowed_tools whitelist [...]`（D-009 白名单 gate live 生效，文件未创建） |
| B7 | 实测② 写 writable_dir 外 | ❌ **未被拒（R-10）**：e2e-outside-test.txt / e2e-outside-2.txt 均写入成功（测试后已清理） |

## R-10：daemon 侧共享会话写守卫未生效（未定位根因，登记待修）

**现象**：平台共享会话的 Write 目录外写放行、零 policy_audit_log 行；同 daemon 上普通会话
（admin 自有 runtime、无 allowedTools spec）机器级边界写**正确 deny + 审计落库**（对照实验：
`Write DENY c:\e2e-machine-root-test.txt`，中文 deny 文案）。

**已排除假设**（证据）：
1. ❌ daemon 未跑新代码——build_id 10009f18（含 overlay，bundle grep ×6）；
2. ❌ backend claim payload 缺字段——容器内对 wt2 lease 实跑 `build_claim_payload`：
   effectiveAllowedRoots/effective_allowed_roots 双键 + tool_config 全在；
3. ❌ enableApproval 分支问题——manual_approval=False 强制后复测仍放行（该修复保留：平台会话
   无需人审，语义合理）；
4. ❌ canUseTool 未注入——Bash 被 gate 拒证明链路通；
5. ❌ 守卫逻辑错误——daemon 单测 7 用例（三态/交集/fail-closed）+ 对照实验机器级 deny 证明
   SessionManager 判定本身正确。

**剩余怀疑**：`execPayload.effectiveAllowedRoots → CreateSessionInput → state` 在共享会话
（带 allowedTools spec）路径上的某层丢失（对照会话无 allowedTools 所以不受影响——差异变量
锁定为 spec.allowedTools 存在时 gate/驱动层的交互）。

**下一步建议**：daemon `_startInteractiveSession`/`SessionManager.create` 对
effectiveAllowedRoots 加一行诊断日志（写 daemon.err.log），一次实验定位丢失层；或临时以
「共享会话也注入 borrow-sandbox marker 语义」绕过（不推荐，语义不符）。

## 结论

- FR-01/02/03、D-006/D-007/D-008/D-012/D-013、D-009（Bash gate）：**E2E 全过**。
- D-002@v2 的 writable_dir 写边界：**backend 侧全链就位**（校验/注入/payload 实测），
  **daemon 侧执行未生效**（R-10）——Bash 逃逸面已封（gate），Write 越界写暂依赖机器级
  allowed_roots 兜底（实测中机器级 deny 有效，源码工作区在机器级 root 内故存在暴露面）。
- 缺陷①（DTO 422）已修复提交 + 用例；R-10 建议独立 quick 跟进（见 verify-result 技术债务）。
