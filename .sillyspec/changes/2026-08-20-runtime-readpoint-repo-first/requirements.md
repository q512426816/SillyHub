---
schema_version: 1
doc_type: requirements
change_name: 2026-08-20-runtime-readpoint-repo-first
author: qinyi
created_at: 2026-08-20T02:20:00+00:00
---

# Requirements：运行时状态读点修正

## 功能需求

- **FR-01** runtime 页四类数据（进度 / 用户输入原文 / 产物列表 / 产物内容）经当前用户绑定 daemon 读取时，优先使用该用户 binding 行 `root_path` 下的 `<root_path>/.sillyspec/.runtime/`：`root_path` 通过元字符预检、daemon 侧 allowed_roots 校验且该 `.runtime` 目录存在时，进度以 `<root_path>/.sillyspec` 为 `--spec-dir`，其余三类直读其下文件。
- **FR-02** 读点回退：`root_path` 缺失 / 非法 / 含 shell 元字符 / 越界 / `.runtime` 目录不存在任一情形，四类数据回退读现有缓存目录 `~/.sillyhub/daemon/specs/<workspace_id>/`，行为与本变更前完全一致（零回归）；workspace_id 非法仍按现状抛 forbidden。
- **FR-03** RPC 兼容：四个 `runtime.*` 方法名与响应形状不变，仅增加可选请求字段 `root_path`；不携带该字段的老 backend 请求在新 daemon 上行为不变。
- **FR-04** 路径与命令安全：`root_path` 先过元字符黑名单预检（`" ' \` $ & | ; < > ( ) % ^` 及换行/回车/NUL 任一命中即判无效），再在 daemon 侧经 `assertWithinAllowedRoots`（realpath/junction 感知）校验；实际读取路径固定收敛在所选 specDir 的 `.runtime/` 子树内；artifact filename 预检与 containment 主防线维持不变。
- **FR-05** 前端展示：用户输入记录超过 50000 字符时仅渲染末尾 50000 字符并提示已截断（含完整内容所在文件路径）；页面副标题更新为「优先本机仓库，回退同步缓存」语义。

## 验收标准

- **AC-01** 在 b97f8231 工作区（platform-managed、binding root_path 指向本仓库）打开 `/workspaces/<id>/runtime`，进度卡显示项目/当前阶段/当前变更，用户输入与产物列表非空（数据来自仓库 `.sillyspec/.runtime/`）。
- **AC-02** daemon 单测覆盖六类读点用例（仓库优先 / 元字符回退 / 越界回退 / `.runtime` 不存在回退 / 无 root_path 回归 / 非法 workspace_id 仍 forbidden）。
- **AC-03** backend 单测断言四个 RPC params 携带经 `resolve_root_path_for_daemon` 改写后的 `root_path`。
- **AC-04** 全量测试绿：backend pytest（runtime 模块）、daemon vitest、frontend vitest + tsc。
