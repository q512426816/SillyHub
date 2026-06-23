---
author: qinyi
created_at: 2026-06-23 10:38:24
change: 2026-06-23-spec-transport-tar-sync
---

# Requirements: spec 文档回传 backend 独占（transport 双模式）

## 角色

| 角色 | 说明 |
|---|---|
| backend | FastAPI 服务器，spec 真理源（`/data/spec-workspaces/{ws}`），生成 scan/stage prompt，接收 tar 回传，reparse 入库 |
| daemon | 本地守护进程（Node），跑 interactive session（SessionManager→ClaudeSdkDriver），tar 模式下 pull 缓存 + 回传产出 |
| 部署运维 | 通过 `SPEC_TRANSPORT` env 选择 shared（同机）/ tar（异机）拓扑 |

## 功能需求

### FR-01: transport 全局配置开关
覆盖决策：D-001@v1, D-002@v1

Given backend 未设置 `SPEC_TRANSPORT` env
When Settings 加载
Then `spec_transport = "shared"`（默认），现有行为不变

Given `SPEC_TRANSPORT=tar`
When Settings 加载
Then `spec_transport = "tar"`，prompt 与 daemon 同步走 tar 分支

Given `SPEC_TRANSPORT` 为非法值
When Settings 加载
Then `field_validator` 规范化/拒绝（plan 阶段定：报错 or 回退 shared）

### FR-02: shared 模式零改动（向后兼容）
覆盖决策：D-004@v1

Given `transport=shared`
When scan/stage dispatch
Then `build_claim_payload` 透传 spec_root（容器路径），prompt 用宿主路径
`spec_data_host_dir/{ws}`，daemon 走 `translateSpecRoot`，不 pull 不 sync，bind mount 共享

### FR-03: tar 模式 prompt 用 daemon 本地路径
覆盖决策：D-001@v1, D-006@v1

Given `transport=tar`
When `build_scan_bundle` / `start_stage_dispatch` 生成 prompt
Then `--spec-root = ~/.sillyhub/daemon/specs/{ws}`（`resolve_prompt_spec_root` helper）
And `bundle.spec_root` / `platform_metadata.spec_root` 仍为入参容器路径（双轨）

### FR-04: tar 模式 build_claim_payload 透传 workspace_id + transport，不透传 spec_root
覆盖决策：D-007@v1

Given `transport=tar` 且 interactive lease（scan/stage）
When `build_claim_payload`
Then 透传 `transport`/`transportMode` + `workspaceId`/`workspace_id`，**不 set**
`specRoot`/`spec_root`

### FR-05: tar 模式 interactive 路径 spec pull（session 开始）
覆盖决策：D-003@v1, D-007@v1

Given `transport=tar` 且 daemon 收到 interactive lease
When `_startInteractiveSession` 创建 session（driver 启动前）
Then 调 `spec-sync.pullSpecBundle(client, wsId)` 拉 backend spec bundle 解到
`~/.sillyhub/daemon/specs/{ws}`
And 首次 scan backend 无 bundle → `getSpecBundle` 404 → 容错 mkdir 空本地目录（E-01）

### FR-06: tar 模式 interactive 路径 postSpecSync（session 终态）
覆盖决策：D-003@v1, D-004@v1, D-007@v1

Given `transport=tar` 且 scan 所有 step 完成
When `onSessionEnd` 触发（session 终态）
Then 调 `spec-sync.postSpecSync` 打 tar 整树 → `POST /spec-workspace/sync`
And 回传失败仅 warn，不阻塞 session 终态上报（R-03）

### FR-07: backend apply_sync 接收 tar 回传（复用）
覆盖决策：D-003@v1

Given daemon `POST /spec-workspace/sync`（tar）
When `apply_sync(workspace_id, tar_bytes)`
Then 解 tar 覆盖 `/data/{ws}`（保留 `.runtime/`）+ reparse → ScanDocument 入库 +
`sync_status=clean`

### FR-08: 过时测试断言修正
覆盖决策：D-006@v1

Given `test_context_builder.py` 行 142/162
When 重写
Then tar 模式断言 prompt 含 `~/.sillyhub/daemon/specs/{ws}`，shared 模式含宿主路径；
不改 `build_scan_bundle` 双轨代码

## 非功能需求

- **兼容性**：shared 默认，现有同机部署零影响（D-004）；transport 不入库（D-001）
- **可回退**：tar 出问题清空 `SPEC_TRANSPORT` 回退 shared + 重新 scan（D-005 数据可清）
- **可测试**：每个 FR 有 GWT；端到端 `SPEC_TRANSPORT=tar` scan 文件落 backend 可验证
- **复用性**：spec 同步抽共享 utility，batch（`runLease`）行为不变（D-007）

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-03 | transport 正交 strategy，走全局 config 不入库 |
| D-002@v1 | FR-01 | `SPEC_TRANSPORT=shared\|tar` 全局，默认 shared |
| D-003@v1 | FR-05, FR-06, FR-07 | tar 双向同步（pull + sync + apply_sync 接收） |
| D-004@v1 | FR-02, FR-06 | shared 现状不变；tar 一次性回传 |
| D-005@v1 | 非功能-可回退 | 数据可清不迁移 |
| D-006@v1 | FR-03, FR-08 | 双轨 prompt + 过时断言重写 |
| D-007@v1 | FR-04, FR-05, FR-06 | interactive 路径 spec-sync + 共享 utility（X-001 修正） |

无未覆盖的当前版本 D-xxx@vN。
