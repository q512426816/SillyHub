---
author: WhaleFall
created_at: 2026-08-15 16:12:00
change: 2026-08-14-sessions-portal
---

# 验证报告（Verify Result）— 智能体会话总入口页面（/sessions）

## 结论

**PASS WITH NOTES**

- 18/18 task 全部完成（execute 14/14 步；Task Review Gate 全 pass；acceptance review 独立 QA 20/20 pass，docHash 8a9eaf10…）。
- 三端单元/集成测试全绿：后端 1462 passed（daemon+agent+llm_provider 三模块，-n auto）；daemon 2327 passed / 9 skipped / 5 failed（5 个失败文件为主仓基线既有环境失败，主仓无改动复跑同样失败，与本变更无关）；前端 150 文件 / 1508 passed。lint 三端 0 error。
- **真实 daemon↔backend 集成（端到端 e2e，非 mock 单测）通过**，见「Runtime Evidence」章节：本机 Docker 重建 backend（含迁移）+ host daemon 新 dist 重启，真实走完「带配置新建会话 → daemon 领取 lease 启动会话 → 真实 LLM 轮次 → 供应商切换（SESSION_SWITCH_CONFIG 真实 WS 送达）→ reload+resume → 新轮 completed → 轮次快照/额度端点核验」全链路。
- 交付已提交主仓 main：3616cec3（停用变更规范入库）+ a4db9b69（本变更交付，52 文件 +13516/-809）。

## 逐项检查（对照 design.md FR/D）

| 项 | 结果 | 证据 |
|---|---|---|
| FR-01 四选择器联动 | PASS | NewSessionForm（f0628a28）12 用例；E2E 真实创建带 runtime_id+profile+provider 的会话 201（Runtime Evidence §1） |
| FR-02 会话列表+筛选+虚拟滚动 | PASS | task-06 SQL 过滤 17 用例 + task-11 组件 13 用例（@tanstack/react-virtual + 无限分页） |
| FR-03 未选配置=现状零回归 | PASS | 后端三处零回归测试（priority bound/default 逐字段 / create legacy / plain-inject）；E2E 切换轮 providerConfig=null 走本机默认真实 completed（§4） |
| FR-04 会话级配置生效+两级优先级 | PASS | `_inject_provider_config` session_llm_provider_id 最高优先级 8 用例矩阵；E2E 首轮真实用会话供应商（GLM 429 错误即其凭证真实生效的证明，§2） |
| FR-05 idle 切换/running 挂边界/历史保留 | PASS | daemon 21+11 用例（PENDING 边界/恢复路径）；E2E 真实切换 SESSION_SWITCH_CONFIG 送达+reload+新轮 completed（§4） |
| FR-06 切换校验 4xx | PASS | kind 错配 422/他人供应商 404/borrower 放行（test_session_switch_config 12 用例） |
| FR-07 who 行按轮快照、历史不跟随 | PASS | E2E DB 实证：旧 run 保留 llm_provider_id=810faa07，新 run=NULL（§4）；runs API 暴露快照；TurnTimeline whoLine 17 用例 |
| FR-08 用量环+额度胶囊 | PASS | 三级降级 19 用例；E2E 真实额度端点返回 windows（5h 窗 left=0.0 与同刻 GLM 429「5 小时上限」互证，§5） |
| D-002 弹窗零回归 | PASS | 三套弹窗测试一行未改全绿；panel 重组装层（-621/+54） |
| D-004@v2 机器/智能体纯展示 | PASS | SessionConfigBar 置灰态测试（二期/需开新会话标注） |
| D-008/D-011/D-013/D-014 | PASS | 各 task 卡覆盖矩阵全部有测试落点（见 plan.md 覆盖矩阵） |
| §9 兼容策略 | PASS | provider 入参保留/新列 nullable/旧 sessions.json 容错/daemon 未知消息忽略——均有测试或 E2E 实证 |

## 测试套件与结果（单元/集成）

| 端 | 命令 | 结果 |
|---|---|---|
| backend | `uv run pytest app/modules/daemon/tests app/modules/agent app/modules/llm_provider/tests -q -n auto` | **1462 passed, 0 failed** |
| daemon | `pnpm test`（sillyhub-daemon 全量） | **2327 passed / 9 skipped / 5 failed**（5 failed=spec-sync/test_init_lease/test_pull_before_push/policy-allowed-roots/spec-transport-tar-sync，主仓基线既有环境失败，已对照主仓无改动复跑坐实） |
| frontend | `pnpm test` | **150 files / 1508 passed** |
| lint | backend ruff check / daemon tsc --noEmit / frontend pnpm lint | 0 error（存量 warning 不涉本变更） |

## Runtime Evidence（真实 daemon↔backend 集成，端到端 e2e）

**环境**：本机 Docker（deploy/docker-compose.yml）重建 backend 镜像（COMMIT_SHA=a4db9b69）并 up -d —— alembic 迁移 20260815090000 自动应用（psql 实证 agent_sessions 三列 + agent_runs.llm_provider_id 存在）；host daemon `sillyhub-daemon` 新 dist（tsc 重建）以 `--server http://localhost:8000` 重启，runtime `e851b5a6`（DESKTOP-2BN7FDC, claude）online。

### §1 带配置新建会话（FR-01/FR-04/C-12）

