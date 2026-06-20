---
id: task-01
title: 看板任务工作站(覆盖:FR-01, D-011)
priority: P0
estimated_hours: 10
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-011@v1]
allowed_paths:
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/kanban/model.py
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/kanban/router.py
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/kanban/service.py
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/kanban/schema.py
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/kanban/__init__.py
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/kanban/tests/test_kanban_task.py
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/kanban/tests/conftest.py
  - /Users/qinyi/SillyHub/backend/migrations/versions/202607210900_create_ppm_kanban_comment_subtask.py
  - /Users/qinyi/SillyHub/frontend/src/app/(dashboard)/ppm/kanban/page.tsx
  - /Users/qinyi/SillyHub/frontend/src/app/(dashboard)/ppm/kanban/task-detail-drawer.tsx
  - /Users/qinyi/SillyHub/frontend/src/lib/ppm/kanban.ts
  - /Users/qinyi/SillyHub/frontend/src/lib/ppm/types.ts
author: qinyi
created_at: 2026-06-21T02:37:10+0800
change: 2026-06-21-ppm-full-alignment
---

# task-01 蓝图:看板任务工作站

## 覆盖来源

- **FR-01**: 看板 task CRUD + 饱和度计算 + UserColumn 字段补齐(taskCount/totalHours/saturation)。
- **D-011@v1**: 新建 `ppm_kanban_comment` + `ppm_kanban_subtask` 两张平台级表(源无独立表,为对齐源看板 TaskDetailDrawer 的评论/子任务/附件功能新建),用 alembic migration 建,up/down 对称。

依据文档:
- `/Users/qinyi/SillyHub/.sillyspec/changes/2026-06-21-ppm-full-alignment/design.md` §5(W1 看板)/ §8(D-011 新表)/ §7(看板端点)
- `/Users/qinyi/SillyHub/.sillyspec/changes/2026-06-21-ppm-full-alignment/plan.md` 任务总表 task-01 行
- `/Users/qinyi/SillyHub/.sillyspec/changes/2026-06-21-ppm-full-alignment/decisions.md` D-011@v1
- `/Users/qinyi/SillyHub/.sillyspec/docs/SillyHub/modules/ppm.md`(平台级无 workspace_id;通知走 audit_logs;附件用 file_urls JSON)

## 修改文件(精确真实路径)

### 后端(新增 1 文件 + 修改 4 文件 + 新增 1 migration + 改 1 conftest + 新增 1 测试)

| 路径 | 操作 | 说明 |
|---|---|---|
| `/Users/qinyi/SillyHub/backend/app/modules/ppm/kanban/model.py` | **新建** | `PpmKanbanComment` + `PpmKanbanSubtask` 两张表 ORM(SQLModel + table=True,UUID 主键,平台级无 workspace_id) |
| `/Users/qinyi/SillyHub/backend/app/modules/ppm/kanban/schema.py` | 修改 | 新增 `TaskCreateReq`/`TaskUpdateReq`/`TaskDeleteReq`/`CommentVO`/`CommentCreateReq`/`SubtaskVO`/`SubtaskVO`(勾选用) 等 Pydantic;**UserColumnVO.saturation 字段类型由 `int` 改为 `float`**(饱和度=已分配工时/可用工时,需保留小数) |
| `/Users/qinyi/SillyHub/backend/app/modules/ppm/kanban/router.py` | 修改 | 新增 7 个端点:POST/PUT/DELETE `/kanban/task`、GET/POST `/kanban/task/{task_id}/comments`、GET `/kanban/task/{task_id}/subtasks`、PUT `/kanban/task/{task_id}/subtask/{subtask_id}/toggle`;**修正现有 `get_user_columns` 在 service 里填充 saturation 字段** |
| `/Users/qinyi/SillyHub/backend/app/modules/ppm/kanban/service.py` | 修改 | 新增 `create_task`/`update_task`/`delete_task`/`list_comments`/`add_comment`/`list_subtasks`/`toggle_subtask` 方法;在 `_aggregate_task_stats` 后计算 `saturation = total_hours / available_hours * 100`(分母为 0 返回 0.0);保留 `_parse_hours` 复用 |
| `/Users/qinyi/SillyHub/backend/app/modules/ppm/kanban/__init__.py` | 修改 | 新增 `from app.modules.ppm.kanban import model  # noqa: F401` 触发 metadata 注册(与 project/tests/conftest 同套路) |
| `/Users/qinyi/SillyHub/backend/app/modules/ppm/kanban/tests/conftest.py` | 修改 | 在 import 区追加 `from app.modules.ppm.kanban import model as _kanban_model  # noqa: F401`,使根 conftest 的 `create_all` 能建出两张新表 |
| `/Users/qinyi/SillyHub/backend/app/modules/ppm/kanban/tests/test_kanban_task.py` | **新建** | task CRUD + comment/subtask 端点 HTTP 测试(走 kanban_client fixture) |
| `/Users/qinyi/SillyHub/backend/migrations/versions/202607210900_create_ppm_kanban_comment_subtask.py` | **新建** | alembic migration,`revision="202607210900"`,`down_revision="1e69522e288c"`(当前 head),up 建两表+索引,down 对称 drop |

