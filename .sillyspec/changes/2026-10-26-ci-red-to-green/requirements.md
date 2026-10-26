---
author: flow-machine-draft
created_at: 2026-10-26T15:08:59.741Z
---
# 需求规格（Requirements）— 2026-10-26-ci-red-to-green

## 功能需求

### FR-01: e2e-ci workflow 的 PG service 必须使用含 pgvector 扩展的镜像，迁移链可完整执行

`.github/workflows/e2e-ci.yml` 的 postgres service 必须使用 `pgvector/pgvector:pg16` 镜像（与 deploy/docker-compose.yml:7 一致），禁止使用无 vector 扩展的 `postgres:16-alpine`；alembic 迁移 20261015200000（CREATE EXTENSION vector，fail-closed 守卫）在 e2e 环境必须可执行到 head。依据：迁移报错信息自带的修复指引 + 变更 2026-10-15-knowledge-search-pgvector design.md Phase 4 + deploy/docker-compose.yml 既有镜像。

#### 场景：主路径

- Given e2e-ci workflow 启动 PG service
- When backend 容器执行 `alembic upgrade head`
- Then 20261015200000 迁移内 `CREATE EXTENSION vector` 成功、不再抛「PG vector 扩展不可用」RuntimeError，迁移推进到 head

### FR-02: daemon 11 个失败用例必须修复——turn_phase 上报不得中断会话创建链，测试夹具须与新源码导出面同步

（a）daemon 源码：`reportTurnPhase` 及 onTurnMessage 桥拦截分支的 turn_phase 上报必须兑现 D-009 不变量「上报失败不阻塞主流程」——client 缺方法等同步异常必须被吞掉（仅观测日志），禁止中断 `_startInteractiveSession` 创建链与消息主链路。（b）测试夹具：task-lifecycle 两处 onTurnMessage 过滤断言必须收窄排除 `type==='turn_phase_report'` 合法旁路（同 2026-10-25-trajectory-source-model 对 session_header 的收窄先例）；spec-sync mock 工厂必须以 importOriginal 兜底（新导出零漂移）；client mock 必须补齐 `notifyTurnPhase`。修复后 `session-thinking-level.test.ts`、`task-lifecycle.test.ts`、`daemon-interactive-spec-sync.test.ts` 三文件本地必须全绿。

#### 场景：主路径

- Given 测试的部分 mock client 缺 `notifyTurnPhase` 方法
- When daemon 执行 `_startInteractiveSession`（tar 模式带 workspaceId）
- Then pullSpecBundle 被调用、`_sessionManager.create` 最终被调用，turn_phase 上报失败仅记观测日志不中断创建链

#### 场景：夹具同步

- Given daemon.ts 从 spec-sync.js 导入 7 个导出（含 readLocalSpecVersion/shouldRefreshSpec/bumpLocalSpecVersion）
- When 测试以 vi.mock 工厂替换 spec-sync 模块且源码后续新增导出
- Then heartbeat 等路径访问任意真实导出不抛「No export is defined on the mock」——mock 工厂对新导出零漂移

### FR-03: frontend CI 5 个失败文件必须根因定位并修复——CI 同条件复刻跑必须全绿

`sessions-portal` / `session-history-scroll` / `session-panel-load-earlier-full-turn` / `file-explorer-git-status` / `session-panel-history-race` 五个测试文件在 CI（ubuntu 2 核 + coverage）稳定失败而本地全绿，必须定位 CI 特有触发条件（跨文件泄漏/资源饥饿/环境差异），修复后以 CI 同条件（coverage + 受限线程全量跑）复刻验证全绿，且不得以删断言/删用例方式掩盖。

#### 场景：主路径

- Given 本地以 `--coverage --pool=threads --pool-options.threads.maxThreads=2` 全量复刻 CI 条件
- When 套件跑完
- Then 5 个此前失败文件全部绿、无新增失败

### FR-04: 修复推送后 GitHub Actions 四条 workflow 必须全绿

修复提交推送至 main 后，frontend-ci / daemon-ci / e2e-ci / backend-ci 四条 workflow 必须全部 conclusion=success；backend-ci 若实测为 45 分钟撞顶挂死而非慢跑，须先定位挂起点修复后再收口。

#### 场景：主路径

- Given 修复提交推送 main
- When 四条 workflow 跑完
- Then `gh run list` 最新一轮四条全部 success

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：CI workflow 配置改动，本地无 workflow 执行面；验收=推送后 e2e-ci 实跑转绿（FR-04 场景覆盖）
FR-02: sillyhub-daemon/tests/spec-transport-tar-sync/daemon-interactive-spec-sync.test.ts「B1: tar 模式 _startInteractiveSession 调 pullSpecBundle，且 await 先于 _sessionManager.create」；sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「FR-03 落行：[TASK_STARTED]/[TASK_PROGRESS]/[TASK_NOTIFICATION] flat 行（前缀+单行 JSON task_name 键 + parent_tool_use_id）」；sillyhub-daemon/tests/interactive/session-thinking-level.test.ts「claim payload snake_case thinking_level → CreateSessionInput.thinkingLevel」
FR-03: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「同机器同智能体再次「＋」新建：未发送草稿保留（nonce 强制重挂载后回读，2026-10-23-pre-session-draft-persist / FR-01）」（同批另四文件见 FR-03 正文清单）——验收面=CI 同条件复刻全量跑绿
FR-04: 不适用：CI 实跑验收，本地无该执行面；推送后以 gh run list 核验四条 success 留痕
