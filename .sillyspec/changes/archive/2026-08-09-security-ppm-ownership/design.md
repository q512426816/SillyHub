---
author: qinyi
created_at: 2026-08-09T23:26:00
scale: large
tier: independent
change: 2026-08-09-security-ppm-ownership
---

# 设计（Design）— PPM 代填冒名防护（ownership 校验）

> 串行 3 安全 change 之 3（末个）。来源：CONCERNS.md「2026-08-08 多代理审计」🔴 高危「PPM 代填冒名」+ 用户锁定决策（主 plan `cozy-stirring-corbato.md`）。**PPM 模块已上线**（CLAUDE.md 规则 11），改动须最小化、零回归。

## 1. 背景

CONCERNS.md 高危：PPM（项目管理）的执行/工时填报端点**只做认证（谁登录了）不做授权（能不能代别人填）**。具体——以下 7 个写端点经 `get_current_principal` 拿到当前登录 `User` 后，直接把请求体 `body` 里的「执行人 / 检验人 / 当前执行人 / 工时归属人」字段（`execute_user_id` / `check_user_id` / `current_user_id` / `user_id`）落库，**这些字段调用方可任意填**：

| 端点 | 文件:行 | 可冒名字段 |
|---|---|---|
| `POST /api/ppm/problem/.../execute` | problem/router.py:485 → service:504 `execute_user_id=body.execute_user_id or user.id` | execute_user_id |
| `POST /api/ppm/task-plan/start` | task/router.py:213 → service.start:248 `body.execute_user_id or user.id` | execute_user_id |
| `PUT /api/ppm/task-plan/execute` | task/router.py:197 → service.execute_plan:301 `req.execute_user_id` 覆写(:362-366) | execute_user_id |
| `POST /api/ppm/task-execute/create` | task/router.py:379 → TaskExecuteService.create:410 | execute/check/current_user_id（三字段） |
| `PUT /api/ppm/task-execute/update` | task/router.py:390 → TaskExecuteService.update:425 | execute/check/current_user_id |
| `POST /api/ppm/work-hour/create` | task/router.py:501 → WorkHourService.create:529 | user_id（必填） |
| `PUT /api/ppm/work-hour/update` | task/router.py:512 → WorkHourService.update:542 | user_id |

后果：任意登录用户可把执行记录 / 工时记到别人名下（虚报工时、伪造执行、污染绩效/结算数据）。PPM 已上线 = 真实业务数据风险。

## 2. 目标

- 非管理员（`is_platform_admin=False`）在上述 7 端点把归属字段填成「非自己」→ HTTP 403 拒绝。
- 平台管理员（`is_platform_admin=True`）可代填（运维/纠错场景）。
- 自填报（字段 == 当前登录用户）一切照旧，零行为变化。
- 字段为 `None`（未指定）时保留既有默认逻辑（如 `execute_user_id or plan.user_id`），不误伤。

## 3. 非目标

- 不改读端点（create/list/page/get/export 的查询过滤属 `data_scope` 既有机制，不在本次范围）。
- 不改 PPM 数据范围（`ppm/common/data_scope.py`）。
- 不加「强制改密」「填报审批流」等（超修漏洞范围，留 follow-up）。
- 不改 `PlanTaskCreate`（建计划的 `user_id` = 计划负责人，计划阶段语义，非「执行代填」，不动——主 plan 明确「计划负责人不动」）。
- 不改 problem CRUD 的 `duty_user_id`/`audit_user_id`（责任人/验证人**指派**语义，非执行代填；编辑受 `can_operate_problem` 闸口收口）——Design Grill minor，留 follow-up 评估是否需独立授权。
- 不改 delete 端点（`delete_task_execute`/`delete_work_hour`/`delete_plan_task`）的归属/越权校验（属篡改/毁证威胁类，与「代填冒名」不同）——Design Grill minor，留 follow-up。
- 不改 OpenAPI 契约 / DTO / 表结构 / migration（403 经全局 handler 映射，无新响应体）。

## 4. 总体方案

新建 `backend/app/modules/ppm/common/ownership.py`，提供：
- `PpmOwnershipDenied(AppError)`：`code=HTTP_403_PPM_OWNERSHIP_DENIED`、`http_status=403`（ppm 作用域错误类，与 helper 共处，仿 `tool_policy.SsrfBlocked` 模式；不污染 `core/errors.py`）。
- `resolve_owner(*, actor: User, requested: uuid.UUID | None, field: str) -> uuid.UUID | None`：归属校验原语。

**校验放 service 层（纵深防御，主 plan 锁定）**：router 把当前登录 `User`（actor）透传进 service，service 在落库前对每个归属字段调 `resolve_owner`。这样即使将来有内部代码直接调 service 也受保护。

