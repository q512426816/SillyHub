---
author: flow-machine-draft
created_at: 2026-10-21T12:57:03.654Z
---
# 需求规格（Requirements）— 2026-10-21-spec-manifest-incremental

## 功能需求

### FR-01: GET /api/changes/-/spec-manifest?since=<spec_version> 只返回该版本之后变化的清单行，响应含当前 spec_version

- 带 `since`（整数，≥0）查询参数请求清单时，服务端**必须**只返回 `landing_version > since` 的清单行（含软删墓碑行），并**必须**在响应顶层携带当前工作区 `spec_version`（int）；`since ≥ 当前 spec_version` 时 `files` **必须**为空对象；`since` 非整数或为负**必须**被 422 拒绝（Query 校验）。`landing_version` 列**禁止**外露到响应行项。

#### 场景：增量主路径

- Given：workspace 清单基线 spec_version=N，一次落地使部分行变化、spec_version→N+1
- When：`GET /api/changes/-/spec-manifest?since=N`（shpsync_ token）
- Then：200，`files` 恰为本次落地涉及行（新行/更新行/软删墓碑行均在），`spec_version == N+1`，未涉及行不出现在 `files`

#### 场景：无变化重复拉取

- Given：客户端已按 spec_version=N 消费过增量，期间无任何落地
- When：`GET ?since=N`
- Then：200，`files == {}`，`spec_version == N`

#### 场景：存量 NULL 行不进增量流

- Given：迁移前已存在的清单行（landing_version=NULL）未被再次写入
- When：`GET ?since=0`
- Then：这些行不出现在 `files`（SQL NULL 比较即排除）；该行一旦被任何落地触碰即进入增量流

### FR-02: 无 since 参数时行为与现状一致（响应仅新增 spec_version 字段，向后兼容）

- 无 `since` 参数请求清单时，服务端**必须**返回该 workspace 全部清单行（含 `exists=false` 软删行，现状语义不变），行项形状保持 `{hash, version, exists}` 不变；响应**仅**新增顶层 `spec_version` 字段（既有 CLI 忽略未知字段，不受影响）。

#### 场景：旧客户端全量拉取回归

- Given：workspace 同时有活跃行与墓碑行
- When：`GET /api/changes/-/spec-manifest`（不带 since）
- Then：`files` 覆盖全部行且逐行形状与变更前一致，顶层多出 `spec_version`

### FR-03: apply_ops 落地/软删的清单行携带可游标过滤的版本印记

- `spec_file_manifest` **必须**新增 `landing_version` 列（Integer 可 NULL，语义=行最后写入时的工作区 spec_version）；全部清单写点——`apply_ops`（add/update/delete/rename 各分支）、`_write_spec_root` 后的清单逐行对齐、`soft_delete_change_dir`、`heal_manifest_tombstones`（评审 P2-1 补齐）——**必须**在与 bump spec_version 同一事务内把受影响行盖章为递增后的 spec_version；既有不变量「manifest 行版本变化 ⇒ spec_version 递增」**必须**保持。rename 旧行**必须**由硬删改为软删墓碑（exists=false、version+1、盖章），保证增量消费方经 since 游标可见旧路径消亡——清单行**禁止**从表中物理消失（workspace 级联删除除外）。

#### 场景：apply_ops 三类 op 后增量恰含变化行

- Given：清单基线 spec_version=N
- When：一次含 add+update+delete 的成功 apply_ops（spec_version→N+1）
- Then：`GET ?since=N` 的 files 恰含这三个 path 的行

#### 场景：rename 后增量取到双侧行

- Given：path A 活跃行 v5，rename A→B 推送成功（旧行原为硬删）
- When：`GET ?since=<落地前 spec_version>`
- Then：files 含 A（exists=false，version=6）与 B（exists=true）两行；库中无 path=A 活跃行

#### 场景：change_dir 平台软删后行可见

- Given：changes/<name>/ 下有活跃清单行
- When：平台删除变更目录（soft_delete_change_dir）
- Then：这些行 exists=false 且带新印章，`GET ?since=<旧值>` 可取到

### FR-04: 既有相关测试全绿，新增用例覆盖增量/全量/软删/边界

- 新增用例**必须**覆盖：增量主路径、无变化空响应、NULL 行排除、全量回归（含 spec_version 字段）、apply_ops 后增量可见、rename 墓碑可见、since 非法值 422；spec_workspace / platform_sync 两模块既有测试**必须**全绿（rename 行为变化波及面内若有断言硬删的用例，按新语义修正断言而非绕过）。

#### 场景：回归与新增并存

- Given：本变更代码落库
- When：跑 backend spec_workspace + platform_sync 模块测试
- Then：既有用例零回归，新增用例全部通过

### FR-05: 稳态清单请求 <1s（配 CLI 侧缓存后达成，本变更提供服务端能力）

- 增量响应**必须**只含变化行（响应体积与工作区历史总量无关，随单次落地行数线性），使配 CLI 侧缓存后稳态请求 <1s 可达；服务端**必须**为增量路径提供 `(workspace_id, landing_version)` 索引支撑过滤查询。

#### 场景：响应体积与历史解耦

- Given：工作区清单 1.3 万行、单次落地仅 3 行变化
- When：`GET ?since=N`
- Then：files 仅 3 行（约数百字节），非全量 2.2MB

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/platform_sync/tests/test_spec_sync.py「增量主路径 / 无变化空响应 / NULL 行不进增量 / since 非法 422」
FR-02: backend/app/modules/platform_sync/tests/test_spec_sync.py「全量回归含 spec_version 字段」
FR-03: backend/app/modules/platform_sync/tests/test_spec_sync.py「apply_ops 后增量恰含变化行 / rename 增量含旧路径墓碑」+ backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py「软删行带印章」（追加断言）+ backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py「heal 行带印章且增量可见」（追加断言）
FR-04: backend/app/modules/platform_sync/tests/ + backend/app/modules/spec_workspace/tests/ 全模块回归（含 rename 语义修正断言）
FR-05: 不适用：性能面由 FR-01 语义结构性保证（响应只含变化行），端到端实测归 CLI 侧消费变更（sillyspec 仓）落地后验证
