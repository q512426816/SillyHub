---
schema_version: 1
doc_type: plan
change_name: 2026-08-19-runtime-live-daemon-read
author: qinyi
created_at: 2026-08-19T06:35:00+00:00
plan_level: high
---

# 实现计划：运行时状态页面实时化改造

## 决策引用

本计划依据 `decisions.md` 中的以下决策制定：

- [D-001@v1](decisions.md#d-001v1)：daemon 离线/失败不回退平台快照。
- [D-002@v1](decisions.md#d-002v1)：进度经 sillyspec CLI 只读 JSON 命令读取。
- [D-003@v1](decisions.md#d-003v1)：三类数据全部实时读 daemon。
- [D-004@v1](decisions.md#d-004v1)：鉴权复用 `MemberBindingResolver` 用户门控绑定解析。
- [D-005@v1](decisions.md#d-005v1)：daemon 侧新增独立 `runtime.*` RPC 命名空间。

## 计划总览

- **plan_level**: high
- **Wave 数**: 17（每个 Task 独占一个 Wave，避免同 Wave 并行修改同一文件导致子代理覆盖）
- **关键路径**: Wave 1→2→3（sillyspec 命令） → Wave 4→5→6→7→8（backend） → Wave 9→10→11→12（daemon） → Wave 13→14（frontend） → Wave 15→16→17（类型同步/验收/跨仓协调）。
- **测试策略**: 每个 Wave 内「写测试 → 写实现 → 跑测试」；Wave 16 做跨端集成验收。

## Wave 1：sillyspec 注册 progress dump 命令

- [x] task-01: sillyspec 注册 progress dump 命令

## Wave 2：实现 ProgressManager.dump 只读查询

- [x] task-02: 实现 ProgressManager.dump 只读查询

## Wave 3：progress dump JSON envelope 输出与测试

- [x] task-03: progress dump JSON envelope 输出与测试

## Wave 4：新建 RuntimeLiveService

- [x] task-04: 新建 RuntimeLiveService

## Wave 5：新增 Runtime 错误子类

- [x] task-05: 新增 Runtime 错误子类

## Wave 6：改造 runtime router 端点

- [x] task-06: 改造 runtime router 端点

## Wave 7：删除原快照读取路径

- [x] task-07: 删除原快照读取路径

## Wave 8：后端 runtime 测试改写

- [x] task-08: 后端 runtime 测试改写

## Wave 9：daemon 注册 runtime RPC

- [x] task-09: daemon 注册 runtime RPC

## Wave 10：新建 daemon runtime handler

- [x] task-10: 新建 daemon runtime handler

## Wave 11：handler 内调用 sillyspec 与文件读取

- [x] task-11: handler 内调用 sillyspec 与文件读取

## Wave 12：daemon runtime handler 测试

- [x] task-12: daemon runtime handler 测试

## Wave 13：更新 RuntimePage 文案与错误提示

- [x] task-13: 更新 RuntimePage 文案与错误提示

## Wave 14：更新前端 runtime 测试

- [x] task-14: 更新前端 runtime 测试

## Wave 15：同步 OpenAPI 类型

- [x] task-15: 同步 OpenAPI 类型

## Wave 16：全量测试与 lint 验收

- [x] task-16: 全量测试与 lint 验收

## Wave 17：sillyspec 仓发版协调

- [x] task-17: sillyspec 仓发版协调

## 关键实现点

- `RuntimeLiveService` 复用 explorer 的 `_send_explorer_rpc` 模式，但 method 改为 `runtime.read_progress` 等。
- 错误映射函数把 `DaemonRpcRemoteError` 的 code 转换为 `Runtime*` 子类。
- `runtime.read_artifact` 的 filename 在 backend 层也做 `..`/绝对路径预检。
- `specCacheRoot` 从 daemon 配置/缓存目录推导，与 `spec-sync.ts` 的 `resolveSpecDir()` 保持一致。
- sillyspec 子进程调用使用 `execFile` 非 shell，timeout 30s；旧版 sillyspec 命令不存在时返回结构化错误（`method_not_found`）。
- `read_artifact` 对 filename 做 `..`/绝对路径/控制字符拒绝。

## 测试策略

- **backend**：
  - 单元测试：`RuntimeLiveService` mock `ws_hub.send_rpc` 覆盖成功/失败/绑定缺失。
  - 集成测试：`test_router.py` 用 fake daemon RPC 验证端点返回与错误码。
  - 不再写本地 `sillyspec.db` 快照文件。
- **sillyhub-daemon**：
  - `runtime-handler.test.ts` 用 mock spawn 和 mock fs 覆盖 4 个方法。
  - 真实 sillyspec 命令测试可选（依赖 CLI 安装），以 mock 为主。
- **frontend**：
  - vitest 页面测试覆盖标题文案、错误提示渲染。
- **sillyspec 跨仓**：
  - 新增命令的 stdout JSON schema 测试；用临时目录创建 `sillyspec.db` 测 dump 输出。

## 风险与回退

- **R-01 跨仓发版不同步**：实现时 daemon 捕获 `ENOENT` / `method_not_found`，返回 422 引导升级。
- **R-04 大产物超时**：实现时严格 1MB 限制 + 30s timeout；超大产物引导用户用文件浏览器。
- **实现回退**：如 Wave 3 遇到 daemon 侧不可行问题，可临时保留 backend 原 `RuntimeService` 但默认走 daemon，作为逃生口（需用户明确决策，本次设计已选定不回退）。

## 完成定义（Wave 16 验收）

- `/api/workspaces/{id}/runtime` 在 daemon 在线且绑定时返回实时数据。
- 无绑定 → 404；daemon 离线 → 502；旧 daemon → 422；大产物超限 → 413/504。
- 页面标题/副标题不再含「本地运行态 / 不作为长期事实源」。
- backend runtime 测试不再依赖本地快照文件。
- sillyspec `progress dump --json` 命令可用且测试通过。
- 全量 lint/typecheck/test 干净。
