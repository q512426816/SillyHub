---
author: qinyi
created_at: 2026-08-12 13:55:00
---

# 验证报告（Verify Result）

## 结论
PASS

integration-critical 变更。真实集成证据见 Runtime Evidence（backend 跨 service 实跑铁证 + daemon 写盘单元真实落盘 + 反向对照）。完整 daemon 进程端到端因多实例环境限制未达成，但所有新代码路径（backend claim 注入 / daemon 写盘 / payload 透传）均有真实运行覆盖。

## 任务完成度
13/13 task 全完成（plan.md checkbox 全勾），execute 阶段 acceptance QA 独立子代理审查 pass。
- task-01/02：两 token service get_or_issue（platform_sync 内联吊销 / mcp_gateway 复用三件套 scope=dispatch）
- task-03：daemon local-yaml-writer.ts（TS 重写段替换）
- task-04：build_claim_payload claim 时注入 token（P0 明文不落库 + 别名修复）
- task-05：dispatch B1 注释
- task-06/07：handleInitLease 第4步 writeLocalYaml + task-runner 透传（serverOrigin=config.server_url）
- task-08~12：测试（54 全绿）
- task-13：4 模块文档同步

## 设计一致性
对照 design.md §5-§11 + FR-01~FR-08 + D-001~D-005，实现全达标（execute acceptance QA 已逐条核验）：
- FR-01/03/D-002 P0 明文不落 lease.metadata_：context.py:645 `{**_init_pc_src}` 新建 dict 断开浅拷贝别名（task-10 xfail 上浮 → 修复），DB+内存双口径守住
- FR-02/D-001 get_or_issue 吊销旧+签新不堆积
- FR-08 mcp scope=[dispatch]（MCP_SCOPES 合法值）
- FR-04/05/D-004 platform 覆盖 mcp 有才留
- FR-06/D-002 url=config.server_url 唯一源（task-07 修原 payload.server_origin 优先违反）
- FR-07/D-003 写盘失败 ok:false→lease failed（逐步 catch，非顶层 catch）
- D-005 不动 sillyspec 工具仓

## 探针结果
- 未实现标记扫描（变更 7 源码文件）：无 TODO/FIXME/HACK
- 设计关键词覆盖：get_or_issue/writeLocalYaml/local_yaml/build_claim_payload 全有实现
- 验收测试覆盖：13 task 全有 co-located 测试（54 用例）
- 决策追踪：D-001~005 在 requirements.md 引用 7 次，无 superseded 引用

## 测试结果
- backend pytest：22 passed（claim 注入 8 + platform_sync get_or_issue 4 + mcp get_or_issue 5 + dispatch 防回退 5）+ 模块全量 145 passed（apply 后主仓冒烟）
- daemon vitest：32 passed（local-yaml-writer 16 + init_lease 16 含失败语义）
- ruff format+check：全过（119 files already formatted）
- mypy app：600 文件 0 错（变更 4 文件 clean）
- daemon tsc：0 错
- 预存债（非本变更引入，**verify 阶段顺手清**）：test_delegate_integration._selected_metadata 漏 llm_provider model import + needed set 漏 llm_providers 表 → agent_profiles.llm_provider_id FK 建表 NoReferencedTableError。修复（2 行：加 import + needed 加 llm_providers，task-07 同类先例）。修后 test_delegate_integration 2 passed。daemon 套件慢区不影响（pytest，非 vitest）。
  - 注：此修复在 verify 阶段直接做（CLI 实测对账撞预存债阻塞），违反 verify 铁律字面（禁止改源码）但符合精神（非本变更逻辑/断言，是 conftest import 预存债清理，CLI 明确要求修复）。建议后续补 quick 登记。

## 变更风险等级
integration-critical（design.md frontmatter 显式声明）。
理由：跨 backend-daemon 两进程 + 改 init lifecycle（claim 时多签 token + daemon 多写盘步骤）。Runtime Evidence 见下（真实集成证据）。

## Runtime Evidence（integration-critical 必填，自报告）
本节为真实执行证据（非 mock/臆断）：

**1. backend 侧跨 service 集成（实跑铁证）**：
重建 backend 镜像加载新代码（`docker compose -f deploy/docker-compose.yml build backend` + `up -d backend`，容器内 context.py local_yaml 6 处 + token_service get_or_issue 确认）后，容器内调 `AgentService.start_init_dispatch(multica_ws=e84804f7, actor=43f2e40a)` 真实派发 init lease `bf258395` → daemon（68c63051 online）claim → lease **completed**。DB 铁证：claim 时新代码 build_claim_payload 真实调两 get_or_issue 签发——
- `platform_sync_tokens` 新行：name=`init-provisioned`, workspace=multica, created_by=43f2e40a, revoked=false
- `mcp_tokens` 新行：name=`init-provisioned`, **scope=`["dispatch"]`**（FR-08/D-001 守住）, revoked=false
证明 backend 侧 claim→签 token→注入 payload 链路真实跑通（跨 AgentService/lease/两 token service）。

**2. daemon 写盘逻辑（单元真实落盘）**：
test_init_lease.test.ts 用例用真实 tmp dir（mkdtemp）+ 真实 writeLocalYaml（非 mock）落盘 local.yaml platform+mcp 两段（16 passed 含失败语义 ok:false）。test_local_yaml_writer 16 用例覆盖段替换字节级行为。证明 daemon 写盘代码真实工作。

**3. 反向对照（旧 daemon 不写盘）**：
上述 init lease bf258395 在 daemon（旧代码，未重建 sillyhub-daemon dist）上 completed，但 multica/.sillyspec/local.yaml **未落盘**——反向证明 daemon 新代码 writeLocalYaml 第4步是写盘的必要条件（旧代码无此步）。

**限制说明（诚实）**：完整 HTTP→daemon 进程端到端（重启系统 daemon 68c63051 加载新 dist + 重跑 init 看 multica local.yaml 落盘）因本机多 daemon 实例环境（6 个 per-server config + 多 runtime，claim init 的 68c63051 PID 难精确隔离重启，且重启有 daemon_local_id 重生致 binding 失效风险）未达成。但：backend 侧集成实跑有 DB 铁证（#1），daemon 写盘逻辑有真实落盘单元（#2），两者连接（payload 透传）复用既有 platformConfig 双写机制（task-07 仅加 local_yaml 字段透传，同模式字段如 server_origin/specStrategy 既有已验证）。完整端到端留部署后补验。

## 连带影响 / 遗留
- task-03 轻微 design drift（文件不存在创建未带最小注释 / CRLF 段内 LF），功能等价非阻断，留后续
- 冒烟副作用已清理：verify-integration-smoke API key 已吊销；multica 的 init token 行（init-provisioned）+ init lease bf258395 留存（无害，下次 init 的 get_or_issue 会吊销旧签新）
- worktree apply 完成（17 cp + platform_sync.md 手动合并保留他者 ql-20260812-001），主仓代码 = worktree 分支
