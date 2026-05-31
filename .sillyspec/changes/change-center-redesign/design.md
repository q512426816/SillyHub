---
author: qinyi
created_at: 2026-05-31T14:12:00+08:00
---

# 设计文档 — 变更中心流程改造

## 架构概览

```
用户 → 前端表单 → POST /changes/create → 后端创建变更(DB+文件)
                                              ↓
用户 → 点击"启动执行" → POST /changes/{id}/execute → 后端调度Agent
                                                        ↓
                                               CC 跑 sillyspec run
                                                        ↓
                                               阶段完成 → 回写DB
                                                        ↓
前端轮询 → GET /changes/{id} → 展示进度+文档
```

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/app/modules/change_writer/schema.py` | 修改 | ChangeCreateRequest 增加 `description: str` 和 `scope: str`（默认 "full"） |
| `backend/app/modules/change_writer/service.py` | 修改 | create_change 写 proposal.md（含 description）、设 current_stage="created"、status="active" |
| `backend/app/modules/change_writer/router.py` | 修改 | 透传 description 和 scope 到 service |
| `backend/app/modules/agent/coordinator.py` | 修改 | 新增 `sillyspec_full` 和 `sillyspec_quick` 两种 run_type |
| `backend/app/modules/agent/service.py` | 修改 | create_run 支持 sillyspec 类型 |
| `frontend/src/lib/changes.ts` | 修改 | 新增 `createChange()` 函数 |
| `frontend/src/app/(dashboard)/workspaces/[id]/changes/create/page.tsx` | 新增 | 变更创建表单页 |
| `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` | 修改 | 增加启动按钮+文档Tab |
| `docs/change-center-redesign.md` | 已有 | 改造方案 |

## 兼容策略（Brownfield）

- ChangeCreateRequest 新增字段都有默认值：`description=""`, `scope="full"`
- 现有调用方不受影响
- Change model 的 `current_stage` 已存在，无需 migration
- 前端新页面是新路由，不影响已有页面

## 详细设计

### 1. 后端：增强 create_change

**schema.py:**
```python
class ChangeCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    description: str = Field(default="", max_length=5000)  # 新增
    scope: str = Field(default="full", pattern="^(full|quick)$")  # 新增
    change_type: str | None = Field(default=None, max_length=50)
    affected_components: list[str] = Field(default_factory=list)
    lease_id: uuid.UUID | None = None
```

**service.py create_change 增强：**
- 写 proposal.md 包含用户 description
- 设 `current_stage="created"`, `status="active"`, `stages={"created": {"status": "done", "at": now}}`
- scope 记录到 change_type 或新字段（用 change_type 复用，值 "full"/"quick"）

**router.py:**
- 透传 description 和 scope

### 2. 后端：Agent SillySpec 调度

在 agent 模块新增 SillySpec 执行能力：

**coordinator.py 新增：**
- `_sillyspec_full(change_key)` → 运行 `sillyspec run propose --change <key>` → plan → execute → verify → archive
- `_sillyspec_quick(description)` → 运行 `sillyspec quick "<desc>"`
- 每完成一个阶段，调用 change service 的 `update_progress()` 回写 DB

**触发方式：**
- 变更详情页"启动执行"按钮 → POST `/workspaces/{id}/changes/{key}/execute`
- 后端创建 AgentRun(type="sillyspec_full/quick") → 后台执行

### 3. 前端：新建变更页

`/workspaces/[id]/changes/create/page.tsx`:
- Card 布局表单
- 标题 input + 需求描述 textarea + 规模 Radio（大需求/小修改）
- 提交调 `createChange()` → 跳转到详情页

### 4. 前端：变更列表改造

- 每行显示阶段 Badge（颜色编码：created=灰, propose=蓝, plan=黄, execute=橙, verify=绿, archived=紫）
- 右上角"新建变更"按钮
- 可选：阶段筛选下拉

### 5. 前端：详情页增强

- 已有阶段进度条 ✅
- 新增"启动执行"按钮 → POST execute → 创建 AgentRun
- 新增"文档"Tab → 从 `.sillyspec/changes/{key}/` 读取 proposal.md / design.md / requirements.md / tasks.md 等
- 显示 Agent 执行状态（pending/running/completed/failed）

## 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| CC 跑 sillyspec 超时 | 高 | 高 | 拆分阶段，每阶段单独调度 |
| SillySpec 阶段回写失败 | 中 | 中 | 文件系统是最终源，DB 可重新同步 |
| 前端轮询过于频繁 | 低 | 低 | 3-5秒间隔，状态终态时停止 |