> 注:saturation 计算所需的「可用工时」来源见下方「实现要求」;PlanTask 已有 `file_urls` JSON 字段,TaskDetailDrawer 附件直接读 `task.file_urls`,**无需新增附件表**。

### 前端(修改 2 文件 + 新建 1 组件)

| 路径 | 操作 | 说明 |
|---|---|---|
| `/Users/qinyi/SillyHub/frontend/src/lib/ppm/types.ts` | 修改 | 新增 `KanbanComment`/`KanbanCommentCreateReq`/`KanbanSubtask`/`KanbanTaskCreateReq`/`KanbanTaskUpdateReq`/`KanbanTaskDeleteReq` 接口;`KanbanUserColumn.saturation` 类型由 `number` 保留(兼容 float);`KanbanTaskCard` 可选加 `file_urls: string[]` |
| `/Users/qinyi/SillyHub/frontend/src/lib/ppm/kanban.ts` | 修改 | 新增 7 个 API client 函数:`createKanbanTask`/`updateKanbanTask`/`deleteKanbanTask`/`listKanbanComments`/`addKanbanComment`/`listKanbanSubtasks`/`toggleKanbanSubtask` |
| `/Users/qinyi/SillyHub/frontend/src/app/(dashboard)/ppm/kanban/page.tsx` | 修改 | ① TaskCardView 点击卡片打开 TaskDetailDrawer(新增 `selectedTaskId` state);② 列头 saturation 进度条改用 float(`Math.min(saturation,100)`) |
| `/Users/qinyi/SillyHub/frontend/src/app/(dashboard)/ppm/kanban/task-detail-drawer.tsx` | **新建** | TaskDetailDrawer 组件:标题(可内联编辑触发 updateKanbanTask)、评论列表(列表渲染 + 新增输入框调 addKanbanComment)、子任务勾选列表(listKanbanSubtasks + toggleKanbanSubtask)、附件列表(PpmFileUrls 渲染 task.file_urls) |

## 实现要求

### 1. 后端数据模型(kanban/model.py)

两表均平台级,UUID 主键,无 tenant_id,风格对齐 `ppm/task/model.py`:

```python
class PpmKanbanComment(BaseModel, table=True):
    __tablename__ = "ppm_kanban_comment"
    __table_args__ = (Index("ix_ppm_kanban_comment_task", "task_id"),)
    id: uuid.UUID  # UUID 主键
    task_id: uuid.UUID  # FK→ppm_plan_task.id(软关联,不加 FK 约束,沿用 task 子域风格)
    user_id: uuid.UUID
    user_name: str | None  # 冗余名
    content: str  # NOT NULL,内容(空内容由 schema 层校验)
    created_at: datetime  # UTC, default_factory=_now
    updated_at: datetime  # UTC, default_factory=_now

class PpmKanbanSubtask(BaseModel, table=True):
    __tablename__ = "ppm_kanban_subtask"
    __table_args__ = (Index("ix_ppm_kanban_subtask_task", "task_id"),)
    id: uuid.UUID
    task_id: uuid.UUID  # FK→ppm_plan_task.id(软关联)
    title: str  # NOT NULL
    done: bool = False  # Boolean, default False
    sort_order: int = 0  # Integer, 排序
    created_at: datetime
    updated_at: datetime
```

> 对齐 task/model.py:`BaseModel` 来自 `app.models.base`,`_now` 用 `datetime.now(UTC)`,`Column(Uuid(as_uuid=True), primary_key=True)` 风格。

