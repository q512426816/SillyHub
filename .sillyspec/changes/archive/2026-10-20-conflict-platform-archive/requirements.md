---
author: flow-machine-draft
created_at: 2026-10-20T00:16:49.178Z
---
# 需求规格（Requirements）— 2026-10-20-conflict-platform-archive

## 角色

| 角色 | 说明 |
|---|---|
| 机器上的 daemon / CLI | 推送增量 ops（被拒 op 携带机器侧内容）；本变更不改其协议与负载 |
| 平台后端 | 在冲突推送时留档被拒 op 的机器侧内容；对比端点在机器记录缺失时以留档自足回退 |
| 工作区成员 | 在对比弹窗看到「平台留档快照」来源横幅（沿用现有 canOperate 门控，无新操作面） |

## 功能需求

### FR-01: 冲突推送（base_version 乐观锁冲突/墓碑拦截/rename 目标占用六类被拒点）时，被拒 op 的机器侧内容蒸馏留档进 open 行 details_json.local_archive（单文件文本 32K 字符帽截断留标记、总量 512KB 帽超出停存内容仅留路径清单、300 文件帽），推送主流程零新增 RPC 且留档失败不阻断

平台后端在 apply_ops 的每一类被拒点（乐观锁冲突 / 平台删除目录前缀拦截 add+update / 墓碑行 add 拦截 / 墓碑行 update 拦截 / rename 目标命中删除前缀 / rename 目标墓碑 / rename 目标被占用）必须（MUST）把被拒 op 收集并蒸馏为机器侧档案条目 `{path, missing, content, binary, truncated, mtime}`（add/update 按内容蒸馏：base64 解码后 utf8 可解码则存文本、不可解码置 binary；delete 类被拒点 missing=true；rename 以 new_path 为机器侧路径），并经 `_upsert_sync_conflict` 写入 open 行 `details_json.local_archive`。尺寸帽必须（MUST）三重生效：单文件文本超过 32000 字符截断并置 `truncated: true`；留档条目序列化总量超过 512KB 后停止附加 content（后续条目仅保留路径与 missing 标记）；条目数最多 300。推送主流程必须（MUST）零新增 RPC；留档蒸馏与写入必须（MUST）随既有 upsert best-effort 语义（失败仅告警 `sync_conflict_registry_failed`，不阻断推送响应）。每次冲突推送必须（MUST）整体替换 local_archive（与 details_json 既有整体替换语义一致）。

#### 场景：乐观锁冲突的 add/update 留档内容

Given 清单行 version=2，daemon 推 add/update base_version=1 且 hash 不符（冲突被拒）
When apply_ops 处理该 op
Then open 行 `local_archive` 含条目 `{path, missing: false, content: <解码后文本>, binary: false, truncated: false, mtime: <op.mtime>}`

#### 场景：delete 冲突留档为缺失

Given 清单行 version=2，daemon 推 delete base_version=1（冲突被拒）
Then 条目为 `{path, missing: true, content: null}`——机器侧状态是「已删除」

#### 场景：非 utf8 内容置 binary 不存文本

Given 被拒 add 的 content 解码后非 utf8
Then 条目 `{path, binary: true, content: null, missing: false}`

#### 场景：三重帽逐级降级

Given 单文件解码后 40000 字符 → 截断至 32000 且 truncated=true；Given 留档累计序列化超 512KB → 后续条目 content 置 null（路径与 missing 保留）；Given 被拒 op 超 300 条 → 只留前 300 条

### FR-02: 对比端点在 daemon 返回 conflict_record_missing 且行内 local_archive 覆盖所请求变更路径时，以留档构造对比响应（record_label=platform-archive、covered_changes/path_total 同口径裁剪），平台侧仍实时读 spec_root——记录亡后对比不再 502

