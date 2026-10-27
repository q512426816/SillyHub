---
author: flow-machine-draft
created_at: 2026-10-27T04:54:27.044Z
---
# 需求规格（Requirements）— 2026-10-27-sessions-total-and-status-filter

## 功能需求

### FR-01: 会话列表统计显示服务端真实总数（total），不再被 500 拉取上限截断

- 手机端会话列表统计行必须显示服务端口径的真实总数（= 各状态计数之和，如 515），禁止以单次拉取条数（≤500）冒充总数。

#### 场景：总数超过拉取上限

- Given 本工作区未归档会话共 515 条（前端单次拉取上限 500）
- When 用户打开手机端会话列表
- Then 统计行显示「会话总数 515 条」，列表默认只渲染最新 10 条 + 在线全显（FR-03），不受 500 截断影响

### FR-02: 状态筛选统一为四档：全部/在线（原运行中·活跃）/已结束/失败，各档带真实计数（服务端口径）

- 手机端状态筛选必须为四档 chips：全部（计数=五态之和）/ 在线（pending+active+reconnecting 之和）/ 已结束（ended）/ 失败（failed），计数必须来自服务端 status_counts，禁止用客户端拉回样本估算；PC 端状态下拉「活跃」档必须同步更名为「在线」并把查询口径从单值 active 扩为在线三态（status_group=ongoing）。

#### 场景：chips 计数不受当前档位影响

- Given 服务端 status_counts 返回 pending 1 / active 2 / reconnecting 0 / ended 496 / failed 4（总 503）
- When 用户切到「已结束」档
- Then 四个 chips 计数保持 全部 503 / 在线 3 / 已结束 496 / 失败 4，列表只显示 ended 条目

#### 场景：在线档过滤为三态聚合

- Given 存在 status 分别为 pending / active / reconnecting 的三条会话
- When 用户切「在线」档
- Then 三条全部显示（后端 status_group=ongoing 一次查询命中三态）

### FR-03: 手机端默认只展示最新 10 条会话，且所有在线会话不限 10 条全部展示

- 手机端列表默认必须只渲染「最新 10 条 ∪ 全部在线会话」（按服务端返回序），超出部分必须提供「显示全部 N 条」展开入口；PC 端分组内截断规则同步为同口径（默认 10 + 在线全显 + 显示全部）。

#### 场景：在线会话超出默认条数

- Given 最新 20 条会话中有 15 条在线、5 条已结束
- When 用户打开列表（全部档）
- Then 15 条在线全部显示（不受 10 条限制），「显示全部」入口显示完整条数

### FR-04: 后端 list_sessions 响应附 status_counts 分状态计数（与 total 同口径），前端与 daemon 类型同步再生成

- GET /api/daemon/sessions 响应必须新增 status_counts（五态计数 dict，口径 = 除 status/status_group 外其余过滤参相同、忽略状态维度的分组计数）；必须新增可选过滤参 status_group=ongoing（在线三态聚合，与 status 互斥，同传 422）；前端 api-types.ts 与 sillyhub-daemon api-types.ts 必须在同一变更内再生成并提交。

#### 场景：status 与 status_group 互斥

- Given 请求同时携带 status=active 与 status_group=ongoing
- When 调用端点
- Then 返回 422（中文文案），不执行查询

### FR-05: 触及 src/test 的改动相关单测通过且 lint 无新增错误

- 本变更触及的 backend / frontend 相关既有单测必须通过（不改测试迁就实现），前端触及文件 lint 必须无新增错误；禁止跑全量测试（留给 CI）。

#### 场景：主路径

- Given 本变更改动了 list_sessions 端点与两个列表组件
- When 只跑相关测试文件（backend session 列表测试 + 两个组件测试）
- Then 全部通过且无 lint 新增错误

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/daemon/tests/test_session_history.py「status_counts 五态之和 = 真实总数（>limit 拉取上限场景）」
FR-02: backend/app/modules/daemon/tests/test_session_history.py「status_group=ongoing 三态命中 + status 与 status_group 同传 422」；frontend/src/components/mobile/mobile-session-list.test.tsx「四 chips 渲染服务端计数且切档计数不漂移」
FR-03: frontend/src/components/mobile/mobile-session-list.test.tsx「默认 10 条 + 在线全显 + 显示全部展开」
FR-04: backend/app/modules/daemon/tests/test_session_history.py「响应含 status_counts 字段（openapi 面随 openapi.json 再生成提交覆盖）」；frontend/src/components/mobile/mobile-session-list.test.tsx「消费再生成类型渲染统计行」
FR-05: 不适用：过程性约束（相关测试清单即上述绑定，收口实测对账）