### 2. task CRUD(POST/PUT/DELETE /api/ppm/kanban/task)

- **POST `/kanban/task`**(创建 PlanTask,最小字段:content/user_id 可选,project_id 可选,kanban_order 自动取该 user 列尾 +1):
  - 复用现有 `PlanTask` 模型,**不新建 task 表**。service `create_task` 构造 `PlanTask(content=..., user_id=..., kanban_order=<该列尾 order+1>, status="未开始")`,`session.add + commit + refresh`。
  - 返回 `TaskCardVO`(复用现有 VO)。
- **PUT `/kanban/task`**(更新 task,支持改 content/status/work_load/end_time/file_urls 等):
  - service `update_task(task_id, data: TaskUpdateReq)`:`session.get(PlanTask, task_id)`,不存在 raise `TaskNotFound(404)`;按 data 非空字段更新;commit+refresh;返回 TaskCardVO。
- **DELETE `/kanban/task`**(删 task + 级联删其 comment/subtask):
  - service `delete_task(task_id)`:`session.get(PlanTask)`,404 if None;同事务 `delete(... )` 关联的 `PpmKanbanComment` + `PpmKanbanSubtask`(按 task_id 查),再 `delete(task)`;commit。返回 None(204)。
  - 权限:`PPM_KANBAN_ASSIGN`(写)对齐 assign/reorder;删除建议用 `PPM_KANBAN_ASSIGN`(无独立 delete 权限常量,沿用 assign)。

### 3. 评论端点

- **GET `/kanban/task/{task_id}/comments`** → `list[CommentVO]`(按 created_at 升序)。
- **POST `/kanban/task/{task_id}/comments`**(body `CommentCreateReq{content}`)→ `CommentVO`(201)。
  - service `add_comment(task_id, user, content)`:先校验 task 存在(404),`content.strip()` 为空 raise `AppError(422, "评论内容不能为空")`;`user_name` 取当前登录 user 的冗余名(从 `PpmProjectMember` 查,沿用 `_lookup_user_name`)。
  - 权限:`PPM_KANBAN_VIEW`(评论=协作,弱于 assign)。

### 4. 子任务端点

- **GET `/kanban/task/{task_id}/subtasks`** → `list[SubtaskVO]`(按 sort_order 升序)。
- **PUT `/kanban/task/{task_id}/subtask/{subtask_id}/toggle`** → `SubtaskVO`(翻转 done)。
  - service `toggle_subtask(task_id, subtask_id)`:`session.get(PpmKanbanSubtask, subtask_id)`,不存在 404;校验 `subtask.task_id == task_id`(不匹配 404);`done = not done`;commit;返回 SubtaskVO。
  - > 子任务的「新建/删除」源 TaskDetailDrawer 也有,但 FR-01 只要求勾选;新建/删除作为**非目标**留待后续(若 execute 时发现必要可补,但本 task 不强制)。
  - 权限:`PPM_KANBAN_VIEW`。

### 5. UserColumnVO saturation 计算与字段补齐

- 现有 `UserColumnVO` 已有 `task_count`/`total_hours`/`saturation` 字段,但 **service 从未填充 saturation**(始终默认 0)。本 task 修正:
  - 在 `get_user_columns` 内,聚合完 `task_stats` 后,为每个 user 计算 `saturation`。
  - **饱和度公式**:`saturation = round(total_hours / available_hours * 100, 1)` 当 `available_hours > 0`,否则 `0.0`。
  - **可用工时 `available_hours` 来源**:暂定常量 `DEFAULT_AVAILABLE_HOURS_PER_WEEK = 40`(每周 40h),并按当前可见任务的时间跨度折算——**MVP 简化**:可用工时 = 固定 40h/周(源无明确可用工时字段,task 的 `work_load` 是预估字符串)。saturation 表达「该人员当前任务预估总工时相对 40h 的占比」。`total_hours >= 40` 时 saturation ≥ 100(前端 `Math.min(100)` 截断显示)。
  - schema 层把 `saturation: int` 改为 `saturation: float = 0.0`(前端 types 同步保留 number)。**这是 breaking change**,但项目未上线、数据可清空(CLAUDE.md 规则 7),允许。
  - 字段映射(taskCount/totalHours/saturation 三字段在 VO 已存在,service 需真正赋值):

    | UserColumnVO 字段 | service 赋值来源 |
    |---|---|
    | `task_count` | `_aggregate_task_stats[user]["count"]`(现有 stat["count"]) |
    | `total_hours` | `stat["hours"]`(现有) |
    | `saturation` | `round(stat["hours"] / 40 * 100, 1)` if `40 > 0` else `0.0`(**新增**) |

