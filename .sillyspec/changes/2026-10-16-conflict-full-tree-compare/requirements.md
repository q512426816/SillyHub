---
author: qinyi
created_at: 2026-10-16 16:55:44
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 工作区成员（只读视角） | 可查看冲突行与对比结果；无操作按钮（沿用现有 canOperate 门控） |
| 机器所有者 / 平台管理员（可操作） | 可对注册表冲突行执行「标记已处理」；后端权限门为 WORKSPACE_WRITE |
| 机器上的 daemon | 被平台通过 `sillyspec_conflict_snapshot` RPC 读取本机冲突记录（本变更不改其协议） |

## 功能需求

### FR-01: 兜底读取 full-tree 记录，让跨变更冲突的对比可用
覆盖决策：D-001@v1, D-009@v1
Given 某冲突在机器上落盘为 `spec-sync-conflict-full-tree.json` 且平台行按单变更名 `<change>` 请求对比
When `kind=spec-tree` 且按 `<change>` 读取记录返回 `conflict_record_missing`，而 `full-tree` 记录存在且含属于 `<change>` 的路径
Then 平台必须（MUST）以 `full-tree` 记录构建该变更范围内的对比并返回 200；兜底**必须只重试一次**（MUST NOT 递归或多次重取）；实现**必须（MUST）不新增 daemon 协议要求**（不新增 RPC、不改既有 RPC 的参数形态）

#### 场景：主路径（兜底命中）
Given full-tree 记录含 `changes/archive/<change>/…` 路径
When 对比请求先失败为 `conflict_record_missing`
Then 返回 200 且 `record_label="full-tree"`；daemon RPC 恰好被调用两次（先 `<change>` 后 `full-tree`）

### FR-02: 对比只呈现所请求变更的范围，并标注来源
覆盖决策：D-006@v2, D-009@v1
Given 兜底命中且 `full-tree` 快照覆盖多个变更的路径
When 生成对比响应
Then 文件清单与 diff **必须（MUST）只包含** `changes/<change>/` 或 `changes/archive/<change>/` 属于该变更的路径（判定输入面**必须（MUST）**为 daemon 快照的 `files[].path`——快照不含 `conflicting_paths` 字段）；响应**必须（MUST）**携带来源元数据（记录名、覆盖的变更名集合、兜底快照返回的路径总数——受 daemon 300 路径帽截断，**禁止（MUST NOT）**声称记录真实总数）；前端在对比弹窗顶部以一行小字提示来源（提示为固定说明行，无关闭控件——MAY 后续另开）

#### 场景：段边界防误吞
Given full-tree 记录只含 `changes/foobar/…` 路径
When 请求 `<change>=foo`
Then 兜底不命中（MUST 返回原 `conflict_record_missing` 错误），不得把 `foobar` 的文件混入对比

### FR-03: 失败文案按真实错误码分支
覆盖决策：D-004@v1, D-005@v1, D-012@v1
承接: FR-lib-api-040
Given 对比请求失败
When 前端渲染失败卡
Then 分支键**必须（MUST）**为 `details.daemon_code`（daemon 业务失败时外层 `ApiError.code` 恒为 `HTTP_502_DAEMON_RPC_REMOTE`，**禁止（MUST NOT）**作分支键）；`details.daemon_code === "conflict_record_missing"` → 文案「该冲突在本机已无快照（可能已随同步清理或已裁决），请重新同步后再试」且**禁止（MUST NOT）**展示「重试」；`workspace_root_unknown` → 「该工作区尚未被本机认领，请先在该工作区发起一次会话后重试」且不展示「重试」；外层 `code ∈ {HTTP_504_DAEMON_RUNTIME_OFFLINE, HTTP_504_DAEMON_RPC_TIMEOUT}` → 「机器离线或响应超时（504），请确认数据源机器在线后重试」并展示「重试」；其余码 → 「读取机器侧冲突快照失败，请稍后重试」并展示「重试」；后端 `conflict_record_missing` 的用户可见 message **必须（MUST）**同为「重新同步」口径（不再出现「刷新冲突列表」）

#### 场景：记录缺失分支
Given 对比返回 502 且 `details.daemon_code="conflict_record_missing"`
When 失败卡渲染
Then 文案为「该冲突在本机已无快照…请重新同步后再试」且页面上**不存在**「重试」按钮与「504」「离线」字样

