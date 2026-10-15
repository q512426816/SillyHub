---
author: qinyi
created_at: 2026-10-14 09:08:54
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 部署 agent | 宿主侧执行 sillyhub-docker-deploy skill 的 agent（zcode / claude 等），部署后写发布记录 md |
| 平台用户 | 登录 SillyHub 前端、持 `deploy_record:read` 权限的查看者 |
| 平台管理员 | platform_admin 角色（启动期种子自动绑定全部权限枚举，含新权限） |

## 功能需求

### FR-01: skill 部署后写发布记录 md
Given agent 经 sillyhub-docker-deploy skill 完成一次部署（含验证）
When 部署验证通过或明确失败
Then agent 在仓库 `docs/releases/` 写一个新 md：文件名 `YYYY-MM-DD-<三位序号>-<shortsha>.md`；frontmatter 含 `seq/deployed_at/status/commit_from/commit_to/commits/summary/agent` 字段；正文为 agent 规整的中文变化总结（按 新增/修复/优化 等分组）；commit 范围取平台最近一条记录的 `commit_to`（平台无记录或不可达时回退本地锚定：seq 取目录内最大+1、首条记录 commit_from 可为 null）

### FR-02: 后端只读聚合端点
Given workspace 的 root_path 下存在 `docs/releases/*.md`
When 持 `deploy_record:read` 权限的用户调 `GET /api/deploy-records`
Then 返回全部 workspace 的记录摘要列表（record_id/workspace_id/workspace_name/seq/status/deployed_at/summary/commit_from/commit_to/commits_count/agent/文件名），按 deployed_at 倒序；目录不存在或为空的 workspace 不产生条目也不报错

### FR-03: 记录详情端点
When 调 `GET /api/deploy-records/{record_id}`
Then 返回该记录元数据 + md 正文原文（content 字段）；record_id 为 `<workspace_id>/<文件名去后缀>` 形式；不存在时 404（中文文案）

### FR-04: frontmatter 容错
Given 目录下存在 frontmatter 不合规的 md（yaml 解析失败 / 缺必需字段）
When 拉取列表
Then 该文件以 `status=invalid` 条目出现（文件名与 workspace 保留），不中断整表、不抛 500；详情端点对 invalid 记录返回原文（无元数据）

### FR-05: 前端发布记录页与菜单
Given 用户持 `deploy_record:read` 权限
Then 侧边栏「协作治理」组出现「发布记录」菜单（absolute `/deploy-records`）；页面为左列表右详情：左侧记录卡片（序号/成功失败徽标/时间/工作区/短 SHA/提交数/摘要），右侧元数据行 + md 正文渲染（@uiw/react-markdown-preview）；失败记录红色徽标；无记录时空态

### FR-06: 权限与种子迁移
When 后端启动新版本
Then `Permission` 枚举新增 `DEPLOY_RECORD_READ = "deploy_record:read"`；种子迁移给存量 `workspace_owner` 角色幂等补授（platform_admin 走启动期 seed_platform_admin_role 自动绑全部枚举，无需迁移行）；无该权限的用户菜单不可见、API 403

## 非功能需求
- 兼容性：路径处理兼容 Windows/Linux/macOS（复用 `_rewrite_path` 反斜杠归一化惯例）；容器内读宿主文件依赖既有 `HOST_PROJECTS_DIR` bind mount，不新增挂载
- 性能：全 workspace 目录扫描为每次请求实时读（小规模个人平台，无缓存 v1）
- 中文：用户链路报错文案中文化（test_error_message_l10n.py AST 门禁覆盖）

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02/FR-03 | 新建独立 deploy_records 模块，不碰 release 审批流 |
| D-002@v1 | FR-05/FR-06 | 顶层一级菜单平台级聚合（absolute href + 独立权限） |
| D-003@v1 | FR-01/FR-05 | 基础版字段：时间/序号/commit范围+列表/总结md/成功失败 |
| D-004@v1 | FR-01/FR-02/FR-03 | agent 写 md 文件 + 平台只读扫描，零表零写端点 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-06: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
