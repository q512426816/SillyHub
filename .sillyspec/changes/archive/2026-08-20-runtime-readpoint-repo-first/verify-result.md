---
author: qinyi
created_at: 2026-08-20T12:25:00+08:00
---

# 验证报告（Verify Result）— 2026-08-20-runtime-readpoint-repo-first

> 注：本报告原版于 2026-08-20 12:25 完成并通过 verify（CLI 全量对账 912.2s/1011.4s 两轮退出码 0）；
> 当日另一会话 `git reset --hard` 清掉未提交文档后从会话记录原样重建，测试证据均当时实测。

## 结论

**PASS WITH NOTES**（变更性质为跨进程 RPC 契约扩展 + daemon 分发，属 deployment-critical；本报告含真实 Runtime Evidence，见对应章节）

## 任务完成度

6/6 任务全部完成（plan.md checkbox 全勾，TaskCard frontmatter acceptance 逐条核验通过）：

| Task | 验收要点 | 证据 |
|---|---|---|
| task-01 | daemon 读点选择三道校验 + 六类用例 | runtime-handler.ts pickRuntimeSpecDir；34 passed（25 旧全绿 + 新增） |
| task-02 | backend 四方法 params 携带改写后 root_path | service.py；44 passed（43 + 前缀改写新例）；test_router.py:152 同步 |
| task-03 | user-inputs 尾部截断 + 文案 | page.tsx USER_INPUTS_MAX_DISPLAY=50000；12 passed |
| task-04 | daemon.ts 透传 + rootsProvider 注入 | 35 passed（含注册器接线用例）；typecheck 0 错 |
| task-05 | local.yaml runtime 模块映射 | 主仓 gitignored 文件 +2 行纯插入，yaml 解析通过 |
| task-06 | 端到端验收 | 见 Runtime Evidence（AC-01 三端点 200 + AC-04 三端全量绿） |

## 设计一致性

独立 QA 子代理验收 10/10 pass（execute-review-2026-08-20-113604/review.json，docHash 与 design.md 一致）：

- D-01@v1 三道校验（元字符黑名单 → assertWithinAllowedRoots → .runtime 存在性）顺序与字符集逐字核对一致；workspace_id forbidden fail-loud 不在回退 catch 内。
- D-02@v1 改写位置（backend 侧 resolve_root_path_for_daemon）、D-03@v1（当前用户 binding 行）落实。
- FR-01~05 全覆盖；RPC 方法名与响应形状零改动（FR-03）；错误映射/超时/containment/1MB 上限零触碰（回归确认）。
- 改动边界恰好 design §9 八文件（git status 复核）。
- Note 1：design 引用「daemon.ts:784 构造点」实际落在 789（实现期行号漂移，语义无差）。
- Note 2：回退 warn 用 console.warn（模块无 logger 注入点，代码注释已说明依据，与 spec-sync.ts 风格一致）。

## 探针结果

- 探针 1（未实现标记）：8 个变更源文件 TODO/FIXME/HACK/XXX 零命中。
- 探针 2（设计关键词）：读点选择 / root_path / 截断 / 回退 / 元字符黑名单全部命中实现代码。
- 探针 3（测试覆盖）：backend 2 + daemon 1 + frontend 1 测试文件 co-located 存在；集成盲区由 task-06 真实部署实测覆盖。

## 测试结果

| 端 | 范围 | 结果 |
|---|---|---|
| backend | app/modules/runtime + app/modules/workspace | 207 passed |
| backend | 全仓 lint/type | ruff All passed；mypy 657 files 零 issue |
| frontend | 全量 vitest | 1772 passed |
| daemon | 全量 vitest（主批 + flaky3 串行） | 2430 passed +9 skipped；33 passed |
| 冒烟复核（主仓） | runtime 模块三端 | backend 44 / daemon 35 / frontend 12 全绿 |
| CLI 最终对账 | commands.test 全量串联 | 两轮 912.2s / 1011.4s 退出码 0 |

注：冒烟途中发现主仓 frontend node_modules/react 被（早前 worktree junction 清理竞态）削成空壳目录，`pnpm install --force` 17.9s 修复后全部恢复——环境修复，非代码问题。CLI 全量对账因 verify-postcheck CRLF 解析缺陷（modules 映射恒失效回退全量，见 docs/sillyspec/verify-postcheck-crlf-local-yaml-modules-parse.md）超 600s 默认超时，以 SILLYSPEC_TEST_TIMEOUT_MS=2400000 兜底跑通。

## 变更风险等级

deployment-critical（CLI 关键词判级；变更扩展 daemon↔backend WS RPC 契约 + daemon bundle 分发重装，横跨跨进程调用与部署路径）。Runtime Evidence 如下（全部真实执行）。

## Runtime Evidence（integration/deployment-critical 必填）

**部署链（2026-08-20 本机实测）**：

1. worktree 内 `pnpm bundle` 产出 ncc 单文件 → 按惯例备份安装 `~/.sillyhub/daemon/bin/sillyhub-daemon.js`（.bak.20260820-runtime-readpoint 保留旧版）。
2. `docker compose -p multi-agent-platform --env-file .env -f docker-compose.yml up --build -d backend frontend`：两镜像重建替换，`/api/health` 200（`"db":"ok","redis":"ok"`）。
3. daemon 重启（stop → 分离进程 start --server http://127.0.0.1:8001）：`status` 显示 running、runtime_id=68c63051-fe2a-49ec-9678-85259f15700e 与 binding 行一致；backend 日志 `ws_daemon_connected daemon_id=68c63051… total_connected=1`。

**功能链（AC-01，b97f8231 工作区真实请求）**：

```
GET /api/workspaces/b97f8231-9404-43bd-89de-38c281c4d875/runtime
→ 200 {"project":"multi-agent-platform","current_stage":"execute",
       "current_change":"2026-07-22-platform-file-center", stages 9 阶段全量状态}
   （与 sillyspec progress dump --spec-dir <repo>/.sillyspec --json 输出逐字一致 = 数据源确为成员本机仓库）

GET .../runtime/user-inputs/raw → 200，1,027,009 字符（≈仓库 .runtime/user-inputs.md 真实大小）

GET .../runtime/artifacts → 200，1,589 个真实产物条目（2026-07-22-mobile-app-ui-* 系列等）
```

修复前同页面三端点虽 200 但全空（缓存目录无 .runtime）；修复后数据齐全——问题闭环。

**边界回归（daemon 单测六类）**：无 root_path（老 backend 形状）→ 读缓存与变更前行为一致；workspace_id 非法 → forbidden fail-loud。

## module-impact 核对

module-impact.md 矩阵（backend/sillyhub-daemon 修改 + frontend 修改 + sillyspec 依赖变更）与实际 git diff 完全一致：8 文件全部命中对应模块，无漏标/误标。「更新结果」表 4 行回填 done（模块卡 MANUAL_NOTES 同步后）。

## 遗留与建议

- 已知边界（design §8，首版接受）：platform-managed 下平台触发 scan/gate 写缓存 `.runtime`，仓库数据存在时不可见；未来需要再做双源 mtime 合并。
- `docs/sillyspec/` 三份工具缺陷记录（install 白名单拒链式命令 / doctor 误删活跃分支 / verify-postcheck CRLF 解析），待 sillyspec 仓修复。
