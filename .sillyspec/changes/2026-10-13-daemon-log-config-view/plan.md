---
author: qinyi
created_at: 2026-10-13 17:05:00
plan_level: full
execution_mode: main
---
# 实现计划（Plan）— daemon 日志与配置的平台查看

## Spike 前置验证

无 Spike——技术方案全部复用平台已验证先例（daemon WS RPC 注册模式 `daemon.ts:6985` 区域、backend `send_rpc` 转发 `ws_hub.py:529`、前端 antd Modal + Blob 下载 `explorer.ts:105`），无新技术栈/未验证集成/性能瓶颈，不确定性已由 brainstorm 阶段源码核验消除（Design Grill 五交叉点全实证）。

## Wave 1（并行，无依赖）
- task-01
- task-02

## Wave 2（依赖前序 Wave）
- task-03

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | daemon 诊断 RPC（测试先行同卡）：diag-rpc.ts 尾部读+脱敏、daemon.ts 注册 handler、vitest 单测 | W1 | P0 | — | FR-01, FR-03, FR-04, FR-06, FR-07, D-001@v2, D-002@v1, D-004@v1 | 尾部行/字节双上限先到先截 + truncated；SENSITIVE_CONFIG_FIELDS=['token','api_key']、len<16 全掩公式；handler 内 exists:false 五字段兜底（分块大小等实现常量以 TaskCard 为准） |
| task-02 | backend 转发端点（测试同卡+类型产物收尾）：schema.py DTO、machines.py 两端点、_ENDPOINT_ORDER、pytest、openapi.json + gen:types | W1 | P0 | — | FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, D-004@v1 | GET {instance_id}/logs?tail / config?reveal；RuntimeAdminUser + _get_owned_instance；send_rpc timeout=30；错误映射（离线/超时原样透传 504 / method_not_found→422 / 其余→502）；收尾跑 pnpm gen:types 提交双产物（规则 21） |
| task-03 | 前端诊断弹窗（测试先行同卡+文档同步）：machines.ts client、daemon-diagnostic-dialog.tsx、machine-card.tsx 入口、runtimes/page.tsx 串联、vitest、模块文档同步 | W2 | P0 | task-02 | FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, D-001@v2, D-002@v1, D-003@v1, D-007@v1 | 双 Tab（行数 100/500/2000+刷新+下载+truncated 提示；掩码高亮+明文切换+恒脱敏下载）；五类边界态提示条；下载恒以 reveal=false 取数；机器离线按钮禁用；新 onOpenDiagnostic prop 走可选设计保既有 machine-card 用例不回归（连带测试归属见 TaskCard allowed_paths）；文档同步并入本卡 |

## 关键路径

task-02 → task-03（W2 依赖 task-02 的类型产物；task-01 与 task-02 并行——若两者时长相当，task-01 同为 Wave 1 门闸，仅当 task-02 明显更长时 task-01 才落在关键路径之外）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）

- 全链路只读——平台不提供 daemon 配置的在线编辑。
- 配置下载恒脱敏——无论页面处于掩码态还是明文态，下载内容永远为脱敏 JSON（D-007）；下载恒以 reveal=false 口径取数，不复用明文 state。
- 敏感字段清单 SENSITIVE_CONFIG_FIELDS = ['token', 'api_key']；掩码公式：len < 16 → 整值掩码为 '***'，len ≥ 16 → 前4位 + '***' + 后4位（D-001@v2）。
- 日志读取行上限 5000 与尾部字节上限 262144B（256KB）先到先截，超限返回 truncated=true。
- 日志/配置路径由 daemon 侧权威解析（DEFAULT_CONFIG_DIR + 'daemon.log' / configPathForServer(server_url)），backend/前端不拼 daemon 本机路径。
- 错误映射：离线/超时原样透传既有 504 AppError（不包裹、不改写错误 code）；method_not_found → 422 HTTP_422_DAEMON_DIAG_UNSUPPORTED；其余远端错 → 502 DaemonRpcRemoteGatewayError。
- 不得新增第三方运行时依赖（daemon 零依赖、backend 用既有 FastAPI 栈、前端用既有 antd/tailwind）。
- 兼容 Windows/Linux/macOS；UI 文案全中文（专业术语除外）；老 daemon（未升级）时平台其余功能不受影响。

## 全局验收标准

1. 三端模块测试全绿：daemon vitest（diag-rpc.test.ts）、backend pytest（test_daemon_machine_diag.py）、frontend vitest（daemon-diagnostic-dialog.test.tsx）。
2. 集成敏感冒烟（跨进程装配）：本地起 daemon + backend + frontend，走通「/runtimes 机器卡 → 日志弹窗（行数/刷新/下载/truncated 提示）→ 配置弹窗（掩码/明文切换/恒脱敏下载）」全链路。
3. 边界态实测至少各一条：老 daemon（422 升级提示）、daemon.log 不存在（exists:false 前台运行提示）、机器离线（按钮禁用）。
4. （brownfield）不改变任何现有 API/表结构/心跳协议；老 daemon 平台其余功能不受影响。
5. 类型产物同期提交：backend/openapi.json + frontend/src/lib/api-types.ts（pnpm gen:types）。

> 验收结论不落在 plan.md——逐项核验结果由 verify 阶段写入 verify-result.md；task 级验收对照 TaskCard frontmatter 的 acceptance 字段。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v2 | task-01, task-03 | daemon 单测掩码边界（len=0/8/9/15/16/24）+ 配置 Tab 掩码/明文切换用例 |
| D-002@v1 | task-01, task-02, task-03 | 尾部读+字节上限+truncated 单测；端点 tail 参数用例；行数 Select/刷新用例 |
| D-003@v1 | task-03 | 只读标注 + 下载按钮（恒脱敏）用例 |
| D-004@v1 | task-01, task-02, task-03 | 全链路实现路径（daemon RPC → backend 转发 → 前端弹窗） |
| D-005@v1 | —（rejected 防复潮） | — |
| D-006@v1 | —（rejected 防复潮） | — |
| D-007@v1 | task-03 | 明文态下载仍为脱敏 JSON 的用例（AC） |