**apply 范围严格限定**：只加在「执行 / 工时 / 任务负责人」**写**入口（7 端点），**绝不**加在通用 create/list/page（否则误伤 `test_task.py` 大量随机 user_id 造数）。

## 5. 拆分（scale 判定）

`scale: large` —— 跨 problem + task 两个 PPM 子域、7 个 HTTP 端点、6 个 service 方法签名变更、新增 helper 模块 + 错误类、权限语义变更（非管理员→403）、新增测试。非 quick。

## 6. 文件变更清单（worktree assess 依此）

| 操作 | 文件 | 说明 |
|---|---|---|
| 新增 | backend/app/modules/ppm/common/ownership.py | PpmOwnershipDenied(403) + resolve_owner helper |
| 修改 | backend/app/modules/ppm/problem/router.py | execute_problem 透传 user 进 service |
| 修改 | backend/app/modules/ppm/problem/service.py | execute_problem 加 actor 参数 + resolve_owner(execute_user_id) |
| 修改 | backend/app/modules/ppm/task/router.py | 7 端点(create/update_task_execute/create/update_work_hour/start_plan_task/execute_plan_task)透传 user |
| 修改 | backend/app/modules/ppm/task/service.py | PlanTaskService.start/execute_plan + TaskExecuteService.create/update + WorkHourService.create/update 加 actor + resolve_owner |
| 新增 | backend/app/modules/ppm/common/tests/test_ownership.py | resolve_owner 纯函数单测 + 各端点非 admin 403 / admin 200 / 自填 200 |
| 修改 | backend/app/modules/ppm/task/tests/test_router.py | 既有 admin 路径预期不改（admin 代填放行）；如发现非 admin 造数用例则改传当前用户 |
| 修改 | backend/app/modules/ppm/task/tests/test_task.py | ~13 处服务直调(start/execute_plan/TaskExecuteService.create/WorkHourService.create+update) + _seed_work_hour/_seed_task_execute helper 补 actor=admin stub（Design Grill major） |
| 修改 | backend/app/modules/ppm/problem/tests/test_problem_flow.py | 9 处 execute_problem 直调补 actor=admin stub（均 omit execute_user_id，断言不涉该字段） |

> 不碰 OpenAPI/DTO/migration → 无需 gen:types。

## 7. 详细设计

### 7.1 `resolve_owner` 语义

```python
def resolve_owner(*, actor: User, requested: uuid.UUID | None, field: str = "execute_user_id") -> uuid.UUID | None:
    """归属校验：非管理员代他人填报→403；管理员可代填；未指定→None（保留调用方默认）。"""
    if requested is None:
        return None                      # 未指定，不校验，调用方按既有默认（如 plan.user_id）
    if actor.is_platform_admin:
        return requested                 # 管理员代填放行
    if requested != actor.id:
        raise PpmOwnershipDenied(
            f"非管理员不能代他人填报 {field}（仅平台管理员可代填）",
            details={"field": field, "actor": str(actor.id), "requested": str(requested)},
        )
    return requested                     # 自填，放行
```

关键：**只挡「显式冒名」**——`requested` 非 None 且非自己且非管理员才拒。`None` 不拒（保留默认），自填不拒，管理员不拒。

### 7.2 service 注入点（6 方法）

1. **`PlanTaskService.start(plan_task_id, execute_user_id, actual_start_time, *, actor: User)`**
   - 当前 router 传 `body.execute_user_id or user.id`（None→登录用户 id），service `actor = execute_user_id or plan.user_id`（其中 `or plan.user_id` 实为死代码——router 已把 None 解析成 user.id）。**有效默认 = 登录用户 id**。
   - 改：router 传原始 `body.execute_user_id`（可能 None）+ `user`（actor）；service `resolved = resolve_owner(actor=actor, requested=execute_user_id, field="execute_user_id")`；`actor_id = resolved if resolved is not None else actor.id`（**保登录用户默认，不变**，非 plan.user_id——避免 live 模块行为漂移）。
   - router start_plan_task：`svc.start(body.plan_task_id, body.execute_user_id, body.actual_start_time, actor=user)`。

2. **`PlanTaskService.execute_plan(req, current_user_id, *, actor: User)`**
   - 当前 `if req.execute_user_id is not None: exc.execute_user_id = req.execute_user_id`（:362-363）、`exc.current_user_id = req.execute_user_id or current_user_id`（:366）。
   - 改：`resolved = resolve_owner(actor=actor, requested=req.execute_user_id)`；`if resolved is not None: exc.execute_user_id = resolved`；`exc.current_user_id = resolved or current_user_id`。
   - router execute_plan_task 改传 `user`。