对比端点（kind=spec-tree）在 `_fetch_snapshot` 抛出的网关错误 `daemon_code == "conflict_record_missing"` 时必须（MUST）查询该 workspace 的 open spec-sync 冲突行；`details_json.local_archive` 存在且含属于所请求变更（`changes/<change>/` 或 `changes/archive/<change>/` 段边界，防前缀误吞）的路径时，必须（MUST）以留档条目作为机器侧快照构造对比响应并返回 200：`record_label` 必须（MUST）为 `"platform-archive"`，`covered_changes`/`path_total` 按 `_scope_snapshot_to_change` 既有口径从留档全量路径计算；平台侧文件必须（MUST）仍实时读 spec_root（机器侧=冲突时点留档，平台侧=当前内容）。

#### 场景：记录双缺 + 留档覆盖（主路径）

Given 机器上 `<change>` 记录与 `full-tree` 记录双缺（conflict_record_missing），open 行 local_archive 含 `changes/<change>/design.md`
When 请求该变更对比
Then 返回 200，`record_label="platform-archive"`，文件清单只含该变更路径，diff 为留档内容 vs 平台当前内容

#### 场景：留档条目为 missing（机器侧已删）

Given 留档条目 `{path: changes/<change>/x.md, missing: true}`，平台侧该文件存在
Then 该文件分类为 `platform_only`（与 daemon 快照 missing 条目同语义）

### FR-03: 无留档或留档不含所请求变更路径时，错误路径与现状逐字节一致（四臂文案不变）

对比回退必须（MUST）仅在 `daemon_code == "conflict_record_missing"` 且留档命中所请求变更路径时生效；无 open 行、details_json 无 local_archive、留档不含该变更路径、或留档解析失败时，必须（MUST）重抛原网关错误（文案与 details 与现状一致）；非 conflict_record_missing 的错误（含 workspace_root_unknown / 504 家族）禁止（MUST NOT）触发回退。

#### 场景：留档不含所请求变更

Given open 行 local_archive 只含 `changes/foobar/…` 路径，请求 `<change>=foo`
Then 重抛原 conflict_record_missing 网关错误，不把 foobar 路径混入对比

#### 场景：损坏的 details_json

Given open 行 details_json 非法 JSON 或 local_archive 非法结构
Then 按无留档处理重抛原错误（fail-soft，不 500）

### FR-04: 前端对比弹窗对 record_label=platform-archive 显示留档来源横幅（平台留档快照·冲突时点机器侧内容 vs 平台当前内容）

对比弹窗（spec-tree 模式）在 `record_label === "platform-archive"` 时必须（MUST）在顶部显示一行固定来源横幅（说明行、无关闭控件），文案必须（MUST）传达「本机冲突记录已不存在，机器侧为冲突时点平台留档、平台侧为当前内容」；其余 record_label 取值（null / 变更名 / full-tree）的展示行为必须（MUST）保持现状不变。

#### 场景：留档横幅与 full-tree 横幅互斥呈现

Given 响应 record_label="platform-archive"
Then 弹窗顶部出现留档横幅且 full-tree 横幅不出现（record_label 单值互斥）

### FR-05: 既有对比/增量同步/墓碑守卫测试零回归，新增后端留档构建+回退与前端横幅测试

本变更必须（MUST）新增测试覆盖：后端六类被拒点的留档条目形态与三重帽（FR-01）、对比回退命中/不命中/非 missing 错误不回退（FR-02/FR-03）、前端留档横幅呈现（FR-04）；既有 `test_sillyspec_compare` / `test_sync_incremental` / `test_platform_deleted_guard` / `conflict-compare-modal` 套件必须（MUST）零回归。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/spec_workspace/tests/test_conflict_local_archive.py「六类被拒点留档形态与三重帽」
FR-02: backend/app/modules/daemon/tests/test_sillyspec_compare.py「platform-archive 回退命中构造」
FR-03: backend/app/modules/daemon/tests/test_sillyspec_compare.py「无留档/不含变更路径/非 missing 错误不回退」
FR-04: frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx「platform-archive 留档横幅」
FR-05: backend/app/modules/daemon/tests/test_sillyspec_compare.py + backend/app/modules/spec_workspace/tests/test_sync_incremental.py + backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py + frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx「既有套件零回归」
