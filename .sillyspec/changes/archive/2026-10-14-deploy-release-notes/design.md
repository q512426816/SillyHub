---
author: qinyi
created_at: 2026-10-14 09:40:07
generated_by: sillyspec-design-init
scale: "large"
---

# 设计文档（Design）— 2026-10-14-deploy-release-notes

## 背景

平台部署由宿主 agent 经 `sillyhub-docker-deploy` skill（`.zcode/skills/sillyhub-docker-deploy/SKILL.md`）以 docker compose 完成，部署动作发生在平台之外。部署历史与「本次改了什么」的语义化总结目前无处沉淀。本变更为部署动作补一条留痕链路：agent 部署后写发布记录 md 进仓库，平台新增只读模块与顶层菜单聚合展示。

核心裁决（详见 decisions.md）：D-004——不做 API 上报与数据库表，**记录即仓库文件**（`docs/releases/*.md`），平台经既有容器路径改写机制直接读文件渲染。

## 设计目标

1. agent 每次部署（成功或失败）后产出一份人能直接读的变化总结 md，含机器可读的元数据 frontmatter。
2. 平台零建表、零写端点：新增只读模块聚合所有 workspace 的发布记录。
3. 顶层一级菜单「发布记录」，左列表右详情，md 正文渲染。
4. 全链路跨平台（Windows/Linux/macOS）。

## 非目标

- 回滚按钮、部署日志摘要、健康检查展示（D-003 裁剪）
- 写 API / 数据库表 / 缓存层（D-004 裁剪；v1 每请求实时扫目录）
- 平台与项目分离部署（多机）支持（D-004 退役判据）
- 现有 release 审批流模块的任何改动（D-001）
- 记录文件的 git 提交自动化（随部署工作成果一起提交）

## 拆分判断

单变更完成：三端改动（skill / backend / frontend）围绕同一个文件契约（§接口定义的 md 格式），拆开会导致契约漂移无人对齐；约 19 文件（见下方清单），单 change 可吞吐，不分批。

## 总体方案

```
部署时（agent 侧，skill 硬步骤）：
  验证通过 ─→ GET /api/deploy-records（拿最近一条 commit_to + seq）
           ─→ git log <from>..HEAD（提交列表）
           ─→ agent 规整中文变化总结
           ─→ 写 docs/releases/YYYY-MM-DD-<三位序号>-<shortsha>.md
  （平台不可达/无记录时回退：seq=目录内最大+1，commit_from=null）

读取时（平台侧，只读）：
  GET /api/deploy-records ─→ 遍历 workspaces 表
      ─→ 每 workspace root_path 经 _rewrite_path(host→container)
      ─→ <root>/docs/releases/*.md 解析 frontmatter
      ─→ 汇总倒序返回
  GET /api/deploy-records/{record_id} ─→ 读单文件原文+元数据
  （record_id = "<workspace_id>/<文件名去.md后缀>"，workspace_id 保证跨工作区文件同名不冲突）

展示（前端）：
  /deploy-records 左列表右详情，@uiw/react-markdown-preview 渲染正文
```

### md 文件契约（单一真相，三端共同遵守）

文件名：`docs/releases/YYYY-MM-DD-<三位序号>-<commit短SHA>.md`（序号全局递增，跨日期不重置）

```yaml
---
seq: 3                          # 必填，int，目录内最大+1
deployed_at: "2026-10-14 08:52:36"  # 必填，本地时间
status: success                 # 必填，success | failed
commit_from: ebeb09af0          # 可空（首条记录），上一条记录的 commit_to
commit_to: ad6092e1d            # 必填，本次部署 HEAD
summary: 文件树显式同步+刷新触发面收窄  # 必填，一句话
agent: zcode-agent              # 必填，执行部署的 agent 标识
commits:                        # 必填，列表（可为空列表=无新提交的重部署）
  - sha: ad6092e1d
    message: fix(change): ...
    author: qinyi
---
（正文：agent 写的中文变化总结，按 🆕新增/🔧修复/⚡优化 分组；失败记录正文写失败原因）
```

