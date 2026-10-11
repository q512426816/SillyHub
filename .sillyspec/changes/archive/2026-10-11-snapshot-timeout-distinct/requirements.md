---
author: flow-machine-draft
created_at: 2026-10-11T05:04:48.021Z
---
# 需求规格（Requirements）— 2026-10-11-snapshot-timeout-distinct

## 功能需求

### FR-01: LocalSnapshotResponse 的 status 拆出 daemon_timeout 五态（offline=无 WS 连接/timeout=连接在但 15s 无响应），router 按异常类型精确映射不再 except-All 归 offline

- LocalSnapshotResponse.status **必须**新增 "daemon_timeout" 枚举；router **必须**按异常类型精确映射（DaemonRpcTimeout→timeout / DaemonRuntimeOffline→offline），**禁止** except-All 把超时并入离线；其余意外**必须**落 log.exception 后 offline 兜底。

#### 场景：主路径

- Given daemon WS 在线但 15s 内无响应（如进程未重启跑旧代码）
- When 请求 local-snapshot
- Then 200 且 status=daemon_timeout（非 daemon_offline）- （待撰写：把本条成功标准改写为一句可判定的行为规定并标约束强度——必须/禁止/SHOULD/可以）

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）- 前端 timeout 态**必须**显示重启引导文案（含「守护进程无响应」与「重启进程」）；**禁止**沿用离线文案误导该场景；既有四态文案与行为回归不变；api-types **必须**经 gen:types 再生成含新枚举。

#### 场景：主路径

- Given 快照返回 daemon_timeout
- When 本机现状区渲染
- Then 显示重启引导文案且不出现「守护进程离线」- （待撰写：把本条成功标准改写为一句可判定的行为规定并标约束强度——必须/禁止/SHOULD/可以）

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）- daemon 侧（sillyhub-daemon）**必须**零改动；LocalSnapshotResponse 其余字段与端点路径/权限**禁止**变化（additive）。

#### 场景：主路径

- Given 本变更 diff
- When 审查文件清单
- Then daemon 目录零文件变化- （待撰写：把本条成功标准改写为一句可判定的行为规定并标约束强度——必须/禁止/SHOULD/可以）

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）- 验证**必须**仅跑 backend linked_repos 两测试文件 + frontend 卡片测试 + typecheck/lint；**禁止**全量（留 CI）。

#### 场景：主路径

- Given 修复完成
- When 跑指定测试
- Then backend 30 + frontend 11 全绿

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py「test_local_snapshot_http_timeout_distinct」（DaemonRpcTimeout→daemon_timeout 断言）+「test_local_snapshot_http_offline_still_offline」（回归）
FR-02: frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx「daemon_timeout 显示重启引导文案（非离线文案）」
FR-03: 不适用：daemon 零改动与 additive 由 diff 文件清单守护（提交 d04d4ad48 仅 backend 2 文件+frontend 4 文件+生成物）
FR-04: backend 30 用例+frontend 11 用例+tsc/lint 双零错实跑于 2026-10-11 会话（命令见 design 记录：pytest 两文件/vitest 卡片文件/pnpm typecheck+lint）
