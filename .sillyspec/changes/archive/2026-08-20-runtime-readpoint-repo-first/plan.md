---
plan_level: full
author: qinyi
created_at: 2026-08-20T10:40:00+08:00
---

# 实现计划（Plan）：运行时状态读点修正（仓库优先，缓存回退）

## Spike 前置验证

不需要。技术方案在诊断阶段已逐点实测验证（progress dump 对仓库 .sillyspec 可用、assertWithinAllowedRoots 先例、allowed_roots 覆盖仓库路径、老 daemon 参数忽略兼容）。

## Wave 1（并行，无依赖）

- [ ] task-01: daemon `runtime-handler.ts` 读点选择——新增 `pickRuntimeSpecDir`（元字符黑名单 → assertWithinAllowedRoots → `.runtime` 存在性三道校验，全过用 `<root>/.sillyspec`，任一不过记日志回退缓存；workspace_id 非法仍 forbidden），构造参数扩 `rootsProvider` 与 `pathExists`，四个方法接入；`runtime-handler.test.ts` 补六类用例（仓库优先 / 元字符回退 / 越界回退 / `.runtime` 不存在回退 / 无 root_path 回归 / 非法 workspace_id 回归）（覆盖：FR-01, FR-02, FR-04, D-01@v1）
- [ ] task-02: backend `runtime/service.py` `_resolve_binding` 返回 `(daemon_id, root_path)`，四个服务方法 params 加 `root_path: resolve_root_path_for_daemon(binding.root_path)`；`test_live_service.py` 补 params 断言（含容器前缀改写生效）与无 binding 404 回归；同步修 `test_router.py:152` 精确 params 断言（加 root_path 后必失败，连带测试归属）（覆盖：FR-01, D-02@v1, D-03@v1）
- [ ] task-03: frontend `runtime/page.tsx` user-inputs 超 50000 字符渲染末段 + 含文件路径的截断提示，副标题改「优先本机仓库，回退同步缓存」；`page.test.tsx` 补截断与文案用例（覆盖：FR-05）

## Wave 2（依赖 Wave 1）

- [ ] task-04: daemon `daemon.ts` 接线——`_registerRuntimeRpcHandler` 透传 `params.root_path`（非字符串归一 undefined），类字段构造点（daemon.ts:784）注入 `rootsProvider: () => this._effectiveAllowedRoots()`；补注册器级 root_path 归一透传用例（非字符串→undefined）；typecheck 通过（依赖：task-01）（覆盖：FR-01）
- [ ] task-05: `.sillyspec/local.yaml` modules 块补 `runtime` 子模块条目（`backend/app/modules/runtime/` → pytest 路径），防 verify 对账 fallback backend 全量被预存错误阻断（先例：2026-08-01 / 2026-08-08 / 2026-08-10 三次同型补全）（依赖：task-02）

## Wave 3（依赖全部）

- [ ] task-06: 端到端验收——本机 Docker 环境重建 backend/daemon 镜像后，b97f8231 工作区 runtime 页显示仓库真实进度（AC-01）；三端测试全绿（AC-04：backend runtime+workspace 模块 pytest、daemon vitest 按 local.yaml flaky 规避方案、frontend vitest + tsc）（依赖：task-01~05）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | daemon 读点选择 + 单测 | W1 | P0 | — | FR-01/02/04, D-01@v1 | 核心：三道校验与回退语义 |
| task-02 | backend params 加 root_path + 单测 | W1 | P0 | — | FR-01, D-02@v1, D-03@v1 | 复用 resolve_root_path_for_daemon；含 test_router.py 连带修复 |
| task-03 | frontend 截断 + 文案 + 单测 | W1 | P1 | — | FR-05 | 尾部截断含文件路径提示 |
| task-04 | daemon.ts 接线 | W2 | P0 | task-01 | FR-01 | 透传 + rootsProvider 注入 |
| task-05 | local.yaml 补 runtime 模块映射 | W2 | P1 | task-02 | — | verify 对账基础设施 |
| task-06 | 端到端验收 | W3 | P0 | task-01~05 | AC-01/AC-04 | Docker 重建 + 实测页面 |

## 关键路径

task-01 → task-04 → task-06（daemon 侧为最长路径；backend/frontend 并行不受其阻塞）

## 全局验收标准

- [ ] 所有单元测试通过（backend runtime 模块、daemon、frontend vitest）
- [ ] 集成冒烟：Docker 环境实测 b97f8231 runtime 页显示仓库真实数据（进度卡非空、user-inputs 非空、产物列表非空）
- [ ] 零回归：无 root_path 请求（老 backend 形状）在新 daemon 上读缓存，行为与变更前一致；非法 workspace_id 仍 forbidden
- [ ] lint/typecheck 全绿（backend ruff+mypy、daemon tsc、frontend tsc）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-01@v1 | task-01, task-04 | AC-02（六类读点用例） |
| D-02@v1 | task-02 | AC-03（params 含改写后 root_path） |
| D-03@v1 | task-02 | AC-03（当前用户 binding 行取值） |
| FR-01 | task-01, task-02, task-04 | AC-01 |
| FR-02 | task-01 | AC-02（回退用例） |
| FR-03 | task-01, task-04 | 零回归验收（无 root_path 回归用例） |
| FR-04 | task-01 | AC-02（元字符/越界回退用例） |
| FR-05 | task-03 | AC-04（frontend 用例） |