必填字段缺失或 yaml 解析失败 → 该文件按 FR-04 以 `status=invalid` 容错展示。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | .zcode/skills/sillyhub-docker-deploy/SKILL.md | 「验证」节后新增「发布记录」硬步骤节（含回退锚定与失败记录规则） |
| 新增 | NEW:backend/app/modules/deploy_records/__init__.py | 模块包 |
| 新增 | NEW:backend/app/modules/deploy_records/router.py | GET /api/deploy-records、GET /api/deploy-records/{record_id}，require_permission(DEPLOY_RECORD_READ) |
| 新增 | NEW:backend/app/modules/deploy_records/service.py | 扫描/解析/聚合逻辑；frontmatter 容错；路径经 workspace/service.py `_rewrite_path` 改写 |
| 新增 | NEW:backend/app/modules/deploy_records/schema.py | DeployRecordSummary / DeployRecordDetail 响应模型 |
| 新增 | NEW:backend/app/modules/deploy_records/tests/test_service.py | 解析/容错/聚合单测（tmp_path 造假目录） |
| 新增 | NEW:backend/app/modules/deploy_records/tests/test_router.py | 端点鉴权与 404/invalid 行为测试 |
| 修改 | backend/app/modules/auth/permissions.py | 新增 DEPLOY_RECORD_READ = "deploy_record:read" |
| 新增 | NEW:backend/migrations/versions/20261014110000_add_deploy_record_read_permission.py | 存量 workspace_owner 幂等补授（写法照 20260917104400 先例） |
| 修改 | backend/app/main.py | include deploy_records_router（/api 前缀） |
| 修改 | backend/pyproject.toml | dependencies 显式加 pyyaml>=6（现为传递依赖，防漂移） |
| 修改 | backend/tests/modules/auth/test_permissions.py | Permission 枚举 len 硬计数锚 58→59（新增枚举成员必破，连带测试〔plan 审查注记〕） |
| 修改 | backend/tests/test_align_platform_change_events_migration.py | 迁移链尾锚 heads[0] 前移 20261012123000→20261014110000（断言面①连带，同提交钉子） |
| 新增 | NEW:frontend/src/lib/deploy-records.ts | fetch 函数 + useQuery hooks + queryKeys（三件套惯例） |
| 修改 | frontend/src/lib/query-keys.ts | deployRecords key 工厂 |
| 新增 | NEW:frontend/src/app/(dashboard)/deploy-records/page.tsx | 左列表右详情页（PageContainer/PageHeader 骨架） |
| 修改 | frontend/src/lib/menu-permissions.ts | governance 组新增 deploy-records 菜单项（absolute） |
| 修改 | frontend/src/components/app-shell.tsx | MENU_ICON_MAP 增 "/deploy-records" → History（lucide；Package 已被现有发布菜单占用） |
| 修改 | frontend/src/lib/api-types.ts | pnpm gen:types 再生成（含 backend/openapi.json 提交） |
| 修改 | backend/openapi.json | gen:types 链路导出物（新端点进契约） |
| 新增 | NEW:frontend/src/app/(dashboard)/deploy-records/__tests__/page.test.tsx | 页面测试（列表渲染/选中切详情/空态/徽标） |
| 修改 | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | 断言面⑦：菜单注册表新增条目平移声明序，同提交重算组内上移/下移锚（scripts/check-assertion-surfaces.py 门禁） |

## 接口定义

```
GET /api/deploy-records
  → 200 [DeployRecordSummary]
  （列表排序：按 deployed_at 字符串倒序；invalid 条目 deployed_at=None 排最后、按 file_name 倒序次级排序——写死规则避免实现歧义〔Grill 注记 a〕）
  DeployRecordSummary = {
    record_id: str            # "<workspace_id>/<file_stem>"
    workspace_id: UUID
    workspace_name: str
    file_name: str            # "2026-10-14-003-ad6092e1d.md"
    seq: int | None           # invalid 时 None
    status: str               # success | failed | invalid
    deployed_at: str | None   # frontmatter 原文透传（skill 约定写 "YYYY-MM-DD HH:mm:ss" 本地时间字符串；后端零解析，排序按字符串字典序——同格式下与时间序一致〔Grill 注记 b〕）
    summary: str
    commit_from: str | None
    commit_to: str | None
    commits_count: int | None
    agent: str | None
  }

GET /api/deploy-records/{record_id}   # record_id 含 "/"，path 参数 URL 编码
  → 200 DeployRecordDetail = DeployRecordSummary + { content: str }  # md 正文原文
  → 404 RecordNotFound（中文文案）
```

