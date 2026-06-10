---
author: WhaleFall
created_at: 2026-06-08T10:55:00
---

# Design: 变更中心列展示优化

## 背景

变更中心列表页的"类型"、"状态"、"阶段"、"影响组件"四列数据不完整：
- 类型列（change_type）完全依赖人工输入，99% 显示 "—"
- 状态列（status）是僵尸字段，创建时设置一次（draft/active/unknown）后不再更新，前端也缺少 active 的颜色映射
- 阶段列（current_stage）为 null 时不渲染任何内容，出现视觉空洞
- 影响组件列（affected_components）仅归档时写入，未归档变更全显示 "—"

同时，`human_gate` 字段精确表达了"变更正在等待人工做什么"，是比 status 更有价值的待办指示，但列表页完全没利用。

## 设计目标

1. 类型列：后端 Parser 从目录结构自动推断，reparse 时写入 DB
2. 状态列：改为展示 human_gate 待办信息，无待办时展示阶段状态
3. 阶段列：null 时显示 "draft" badge
4. 影响组件列：后端 Parser 从 tasks.md 文件路径提取模块名

## 非目标

- 不修改 status 字段的写入逻辑（保持向后兼容）
- 不修改 Change 数据模型（不新增字段）
- 不修改前端表格列结构（保持 7 列布局）
- 不做影响组件的深度分析（只做文件路径 → 模块名的轻量匹配）

## 总体方案

### Wave 1：后端 Parser 增强

在 `_parse_change()` 方法末尾新增推断逻辑：

**1.1 类型推断**

```
_infer_change_type(change_dir: Path) -> str:
  - 有 tasks/ 子目录且有 (plan.md 或 design.md) → "feature"
  - 有 prototype-*.html 文件 → "prototype"
  - 目录名含 "quick" 或仅 MASTER.md + request.md（无 tasks/、无 design.md）→ "quick"
  - 默认 → "feature"
```

写入 `ParsedChange.change_type`。

**1.2 影响组件推断**

```
_infer_affected_components(change_dir: Path, sillyspec_root: Path) -> list[str]:
  - 读取 module-impact.md（如有，归档后的变更）→ 提取模块名
  - 否则读取 tasks.md + tasks/*.md → 提取文件路径
  - 文件路径匹配 _module-map.yaml 的 paths 规则 → 返回模块名列表
  - 无匹配 → 返回空列表
```

写入 `ParsedChange.affected_components`。

**1.3 reparse 传播**

修改 `ChangeService._apply_parsed()`：允许 reparse 覆盖 `change_type` 和 `affected_components`（当前代码注释说"DB 是唯一真实数据源，不要从文件系统覆盖"——这个策略需要反转，改为 Parser 推断值覆盖 DB）。

### Wave 2：前端展示优化

**2.1 状态列改造**

替换 `STATUS_COLORS[c.status]` 为新的 `human_gate` 展示逻辑：

```
GATE_LABELS = {
  need_proposal_review: { label: "待提案审核", color: "orange" },
  need_plan_review: { label: "待计划审核", color: "orange" },
  need_human_test: { label: "待人工测试", color: "orange" },
  need_archive_confirm: { label: "待归档确认", color: "orange" },
  blocked: { label: "阻塞中", color: "destructive" },
}

渲染逻辑：
  human_gate 不为空且不为 "none" → 显示 GATE_LABELS[human_gate]
  否则根据 current_stage 显示阶段状态（进行中/已完成/空闲）
```

**2.2 阶段列 null 兜底**

```
{(c.current_stage || "draft") && (...)}
```

将 null/undefined 统一显示为 "draft" badge。

**2.3 类型 Badge 颜色**

```
TYPE_STYLES = {
  feature: "blue",
  quick: "yellow",
  prototype: "purple",
}
```

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/change/parser.py` | 新增 `_infer_change_type()` 和 `_infer_affected_components()`，在 `_parse_change()` 末尾调用 |
| 修改 | `backend/app/modules/change/service.py` | `_apply_parsed()` 中添加 change_type 和 affected_components 的 reparse 覆盖 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx` | 状态列改用 human_gate 展示、阶段列 null 兜底、类型列颜色映射 |

## 接口定义

### Parser 新增方法

```python
# parser.py
@staticmethod
def _infer_change_type(change_dir: Path) -> str:
    """从目录结构推断变更类型。"""

@staticmethod
def _infer_affected_components(change_dir: Path, sillyspec_root: Path) -> list[str]:
    """从 tasks.md 文件路径提取影响的模块名。"""
```

### service.py 修改点

```python
# _apply_parsed() 中新增：
row.change_type = parsed.change_type
row.affected_components = parsed.affected_components
```

### 前端新增常量

```typescript
// page.tsx
const GATE_LABELS: Record<string, { label: string; color: string }> = { ... };
const TYPE_COLORS: Record<string, string> = { ... };
```

## 兼容策略

- **status 字段不变**：不修改 DB 中 status 的值，前端只是不再直接展示它
- **human_gate 为空或 "none" 时回退到阶段状态**：确保没有 human_gate 的变更也有合理展示
- **change_type 和 affected_components 允许为空**：Parser 推断失败时返回 "feature" / []，前端有空值兜底
- **_apply_parsed() 保留已有 DB 值的逻辑**：如果 parsed 值为 None/[]，不覆盖 DB 中已有的非空值

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | tasks.md 中文件路径格式不统一导致模块匹配失败 | P2 | 匹配失败时返回空列表，前端显示 "—"（与当前行为一致） |
| R-02 | reparse 覆盖 change_type 可能覆盖用户手动设置的值 | P1 | 只在 DB 值为 null 时覆盖，已有值不覆盖 |
| R-03 | module-map.yaml 路径模式匹配不够精确 | P2 | 使用前缀匹配（startswith），接受少量误匹配 |

## 自审

- **需求覆盖**：4 列问题全部覆盖
- **约束一致性**：Parser 改动在现有 _parse_change 流程内，不破坏已有逻辑
- **真实性**：所有文件路径、方法名、字段名来自实际代码
- **YAGNI**：没有添加额外列或字段
- **验收标准**：reparse 后类型列显示推断值、状态列显示 human_gate、阶段列无空白、影响组件显示模块名
- **兼容策略**：status 字段保留、human_gate 回退路径明确