### 6. TaskDetailDrawer 前端组件(task-detail-drawer.tsx)

- Props:`{ taskId: string | null; onClose: () => void }`;`taskId` 非 null 时渲染。
- 布局:右侧抽屉(`fixed right-0 top-0 h-full w-96 border-l bg-background z-40`,无 shadcn Sheet 依赖则手写)。
- 三区块:
  1. **详情**:标题(`task.title`)可内联编辑(blur 触发 `updateKanbanTask({ task_id, content })`);状态标签(复用 page.tsx 的 taskStatusBadge)。
  2. **附件**:用 `PpmFileUrls` 组件渲染 `task.file_urls`(需要先 GET task 详情拿 file_urls——见接口定义 `getKanbanTask` 或直接在 drawer 打开时调一次 `listKanbanTasks` 过滤;**MVP**:TaskCardVO 不含 file_urls,故 drawer 打开时调新增的 `GET /kanban/task?task_id=` 或复用 `listKanbanTasks` 单条)。**简化**:TaskCardVO 新增可选 `file_urls: string[]`,service `get_task_cards` 填充 `t.file_urls`,drawer 直接用 prop 传入。
  3. **子任务**:`listKanbanSubtasks(taskId)` → 渲染 checkbox 列表,onChange 调 `toggleKanbanSubtask` + 乐观更新。
  4. **评论**:`listKanbanComments(taskId)` → 渲染列表(用户名 + 时间 + content);底部输入框 + 「发送」按钮调 `addKanbanComment`,成功后 prepend 到本地列表。
- 依赖:`@/lib/ppm/kanban`(新 API)、`@/components/ppm-file-urls`、`@/lib/api` 的 `ApiError`、page.tsx 的 `fmtDay`/`useToast`(从 `../shared` 导入)。

### 7. page.tsx 改动

- `TaskCardView` 新增 `onClick={() => onOpenDetail(task.id)}`,顶部加 `<div onClick>` 包裹(注意与 dragStart 不冲突:onClick 仅在非拖拽时触发,浏览器默认行为即可)。
- `KanbanPage` 加 `const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)`;底部渲染 `<TaskDetailDrawer taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />`。
- 列头 saturation 进度条:`Math.min(column.saturation, 100)` 已有,int→float 无需改逻辑。

## 接口定义

### 后端 router 路由签名(新增 7 个,加在 kanban/router.py 末尾)

```python
@router.post("/kanban/task", response_model=TaskCardVO, status_code=201)
async def create_task(body: TaskCreateReq, session: SessionDep, _user: KanbanAssignUser) -> TaskCardVO: ...

@router.put("/kanban/task", response_model=TaskCardVO)
async def update_task(body: TaskUpdateReq, session: SessionDep, _user: KanbanAssignUser) -> TaskCardVO: ...

@router.delete("/kanban/task", status_code=204)
async def delete_task(task_id: uuid.UUID = Query(...), session: SessionDep = Depends(get_session),
                      _user: KanbanAssignUser = Depends(...)) -> None: ...

@router.get("/kanban/task/{task_id}/comments", response_model=list[CommentVO])
async def list_comments(task_id: uuid.UUID, session: SessionDep, _user: KanbanViewUser) -> list[CommentVO]: ...

@router.post("/kanban/task/{task_id}/comments", response_model=CommentVO, status_code=201)
async def add_comment(task_id: uuid.UUID, body: CommentCreateReq, session: SessionDep, _user: KanbanViewUser) -> CommentVO: ...

@router.get("/kanban/task/{task_id}/subtasks", response_model=list[SubtaskVO])
async def list_subtasks(task_id: uuid.UUID, session: SessionDep, _user: KanbanViewUser) -> list[SubtaskVO]: ...

@router.put("/kanban/task/{task_id}/subtask/{subtask_id}/toggle", response_model=SubtaskVO)
async def toggle_subtask(task_id: uuid.UUID, subtask_id: uuid.UUID, session: SessionDep,
                         _user: KanbanViewUser) -> SubtaskVO: ...
```