3. **`TaskExecuteService.create(data: TaskExecuteCreate, *, actor: User)`**
   - 三字段各过 resolve_owner：`data.execute_user_id = resolve_owner(actor=actor, requested=data.execute_user_id, field="execute_user_id")`（同理 check_user_id / current_user_id）。None 保留（既有默认）。
   - router create_task_execute：`svc.create(body, actor=user)`。

4. **`TaskExecuteService.update(exec_id, data: TaskExecuteUpdate, *, actor: User)`**
   - 同 create，三字段各 resolve（仅 data 提供的才校验）。
   - router update_task_execute：`svc.update(execute_id, body, actor=user)`。

5. **`WorkHourService.create(data: WorkHourCreate, *, actor: User)`**
   - `data.user_id` 必填 → `resolve_owner(actor=actor, requested=data.user_id, field="user_id")`（非管理员填他人→403；填自己→放行）。
   - router create_work_hour：`svc.create(body, actor=user)`。

6. **`WorkHourService.update(wh_id, data: WorkHourUpdate, *, actor: User)`**
   - `if data.user_id is not None: resolve_owner(...)`（update 可选字段，仅提供时校验）。
   - router update_work_hour：`svc.update(work_hour_id, body, actor=user)`。

7. **`ProblemService.execute_problem(..., *, actor: User)`**
   - 当前 router `execute_user_id=body.execute_user_id or user.id`（problem/router.py:504）→ 折叠后恒非 None，service:639 `if execute_user_id is not None:` 守卫因此恒真（语义上 moot）。
   - 改：router 传 `user`（actor）+ 原始 body.execute_user_id（None 可）；service `resolved = resolve_owner(actor=actor, requested=execute_user_id)`；`final = resolved if resolved is not None else actor.id`；`exc.execute_user_id = exc.current_user_id = final`。
   - **用 `else actor.id` 而非 if-guard（Design Grill minor #7 评估后驳回）**：`else actor.id` 精确复刻旧 `or user.id`（omit→actor.id），真零漂移；Grill 建议的 if-guard 在「启动者≠执行者且 omit」时会保留启动者 id（旧逻辑写执行者 id）= 漂移。逐 call site 核对 test_problem_flow.py 9 处 omit 均不断言 execute_user_id，两种写法测试皆过，故按生产语义正确性取 `else actor.id`。

### 7.3 错误类

```python
class PpmOwnershipDenied(AppError):
    code = "HTTP_403_PPM_OWNERSHIP_DENIED"
    http_status = status.HTTP_403_FORBIDDEN
```
全局 handler（`core/errors.register_exception_handlers`）已自动把 `AppError` 子类按 `http_status` 映射，无需改 router。前端按 403 + code 显示「无权代他人填报」。

### 7.4 测试影响（Design Grill major 修正：service 层测试须改，非零改动）

两层测试，影响不同（已逐文件核对 call site + 断言）：

- **router 层 `test_router.py`**：经 conftest `auth_admin_token`（is_platform_admin=True）+ `auth_headers`，管理员代填放行，随机 user_id 造数仍 OK → **零改动**（如发现个别非 admin 造数用例，按规则 9 改传当前用户）。
- **service 层直调测试（Design Grill major）**——这些测试**直接调** service 方法（不经 router），签名加 required `*, actor` 后**必须补 actor 参数**（不是零改动）：
  - `problem/tests/test_problem_flow.py`：9 处 `execute_problem` 直调（:431/456/469/483/494/505/522/542/567）均**省略 execute_user_id**，断言只检 status/time_spent/handle_info/file_urls，**不检 execute_user_id** → 补 `actor=admin stub` 即过（admin 放行 None）。`start_problem` **不在范围**（router:478 硬编码 user.id，非冒名面）→ 其调用不动。
  - `task/tests/test_task.py`：~13 处直调（`start`:242/295/321、`execute_plan`:254/278/328/387、`TaskExecuteService.create`:406/416、`WorkHourService.update`:434）+ 2 helper（`_seed_work_hour`:73 / `_seed_task_execute`:113，被 stat_by_user/stat_by_project/page_date_range 等近 10 测试复用）→ 全部补 `actor=admin stub`。修 2 helper 定义即覆盖其全部下游复用。`PlanTaskService.create`（建计划 user_id）不在范围 → 不动。
  - **admin stub 构造**：`resolve_owner` 仅读 `actor.is_platform_admin`/`actor.id`（鸭子类型，无 isinstance、不查库）→ 测试用 `types.SimpleNamespace(id=uuid.uuid4(), is_platform_admin=True)` 即可，不必建 User ORM 行。建议提模块级 fixture 复用。属规则 9「补 actor 参数模拟合法 admin 调用」，**不改断言语义**。