```
POST /api/daemon/sessions {runtime_id, agent_profile_id(平台档案), llm_provider_id(GLM), prompt}
→ 201 {session_id: 2cf0d186…, status: active}
psql: agent_sessions.config_snapshot = {"profile_name": "Claude Code 默认", "provider_name": "智谱 GLM - wp",
      "model": "glm-5.1", "engine": "claude", "machine_name": "DESKTOP-2BN7FDC", "agent_name": "…"}
```

### §2 daemon 真实领取 + 真实 LLM 轮次（daemon↔backend WS 非 mock）

```
[daemon.task_available] lease_id=73c6c625…
[daemon.interactive_session_started] session_id=2cf0d186… run_id=19c2c857…
→ 首轮经会话级供应商真实调 GLM 上游，返回 quota 429：
run error_detail = {"type":"quota_exceeded","code":"1308","message":"额度或配额已耗尽",
  "raw":"API Error: Request rejected (429) · [1308][已达到 5 小时的使用上限。…2026-08-15 17:26:53 重置]"}
→ 会话保持 active（Grill C-11 收敛），run→failed
```

### §3/§4 SESSION_SWITCH_CONFIG 真实送达与切换（FR-05/D-008/D-012）

```
POST /api/daemon/sessions/2cf0d186…/inject {"prompt":"切换冒烟…","llm_provider_id":""}  （空串=切回本机默认）
→ 200 {run_id: 9ed48ec7…, status: pending}
daemon 日志：[daemon.session_switch_config_received] session_id=2cf0d186… run_id=9ed48ec7… has_profile=false has_provider_config=false
→ daemon reload+resume 喂切换轮 prompt，新轮真实执行 completed（本机默认供应商）
DB 实证（历史不跟随，D-008）：
  旧 run 19c2c857: failed, llm_provider_id=810faa07(GLM)
  新 run 9ed48ec7: completed, llm_provider_id=NULL, input_tokens=21996 output_tokens=3
  会话行: llm_provider_id=NULL, config_snapshot.provider_name=NULL
```

### §5 runs 快照与额度端点（FR-07/FR-08，gap-fix 60555763 实证）

```
GET /api/daemon/sessions/2cf0d186…/runs → 每轮含 agent_profile_snapshot / llm_provider_id / usage tokens
GET /api/llm-providers/810faa07…/quota → {"quota":{"windows":[
  {"label":"max·5小时窗","left":0.0,"reset":"…09:26:53Z"},   ← 与 §2 的 429 五小时上限互证
  {"label":"max·周限额","left":42.0,"reset":"2026-08-19…"}]}}  ← 真实智谱上游实时数据
```

## 生命周期核验（E2E 真实数据，对照 §7.4 契约表）

- backend 会话状态：pending → active（创建即激活，§1）；切换不改状态机（inject 后仍 active，§4）；run failed 会话保持 active（Grill C-11 收敛，§2）。
- backend run 状态：running → failed（GLM 429，§2）；running → completed（切换轮，§4）。
- session/lease end：既有 end/interrupt 链路未被本变更加改（页面接入 endSession/reopenSession 复用既有端点）。
- 失败模式排除：① 切换 send 失败→run failed+session active 可重试（12 用例+ Grill C-11）；② 会话供应商 id 失效→claim 降级走原链不阻断（8 用例）；③ 钉定 runtime 离线→409 不静默换机（15 用例+E2E 用真实 online runtime）；④ daemon 重启→sessions.json 恢复 config 快照（PERSIST 用例+本次 daemon 重启真实恢复 1 会话）。

## 代码审查

- execute 期间 18 task review（主代理逐 diff 独立核验）+ 独立 QA acceptance review（20/20 pass，docHash 8a9eaf10…）+ Stage Review Gate 通过。
- 总体评价：实现严格贴合 design 与决策；零回归策略（独立 key/非 commit 变体/可选字段缺省不渲染）贯穿三端；契约服从良好（两处 CONTRACT_GAP 上报未编造并由 gap-fix 正确闭合）。
- 次要观察（不阻断，见 Notes）：wire 常量双侧模块级未收敛 protocol；payload camelCase 与既有 snake_case 风格并存（daemon 双读兼容）；api_key 落盘信任域决策已注记。

## Notes（不阻断）

1. daemon 全仓 5 个 spec-sync 系既有环境失败（主仓基线同样失败），建议后续单独 quick 排查，与本变更无关。
2. SESSION_SWITCH_CONFIG wire 常量在 backend service.py 与 daemon daemon.ts 两侧模块级定义（字面已逐字对齐且有测试锁定），后续可收敛进双侧 protocol 文件（已注记升级路径）。
3. sessions.json 持久化 providerConfig 含 api_key（0600 与 credentials.json 同信任域，design §5 Wave2 要求 resume 不丢配置的有意决策，已注记）。
4. 机器多选≥2 台筛选为已加载页客户端过滤（后端 machine_id 单值参数能力限制，代码注释+测试钉死）。
5. cache token（cache_read/creation）未暴露（CtxUsageBar 口径只吃 input_tokens，按需后续加）。
6. 端到端冒烟的会话/运行数据（2cf0d186 等）为验证产物，可按项目惯例（未上线允许重置）清理或保留。