> DELETE 用 `Query(...)` 传 task_id(对齐现有 `delete_plan_task` 风格);其余写操作用 body。权限复用现有 `KanbanAssignUser`(PPM_KANBAN_ASSIGN)与 `KanbanViewUser`(PPM_KANBAN_VIEW)。

### 后端 service 方法签名(PpdKanbanService 新增)

```python
async def create_task(self, req: TaskCreateReq) -> PlanTask: ...
async def update_task(self, task_id: uuid.UUID, req: TaskUpdateReq) -> PlanTask: ...
async def delete_task(self, task_id: uuid.UUID) -> None: ...
async def list_comments(self, task_id: uuid.UUID) -> list[PpmKanbanComment]: ...
async def add_comment(self, task_id: uuid.UUID, user: User, content: str) -> PpmKanbanComment: ...
async def list_subtasks(self, task_id: uuid.UUID) -> list[PpmKanbanSubtask]: ...
async def toggle_subtask(self, task_id: uuid.UUID, subtask_id: uuid.UUID) -> PpmKanbanSubtask: ...
```

### Pydantic schema 字段(kanban/schema.py 新增)

```python
class TaskCreateReq(BaseModel):
    content: str  # NOT NULL
    user_id: uuid.UUID | None = None  # 不传则未分配
    project_id: uuid.UUID | None = None
    project_name: str | None = None
    work_load: str | None = None  # 预估工时字符串
    end_time: datetime | None = None  # 截止
    file_urls: list[str] = Field(default_factory=list)

class TaskUpdateReq(BaseModel):
    task_id: uuid.UUID
    content: str | None = None
    status: str | None = None
    work_load: str | None = None
    end_time: datetime | None = None
    file_urls: list[str] | None = None

class CommentVO(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    task_id: uuid.UUID
    user_id: uuid.UUID
    user_name: str | None = None
    content: str
    created_at: datetime

class CommentCreateReq(BaseModel):
    content: str  # 空内容由 service 校验(422);min_length 在 service .strip() 判定

class SubtaskVO(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    task_id: uuid.UUID
    title: str
    done: bool
    sort_order: int
    created_at: datetime
```

> UserColumnVO.saturation: `int → float`(default 0.0)。

### TS API client 函数签名(lib/ppm/kanban.ts 新增)

```ts
export async function createKanbanTask(body: KanbanTaskCreateReq): Promise<KanbanTaskCard>;
export async function updateKanbanTask(body: KanbanTaskUpdateReq): Promise<KanbanTaskCard>;
export async function deleteKanbanTask(taskId: string): Promise<boolean>;
export async function listKanbanComments(taskId: string): Promise<KanbanComment[]>;
export async function addKanbanComment(taskId: string, body: KanbanCommentCreateReq): Promise<KanbanComment>;
export async function listKanbanSubtasks(taskId: string): Promise<KanbanSubtask[]>;
export async function toggleKanbanSubtask(taskId: string, subtaskId: string): Promise<KanbanSubtask>;
```

### TS types(lib/ppm/types.ts 新增)

```ts
export interface KanbanComment {
  id: string; task_id: string; user_id: string; user_name: string | null;
  content: string; created_at: string;
}
export interface KanbanCommentCreateReq { content: string; }
export interface KanbanSubtask {
  id: string; task_id: string; title: string; done: boolean;
  sort_order: number; created_at: string;
}
export interface KanbanTaskCreateReq {
  content: string; user_id?: string | null; project_id?: string | null;
  project_name?: string | null; work_load?: string | null;
  end_time?: string | null; file_urls?: string[];
}
export interface KanbanTaskUpdateReq {
  task_id: string; content?: string | null; status?: string | null;
  work_load?: string | null; end_time?: string | null; file_urls?: string[] | null;
}
// KanbanTaskCard 追加: file_urls?: string[];
```

## 边界处理