- **新增 `ppm/common/tests/test_ownership.py`**：resolve_owner 纯函数（None→None / admin+任意→放行 / non-admin+自己→放行 / non-admin+他人→PpmOwnershipDenied）+ 端点级双角色（non-admin 代填→403 / admin 代填→201/200 / 自填→201/200）。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| PPM 已上线，service 签名改动致回归 | 签名加 keyword-only `*, actor`（不破坏位置参数顺序）+ 既有 admin 路径测试全绿作回归网 + 不改默认语义（None 保留） |
| 漏保护某个归属端点 | §6 清单 + §7.2 逐端点对照，7 端点全覆盖；verify 决策追踪矩阵闭环 |
| service 签名加 required `*, actor` 连锁 break service 层直调测试（test_task `_seed_work_hour`/`_seed_task_execute` helper 被近 10 stat/page 测试复用） | 补 `actor=admin stub`（SimpleNamespace，admin 放行，既有随机 uuid 造数仍 OK）；只补参数不改断言（规则 9）；修 2 helper 定义覆盖下游复用 |
| 非管理员正当的「执行别人分配给自己的任务」被误拒 | resolve_owner 只挡「显式填他人」，None 默认 + 自填不挡；plan.user_id 默认不受影响 |

## 9. 验收（AC）

- AC-1 非管理员代填 execute_user_id（problem/task-plan/task-execute）→ 403
- AC-2 非管理员代填 work-hour user_id → 403
- AC-3 管理员代填任意 → 201/200
- AC-4 自填报（字段==自己）→ 201/200，行为不变
- AC-5 字段 None → 保留既有默认，不 403
- AC-6 既有测试全绿：test_router.py admin 路径零改动；test_task.py / test_problem_flow.py service 直调补 `actor=admin stub`（规则 9 补参数，不改断言语义）；新增 test_ownership.py ownership 用例
- AC-7 不改 OpenAPI/DTO/migration（无需 gen:types）
- AC-8 PpmOwnershipDenied 经全局 handler 返 403 + code

## 10. 决策（详见 decisions.md）

- D-001 仅平台管理员可代填（`is_platform_admin`），非管理员传他人→403
- D-002 校验放 service 层（纵深防御），router 透传 actor
- D-003 resolve_owner 只挡显式冒名（None 保留默认、自填写自己放行）
- D-004 错误类 PpmOwnershipDenied ppm 作用域（不污染 core/errors.py）
- D-005 只加执行/工时/负责人写入口，不加通用 create/list（防误伤造数测试 + 计划负责人不动）
- D-006 测试改动分级：router 层（test_router.py admin 路径）零改动；service 层直调（test_task.py / test_problem_flow.py）补 `actor=admin stub` 透传（admin 放行，不改断言，规则 9）；新增 ownership 用例

## 11. 自审（Self-Review）

本设计经「实现者自审 → Design Grill 独立交叉审查 → 复审」三轮：

1. **实现者自审**（brainstorm step 6）：逐端点核对 router→service 落库链路确认 7 冒名面；确认 resolve_owner 只挡显式冒名不误伤 None/自填；确认 PpmOwnershipDenied 经全局 handler 自动 403 无需改 router/DTO。
2. **Design Grill 独立审查**（step 7，tier=independent 子代理）：specVerdict=pass（冒名面全覆盖 / 无 None 绕过 / 无 service 间绕过 / 403 映射核实 / code 唯一），qualityVerdict **初审=fail**——抓出 1 MAJOR：原 §7.4/§6/AC-6 误称「service 层测试零改动」，实际签名加 required `*, actor` 会 break test_task.py（~13 直调 + 2 helper）+ test_problem_flow.py（9 处 execute_problem）。已逐条修正 §3（补 duty·audit/delete 非目标）/§6（补两测试文件）/§7.2 #7（else actor.id 零漂移论证 + 驳回 Grill if-guard minor）/§7.4（详列 call site + 断言核对 + admin stub 方案）/§8（补 cascade 风险对策）/AC-6/D-006（措辞改「补 admin stub 不改断言」）。
3. **复审**（step 7，tier=independent 子代理，读修正版）：specVerdict=pass / qualityVerdict=**pass**，MAJOR 真正解决，无 P0/P1 blocker。4 NIT（非 blocker，留 plan 细化）：①§7.4 start 行号漏 :368（总数 ~13 准确，漏列 test 运行 TypeError 即刻暴露）；②WH.update :434 实为 :439；③「近 10 复用」实为 ~8 调用点；④§6 test_router.py 无对应 task（零改动）。

**零漂移关键论证**（自审 + Grill + 复审三方核实）：旧 router:504 `or user.id` 折叠使 service:639 守卫恒真(moot)；新 `final = resolved if resolved is not None else actor.id` 精确复刻旧 omit→登录用户 id 语义；Grill 建议的 if-guard 在「启动者≠执行者且 omit」时会保留启动者 id（旧逻辑写执行者 id）= 漂移，故取 else actor.id。