### FR-04: 冲突行手动关闭入口（标记已处理）
覆盖决策：D-003@v1, D-012@v1
承接: FR-spec-sync-023
Given 可操作者看到一条来自平台注册表的未决冲突行
When 点击行上「标记已处理」并二次确认
Then 前端**必须（MUST）**调 `POST /api/workspaces/{workspace_id}/spec-conflicts/{conflict_id}/resolve`（body `{"status":"resolved"}`），成功后该行从列表消失（invalidate `["platform-sync-section","spec-conflicts",{workspace_id}]`——键**必须（MUST）**与 `QUERY_KEY_ROOT` 实际值一致）；失败**必须（MUST）**给出可读提示；只读视角**禁止（MUST NOT）**见该入口；确认文案**必须（MUST）**写明关闭范围（整条注册表记录——一条记录可含多个变更名，并列展示的兄弟行会一起消失）与「不改本机文件，冲突若仍存在则下次同步会重新登记」；该操作**禁止（MUST NOT）**改动本机文件

#### 场景：关闭后消失与可复现
Given 注册表有 1 条 open 行（含 2 个变更名的并列展示行）
When 可操作者确认「标记已处理」
Then 两行同时从列表消失；若该冲突仍在本机存在，下一次冲突推送**可以（MAY）**重新登记新的 open 行（不视为回归）

### FR-05: 契约与类型同步
覆盖决策：D-008@v1
Given 后端 compare 响应新增可选字段
When 本变更交付
Then `backend/openapi.json`、`frontend/src/lib/api-types.ts`、`sillyhub-daemon/src/api-types.ts` **必须（MUST）**按 gen:types 重新生成并随本变更提交；旧响应字段与旧客户端行为**必须（MUST）**不变

## 非功能需求
- 兼容性：旧 daemon **必须（MUST）**行为不变——兜底只以另一记录名调用既有 RPC；未兜底命中时错误路径与现状完全一致；旧前端忽略新增响应字段；注册表表结构**禁止（MUST NOT）**迁移变更。
- 性能：兜底**应当（SHOULD）**仅在 `conflict_record_missing`（低频）时多一次 RPC 往返；daemon 侧既有上限（300 路径 / 4MB 聚合帽）**必须（MUST）**继续生效。
- 权限：对比沿用现有成员可见性；关闭入口**必须（MUST）**限 WORKSPACE_WRITE 且前端仅 canOperate 可见。
- 安全：兜底记录名与路径过滤**必须（MUST）**在平台侧做纯字符串段边界校验，**禁止（MUST NOT）**把任意路径下发 daemon。
- 可回退：兜底分支**可以（MAY）**整体移除而回到单次 RPC 语义（无 schema/数据迁移依赖，回退只需还原代码）。
- 可测试：兜底命中/未命中/不触发三类分支**必须（MUST）**有单测钉住（含段边界 foo/foobar 陷阱）。

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 兜底修复点在后端；不依赖 daemon 自更新 |
| D-002@v1 | 非目标 | 裁决本轮不修，界面不承诺可裁决 |
| D-003@v1 | FR-04 | 新增「标记已处理」入口（复用 resolve 接口） |
| D-004@v1 | FR-03 | 失败卡按 daemon_code 分支；记录缺失态无「重试」 |
| D-005@v1 | FR-03/FR-05 | 后端 conflict_record_missing 文案改「重新同步」口径 |
| D-006@v2 | FR-02 | 只保留该变更路径（`files[].path` 输入面）+ 来源标注（提示不可关闭） |
| D-007@v2 | 交付物 | 生成真码原型（supersedes v1 跳过判断） |
| D-008@v1 | FR-05/成功标准 | 验收含部署后真机复验 |
| D-009@v1 | FR-01/FR-02 | 选定方案 A（失败即重试）；兜底边界（仅 spec-tree、只一次） |
| D-010@v1 | 非目标 | 落选方案 B（记录名入平台行） |
| D-011@v1 | 非目标 | 落选方案 C（daemon 列记录 RPC） |
| D-012@v1 | FR-03/FR-04 | 交叉审查修订：分支键/失效键/关闭连带范围/保真损失 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