1. **task 不存在 → 404**:update/delete/list_comments/list_subtasks/add_comment/toggle_subtask 中,`session.get(PlanTask/PpmKanbanSubtask, id)` 为 None 时 raise 对应 `TaskNotFound`/`SubtaskNotFound`(`code="PPM_KANBAN_TASK_NOT_FOUND"`, `http_status=404`)。测试覆盖:DELETE 不存在 task_id 返回 404。
2. **评论空内容 → 422**:`add_comment` 中 `content.strip()` 为空 raise `AppError(code="PPM_KANBAN_COMMENT_EMPTY", http_status=422, "评论内容不能为空")`。测试覆盖:POST 空字符串/纯空白返回 422。
3. **saturation 分母为 0 → 返回 0.0**:可用工时常量 40 > 0 永远不为 0;但为防御,公式 `total_hours / available_hours if available_hours > 0 else 0.0`。若后续 available_hours 改为按用户配置且可能为 0,该分支保证不 ZeroDivisionError。测试覆盖:某 user 无任务时 saturation=0.0。
4. **无 workspace_id(平台级)**:所有端点不带 workspace 过滤,直接全平台 PlanTask/project_member 查询(对齐 ppm.md「平台级,无 workspace_id」)。
5. **kanban_order 重排持久化**:create_task 时自动取该 user 列 `max(kanban_order)+1`(无任务则 0),保证新卡片落列尾;现有 `reorder_tasks` 已持久化拖拽顺序,无需改。
6. **toggle_subtask task_id 不匹配 → 404**:URL 里 task_id 与 subtask.task_id 不一致时,当作「该 task 下无此 subtask」处理,raise 404(防止跨 task 勾选)。
7. **delete_task 级联**:删 task 时同事务删其 comment + subtask,避免孤儿行;若 comment/subtask 为空,delete 0 行不报错。

## 非目标

- **不做文件上传(D-007/010)**:TaskDetailDrawer 附件仅展示 `file_urls` JSON 字符串列表(只读),不实现上传/删除文件功能。file_urls 的写入通过 `updateKanbanTask` 传字符串数组(假定 URL 由外部已上传得到)。
- **不做 silly 工作流(D-002)**:task 状态用字符串字段(`未开始`/`10`/`20`/...),不走 silly 状态机;子任务 done 是简单 bool 翻转。
- **不做子任务新建/删除端点**:FR-01 只要求勾选;新建/删除子任务留待后续 task 或人工补(源 TaskDetailDrawer 有,但本 task 缩减范围)。
- **不做 saturation 可用工时个性化配置**:固定 40h/周常量,不做按用户/项目配置(避免引入 settings 表依赖)。
- **不做 TaskDetailDrawer 的拖拽冲突处理**:卡片点击 vs 拖拽靠浏览器原生行为区分,不额外防抖。

## 参考

- **现有 CRUD 模式**:`backend/app/modules/ppm/problem/service.py`(`_BaseCrud.get/create/update/delete` + `raise ProblemNotFound`),`backend/app/modules/ppm/task/router.py`(`create_plan_task`/`update_plan_task`/`delete_plan_task` 端点签名 + `Page` 响应 + 权限依赖别名)。
- **model 风格**:`backend/app/modules/ppm/task/model.py`(`PlanTask`/`TaskExecute`/`WorkHour` 三表,UUID 主键 + `__table_args__` Index + `_now` + `Column(JSON)` file_urls)。
- **migration 风格**:`backend/migrations/versions/202607041100_create_ppm_task.py`(`op.create_table` + `op.create_index`,down 对称 drop,`revision`/`down_revision` 字符串)。
- **前端组件复用**:`frontend/src/components/ppm-sub-table.tsx`(若 TaskDetailDrawer 评论列表需要表格化可复用,但评论更适合自定义列表)、`frontend/src/components/ppm-file-urls.tsx`(附件渲染)、`frontend/src/components/ppm-user-select.tsx`(若 drawer 内改负责人可复用)。
- **测试 fixture**:`backend/app/modules/ppm/kanban/tests/conftest.py`(`kanban_client` + `auth_admin_token`,独立 app 挂 kanban router,prefix `/api/ppm`)。
- **alembic head**:当前 head 为 `1e69522e288c`,新 migration `down_revision` 指向它(执行 `cd backend && .venv/bin/alembic heads` 可确认)。

## TDD 步骤

遵循 CLAUDE.md「文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收」。

