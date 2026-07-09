---
author: WhaleFall
created_at: 2026-07-09T09:30:00
---

# decisions.md — 2026-07-09-remote-folder-picker 决策台账

> 本文件是本次变更的决策台账（非长期术语表）。只记录有实现/验收影响的决策。
> Grill 阶段（brainstorm Step 7）产生，design.md §11 引用。

---

## D-001@v1: roots ≠ allowed_roots 术语分离

- **type**: term
- **status**: accepted
- **source**: code（`router.py:566` PUT allowed-roots vs `daemon.ts:2100` list_dir）
- **question**: "roots"（磁盘根锚点）与 "allowed_roots"（可写目录白名单）是否同一概念？命名易混。
- **answer**: 两者分离。`roots` = daemon 主机磁盘根（Win 盘符 / Unix `/`），供目录浏览器作根锚点，**只读浏览**。`allowed_roots` = runtime 可写目录沙箱白名单，**写入受其限制**。新 RPC 命名 `list_roots`（浏览根），与 `list_dir`（浏览子项）同线、与 `allowed_roots`（写白名单）语义正交。
- **normalized_requirement**: `list_roots` 返回 `{roots: string[]}`；PUT `/allowed-roots` 接收 `{allowed_roots: string[]}`；两者字段名/语义不混用。
- **impacts**: [design §7.1/§7.2, FR-roots, task-W1 list_roots RPC, task-W2 schema]
- **evidence**: `router.py:566`（allowed-roots 写）、`daemon.ts:2100`（list_dir 浏览放开，ql-20260706-006）、brainstorm Step 7
- **priority**: P1

---

## D-002@v1: list_roots 放开全盘只读，沿用 ownership check

- **type**: boundary / risk
- **status**: accepted
- **source**: code（`router.py:1338` `_get_owned_runtime`）
- **question**: 全盘放开浏览（Win 所有盘符 / Unix `/`）是否存在信息泄漏？是否需收紧到 admin 或 allowed_roots 内？
- **answer**: 放开全盘只读。代码核验 `list_dir` 端点有 `_get_owned_runtime(runtime_id, user.id)` ownership 校验（非 owner→404），用户只能浏览**自己拥有的 daemon** 主机全盘，非任意主机。这是合理安全模型（你的 daemon 你负责）。`list_roots` 沿用同一 ownership check，不额外收紧。写入仍受 allowed_roots 限制（只读浏览不影响写沙箱）。
- **normalized_requirement**: `POST /list-roots` 端点用 `get_current_principal` + `_get_owned_runtime`，与 `list_dir` 一致；不引入 RuntimeAdminUser 限定（本次非权限重构）。
- **impacts**: [design §7.2/§10 R-02, task-W2 端点, verify ownership 测试]
- **evidence**: `router.py:1329/1338`、brainstorm Step 7
- **priority**: P1

---

## D-003@v1: 手动输入路径须探 list_dir 校验

- **type**: boundary
- **status**: accepted
- **source**: ai（架构师内联决议）
- **question**: 地址栏手动输入一个不存在 / 非目录的路径，直接让用户选中保存？
- **answer**: 否。跳转/确认前探一次 `listDir(runtimeId, path)`，`not_found`（RpcError）→ 提示"路径不存在或非目录"并禁用「选择此目录」。禁止把不存在的路径回传 `onPick`。
- **normalized_requirement**: RemoteFolderPicker 跳转与 onPick 前校验路径存在且是目录；校验失败不回调、不填值。
- **impacts**: [design §7.3/§10 R-04, task-W3 组件, verify 手输校验测试]
- **evidence**: `file-rpc.ts:151`（非目录→not_found）、brainstorm Step 7
- **priority**: P1

---

## D-004@v1: daemon 离线/超时 → UI 降级不崩溃

- **type**: boundary
- **status**: accepted
- **source**: code（`router.py:1349-1370` 错误映射）
- **question**: daemon 离线或 RPC 超时时，浏览器组件如何表现？
- **answer**: 降级提示，不崩溃。backend 已有 `DaemonRuntimeOffline→504` / `DaemonRpcTimeout→504` / forbidden→403 映射（list_dir 端点既有，list-roots 照抄）。组件 catch `ApiError` → 顶部红色提示条"守护进程离线或响应超时"。地址栏手输保留（用户可直接输路径，跳转探 list_dir 时再报错）。
- **normalized_requirement**: RemoteFolderPicker 对 listRoots/listDir 调用 try/catch；失败显示错误条而非抛白屏；不阻断地址栏输入。
- **impacts**: [design §7.3/§10 R-03, task-W3 组件, verify 离线降级测试]
- **evidence**: `router.py:1349-1370`、`lib/daemon.ts` ApiError、brainstorm Step 7
- **priority**: P1

