---
author: hermes
created_at: "2026-05-31T16:35:00Z"
---

# Task 04: 创建 Prompt 模板 + 修改 Transition Router 返回

## 目标

创建 6 个阶段的 prompt 模板文件；修改 transition API 响应包含 dispatch 信息。

## 实现细节

### 4.1 Prompt 模板

创建 `backend/app/modules/change/prompts/` 目录，包含 6 个 Markdown 模板。

每个模板使用 Python format string 风格的变量占位符:
- `{change_key}` — 变更标识
- `{title}` — 变更标题
- `{description}` — 变更描述
- `{current_stage}` — 当前阶段
- `{target_stage}` — 目标阶段
- `{workspace_root}` — 工作空间路径
- `{spec_root}` — spec 根目录

#### clarifying.md
```
你是 SillySpec 工作流中的需求澄清 Agent。

当前变更: {title} ({change_key})
阶段: draft → clarifying

请执行以下任务:
1. 阅读 change proposal 文档（在 {spec_root}/.sillyspec/changes/change/{change_key}/ 下）
2. 分析需求中的模糊点、遗漏项和潜在冲突
3. 生成澄清问题清单
4. 将分析结果写入 clarifying 文档

输出要求:
- 用中文
- 清晰列出所有需要澄清的问题
- 对每个问题给出建议答案或方向
```

#### design_review.md
类似结构，针对设计评审。

#### plan_tasks.md
针对 task 拆分。

#### execute_task.md
针对代码执行。

#### verify.md
针对测试验证。

#### review.md
针对验收评审。

### 4.2 Transition Router 返回修改

修改 `backend/app/modules/change/router.py` 的 `transition_change` endpoint:

返回类型从 `ChangeRead` 改为包含 dispatch 信息:
```python
@router.post(
    "/changes/{change_id}/transition",
    response_model=dict,  # 或新的 TransitionResponse schema
)
```

响应体:
```json
{
  "change": { ... ChangeRead ... },
  "agent_dispatch": {
    "dispatched": true,
    "stage": "clarifying",
    "agent_run_id": "uuid"
  }
}
```

### 4.3 手动 Dispatch API

新增 endpoint:
```python
@router.post("/changes/{change_id}/dispatch")
async def manual_dispatch(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    stage: str,  # 可选，默认当前阶段
    session: SessionDep,
    _user: CurrentUser,
) -> dict:
```

## 验证

- 6 个 prompt 模板文件存在且内容合理
- transition API 返回包含 agent_dispatch 字段
- 手动 dispatch API 可用