1. **写测试先(test_kanban_task.py)**:新建测试文件,覆盖:
   - `test_create_task`:POST `/api/ppm/kanban/task` 带 content → 201,返回 TaskCardVO,kanban_order=0(首条);再 POST 一条 → kanban_order=1。
   - `test_update_task`:先 create,再 PUT 改 content/status → 返回更新后字段。
   - `test_update_task_not_found`:PUT 不存在 task_id → 404。
   - `test_delete_task`:create 后 DELETE → 204;再 GET tasks 不含该 id。
   - `test_delete_task_cascade`:create task + add comment + add subtask(需先有 subtask 种子,见下),DELETE task → 查 comment/subtask 表为空。
   - `test_add_comment_empty_422`:POST 评论 content=" " → 422。
   - `test_add_comment_task_not_found_404`:POST 评论到不存在 task_id → 404。
   - `test_list_comments`:create task + 2 评论 → GET 返回 2 条,按 created_at 升序。
   - `test_toggle_subtask`:种子一条 PpmKanbanSubtask(done=False)→ PUT toggle → done=True;再 toggle → False。
   - `test_toggle_subtask_task_mismatch_404`:subtask 属 task A,toggle 时 URL 用 task B → 404。
   - `test_user_column_saturation`:种子 user 带 2 条 task(work_load="20"+"30"=50h)→ GET `/kanban/users` → saturation=125.0(50/40*100),task_count=2,total_hours=50.0。
   - `test_user_column_saturation_zero`:user 无 task → saturation=0.0。
   - 跑 `pytest backend/app/modules/ppm/kanban/tests/test_kanban_task.py -x` → **应全部失败**(端点/model 未实现)。
2. **写 model(kanban/model.py)**:两表 ORM。
3. **写 schema(kanban/schema.py)**:新增 Req/VO + 改 saturation 类型。
4. **写 service(service.py)**:7 个方法 + saturation 计算 + `_aggregate_task_stats` 后填充。
5. **写 router(router.py)**:7 个端点。
6. **改 __init__.py + conftest.py**:触发新表 metadata 注册。
7. **写 migration(202607210900)**:up/down 两表。
8. **跑测试**:`pytest backend/app/modules/ppm/kanban/tests/ -x` → 全绿。
9. **跑 alembic**:`cd backend && .venv/bin/alembic upgrade head` → 无报错;`alembic downgrade -1` → 两表 drop;再 `upgrade head` 恢复。
10. **前端**:写 types → 写 kanban.ts API → 写 task-detail-drawer.tsx → 改 page.tsx;跑 `cd frontend && npx tsc --noEmit` → 无错。

## 验收标准

| AC | 标准 | 验证方式 |
|---|---|---|
| AC-01 | task CRUD(POST/PUT/DELETE `/api/ppm/kanban/task`)测试通过 | `pytest test_kanban_task.py::test_create_task/test_update_task/test_delete_task` 绿 |
| AC-02 | `ppm_kanban_comment` + `ppm_kanban_subtask` 两表 migration up/down 对称可用 | `alembic upgrade head` 建表成功;`alembic downgrade -1` drop 成功;再 upgrade 恢复;无残留 |
| AC-03 | TaskDetailDrawer 渲染评论列表/新增评论/子任务勾选/附件 file_urls 展示 | `npx tsc --noEmit` 无错;人工/截图确认 drawer 打开后四区块可见,评论可新增,子任务可勾选,附件列表渲染 |
| AC-04 | saturation 计算正确(total_hours/40*100,分母 0 返 0.0) | `pytest test_kanban_task.py::test_user_column_saturation/test_user_column_saturation_zero` 绿;GET /kanban/users 返回含 saturation 字段 |
| AC-05 | UserColumnVO 返回 taskCount/totalHours/saturation 三字段均由 service 填充(非默认 0) | `pytest` 断言三字段值与种子数据一致;GET 响应 JSON 含三字段 |
| AC-06 | 前端 `tsc --noEmit` + 后端 `ruff check` + `pytest kanban/tests` 全通过 | `cd frontend && npx tsc --noEmit`;`cd backend && .venv/bin/ruff check app/modules/ppm/kanban && .venv/bin/pytest app/modules/ppm/kanban/tests/` |

## 自审

- 覆盖 FR-01(task CRUD + saturation + TaskDetailDrawer)+ D-011(两新表 migration up/down)。
- 精确真实路径(均已读现有代码确认存在或可建)。
- 不依赖其他 task-N.md(kanban 子域自包含,无 W2~W6 依赖)。
- 非目标明确(文件上传/silly 工作流/子任务增删)。
- 边界 7 条覆盖 404/422/0 除法/平台级/重排级联。
- saturation 类型 int→float 是 breaking change,项目未上线允许(CLAUDE.md 规则 7)。
- migration down_revision 指向当前 head `1e69522e288c`(执行前用 `alembic heads` 二次确认)。