service 关键签名：
```python
class DeployRecordService:
    def __init__(self, session: AsyncSession): ...
    async def list_records(self) -> list[DeployRecordSummary]: ...
    async def get_record(self, record_id: str) -> DeployRecordDetail: ...
    # 内部：_scan_workspace(root_path) -> list[RawRecord]
    #       _parse_frontmatter(text) -> tuple[dict|None, str]（None=invalid，str=正文）
```

## 生命周期契约表

本变更不涉及生命周期契约——不新增 session/lease/agent_run/daemon/state transition/claim/heartbeat 任何生命周期实体；部署记录是静态文件读取，无状态机。

## 数据模型

无数据库表、无 alembic 表结构迁移。仅一条权限种子数据迁移（`deploy_record:read` → 存量 workspace_owner 角色幂等补授；platform_admin 走启动期 `seed_platform_admin_role` 自动绑全部枚举，不插迁移行）。数据真身是仓库文件 `docs/releases/*.md`（契约见总体方案节）。

## 兼容策略（brownfield 必填）

- 未部署过 agent 记录的 workspace：`docs/releases/` 目录不存在 → 该 workspace 无条目、不报错（FR-02）。
- 旧部署无任何发布记录：列表空态，skill 侧回退本地锚定写首条记录（FR-01）。
- 不改任何现有 API / 表 / 页面行为；release 审批流模块零触碰。
- 前端类型经 `pnpm gen:types` 再生成，`gen:types:check` 卡漂移。
- pyyaml 由传递依赖转显式声明，不引入新包。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | agent 不读/漏执行 skill 步骤 → 部署缺记录 | P1 | skill 写成「硬步骤」编号节+标题明示必须；平台侧无兜底（D-006 已裁剪），接受漏报可能（记录非部署前置条件，漏写不阻断部署） |
| R-02 | 容器读不到宿主文件（workspace 不在 HOST_PROJECTS_DIR 挂载下） | P1 | 该 workspace 无条目静默降级；前端空态文案提示「确认 workspace 根目录已挂载进平台容器」 |
| R-03 | frontmatter 手写出错（yaml 语法/字段缺失） | P2 | FR-04 invalid 容错不炸列表；skill 文档内嵌完整模板供照抄 |
| R-04 | 菜单注册表增条目平移声明序，admin/menus 测试锚漏跟 | P2 | 同提交重算断言锚（断言面⑦ pre-commit 门禁硬拦） |
| R-05 | 每次 API 请求实时扫全 workspace 目录，记录多后变慢 | P3 | v1 接受（个人平台规模）；退化判据：单次列表 >500ms 再引入 mtime 缓存 |
| R-06 | record_id 含 "/" 与 FastAPI path 参数冲突 | P2 | 路由声明 `{record_id:path}` 或前端 encodeURIComponent 整段编码；以路由实测为准（execute 期定） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | §文件变更清单（新模块独立、release 零触碰） | confirmed，锚点 backend/app/modules/release/router.py:26 |
| D-002@v1 | §接口定义（平台级端点无 workspace 前缀）+ §文件变更清单（menu-permissions governance 组 absolute） | confirmed，锚点 frontend/src/lib/menu-permissions.ts:101 |
| D-003@v1 | §总体方案 md 契约（基础版字段集，无日志/健康检查/回滚） | confirmed，锚点 .sillyspec/changes/2026-10-14-deploy-release-notes/requirements.md FR-01 |
| D-004@v1 | §总体方案（写文件+只读扫描，零表零写端点）+ §数据模型（无表） | confirmed，锚点 backend/app/core/config.py:480 |
| D-005@v1 | §数据模型（rejected：不新增写 API——本设计无写端点即为遵守） | rejected 落档 |
| D-006@v1 | §风险登记 R-01（rejected：无自动探测兜底，接受漏报） | rejected 落档 |
| D-007@v1 | §总体方案（rejected：无 CLI 封装，skill 直写） | rejected 落档 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large：三端跨模块、含权限枚举+迁移，需 Wave 编排）
- [x] 引用所有当前版本 D-xxx@v1（追踪表 7 条全覆盖，含 rejected 防复潮）
- [x] 生命周期关键词豁免：本节已声明无生命周期契约实体
- [x] UI 原型分级核对：prototype-deploy-records.html 已生成于变更目录（用户两轮确认）
- [ ] 无「⚠️ 自审存疑」项——R-06（record_id path 参数形态）标注为 execute 期实测定型，属实现细节非设计缺口