---

## D-005@v1: 配置刷新复用 WS policy_update + 心跳兜底，不新增刷新通道

- **type**: architecture / compatibility
- **status**: accepted
- **source**: code（`router.py:625` send_policy_update / `daemon.ts:1904` _handlePolicyUpdate）
- **question**: "目录保存后触发 Runtime 配置刷新立即生效"——是否需要新增刷新机制？
- **answer**: 不新增。复用既有 `PUT /runtimes/{id}/allowed-roots`（`router.py:566`）→ WS `policy_update` 推送（`router.py:625`）→ daemon `_handlePolicyUpdate`（`daemon.ts:1904`）即写 PolicyCache。daemon 在线时秒级生效；daemon 离线时 PUT 不阻断，下次心跳响应时 daemon 经 `_syncAllowedRoots`（`daemon.ts:1820`）重新拉取 allowed_roots 同步（既有心跳机制，**非本变更 design §10 的 R-07**——后者指删除 browse_folder 的测试残留清理）。best-effort 语义，design 明示。
- **normalized_requirement**: 可写目录保存仍走 PUT allowed-roots；本变更不新增刷新端点/事件；verify 验证保存后 daemon PolicyCache 更新（在线）。
- **impacts**: [design §1/§5/§9, verify 即时生效测试]
- **evidence**: `router.py:566/625`、`daemon.ts:1904/1920`、brainstorm Step 7
- **priority**: P1

---

## D-006@v1: 不做新建文件夹；不收紧权限；browse_folder 彻底删除

- **type**: boundary / scope
- **status**: accepted
- **source**: user（对话式探索 Step 6 确认）+ ai（YAGNI）
- **question**: ① 组件是否需要"新建文件夹"？② 是否收紧 list_dir/list_roots 权限？③ browse_folder 旧弹窗链路如何处理？
- **answer**:
  ① 不需要。组件纯浏览+选择，需求只提"选择"（YAGNI）；daemon 无需新增 mkdir 写能力，安全面更小。
  ② 不收紧。本次是 UI 替换 + API 增补，非权限重构（见 D-002）。
  ③ 彻底删除三端代码（daemon handler `daemon.ts:2114` + backend 端点 `router.py:1411` + 内联 schema `router.py:1398/1404` + frontend `lib/daemon.ts:259` `browseFolder()` + `page.tsx:714` `handleBrowseNative` + UI 入口）。项目未上线无需兼容（CLAUDE.md 规则 10）。
- **normalized_requirement**: 组件无 mkdir；权限模型不变；grep 三端 `browse_folder`/`browseFolder`/`BrowseFolder` 为空。
- **impacts**: [design §3/§6/§9/§10 R-07, task-W1/W2/W3 删除项, verify grep 清理]
- **evidence**: brainstorm Step 6 用户答复、CLAUDE.md 规则 10
- **priority**: P1

---

## D-007@v1: 读（浏览）vs 写（保存）权限分层——沿用既有端点，本次不改

- **type**: boundary
- **status**: accepted
- **source**: code（Design Grill X2 发现）+ design-grill
- **question**: RemoteFolderPicker 的「浏览」与「保存可写目录」权限层级是否一致？design D-002/R-02 早期描述把读/写混为同一 ownership 模型，是否误导？
- **answer**: 不一致，且是**既有现状**，本次不改变任一端点权限：
  - **读（浏览）**：`list_roots` / `list_dir` 用 `get_current_principal` + `_get_owned_runtime`（`router.py:1329/1338`），普通 owner 即可浏览自己 daemon 主机全盘。
  - **写（保存 allowed_roots）**：`PUT /runtimes/{id}/allowed-roots` 用 `RuntimeAdminUser`（`router.py:574`），admin 限定（`require_permission_any(Permission.RUNTIME_ADMIN)`，`router.py:264`）。
  - 两层不同：非 admin 用户可浏览（owner），但保存收 403（既有 PUT 行为）。组件本身不鉴权（鉴权在各端点），故 RemoteFolderPicker 对 owner 可打开，保存是否成功取决于调用方 PUT 的权限。
- **normalized_requirement**: `list_roots` 端点用 `get_current_principal`（与 list_dir 一致），**不**引入 `RuntimeAdminUser`；`PUT /allowed-roots` 权限不动；组件不内置鉴权。design §10 R-02 已据此修正读/写分层表述。
- **impacts**: [design §10 R-02, task-W2 list_roots 端点（确认非 admin）, verify（owner 可浏览 + 非 admin 保存 403 既有行为不回归）]
- **evidence**: `router.py:574/264`（PUT 用 RuntimeAdminUser）、`router.py:1329/1338`（list_dir owner 校验）、Design Grill X2
- **priority**: P1
