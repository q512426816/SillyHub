---
id: task-13
title: scan 文档同步（ARCHITECTURE/CONVENTIONS 更新 transport 双模式）（覆盖：SC-1）
priority: P2
estimated_hours: 1
depends_on: [task-12]
blocks: []
requirement_ids: []
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - .sillyspec/docs/multi-agent-platform/scan/ARCHITECTURE.md
  - .sillyspec/docs/multi-agent-platform/scan/CONVENTIONS.md
author: qinyi
created_at: 2026-06-23 11:20:01
---

# task-13 scan 文档同步（ARCHITECTURE/CONVENTIONS 更新 transport 双模式）

> 归档前同步：本任务在 task-12 端到端验证通过后执行，确保 scan 文档与代码一致，
> 为 `sillyspec archive` 前置条件。纯文档任务，无产品代码改动。

## 覆盖来源

- **验收标准**：SC-1（`SPEC_TRANSPORT` 未配置默认 shared 时现有同机 scan 行为不变；
  双模式文档同步反映该不变性 + tar 新机制）
- **决策**：D-001@v1（transport 正交于 strategy，走全局 config 不入库）、
  D-002@v1（全局环境变量 `SPEC_TRANSPORT=shared|tar`，默认 shared）

## 修改文件（2 个 scan 文档）

1. `.sillyspec/docs/multi-agent-platform/scan/ARCHITECTURE.md`
2. `.sillyspec/docs/multi-agent-platform/scan/CONVENTIONS.md`

> 不修改 `.sillyspec/docs/multi-agent-platform/scan/modules/*.md`（模块级文档由
> `sillyspec archive` 阶段统一同步），不重写整个 scan 文档（增量补充段落）。

## 依据文档

- `design.md` §5 总体方案（§5.0 核心机制 / §5.1 shared / §5.2 tar）+ §13 Design Grill
- `decisions.md` D-001@v1 / D-002@v1
- `plan.md` 全局验收标准 SC-1 / 覆盖矩阵

## 实现要求

### R1：ARCHITECTURE.md 部署拓扑段补 transport 双模式

**插入点**：`## 部署拓扑（deploy/）` 段（当前行 74-93 描述 backend 关键挂载与配置，
其中第 88 行 `${SPEC_DATA_HOST_DIR}:/data/spec-workspaces` bind mount 描述）。
在该段末尾（行 93 之后、`### 开发` 子段之前）新增 `#### spec 文档 transport 双模式`
子段，**保留**现有 bind mount 描述（R-保留-1），**补充而非覆盖**（R-保留-2）。

**新增段落大纲**：

```
#### spec 文档 transport 双模式（SPEC_TRANSPORT）

scan / propose / plan / execute 等 spec 写盘 stage 生成的 spec 文档在 daemon 与
backend 间的同步路径由全局环境变量 `SPEC_TRANSPORT` 决定（D-001: 正交于
SpecWorkspace.strategy；D-002: 不入库，走 Settings.spec_transport）：

- **shared（默认，同机拓扑）**：依赖本段上方描述的 bind mount
  （`${SPEC_DATA_HOST_DIR}:/data/spec-workspaces`）。daemon 把 spec 写到宿主路径
  `spec_data_host_dir/{ws}`，backend 经 bind mount 看到同一物理目录 reparse 入库。
  无 pull / 无回传，零额外机制。向后兼容现有同机部署（D-004）。

- **tar（异机拓扑，daemon 与 backend 两台独立设备无共享盘）**：bind mount 失效，
  走整树 tar 回传（D-003 双向同步）：
  1. lease interactive claim：backend `build_claim_payload` 不透传 spec_root，
     透传 workspace_id + transport。
  2. daemon `_startInteractiveSession`：session 创建后 `pullSpecBundle` 拉 backend
     spec bundle 解到本地 `~/.sillyhub/daemon/specs/{ws}`（缓存，首次 404 容错为空目录）。
  3. prompt `--spec-root` 用 daemon 本地路径；agent 跑 scan/stage 文档写本地缓存。
  4. daemon `onSessionEnd`：session 终态回调 `postSpecSync` 打 tar 整树回传 backend。
  5. backend `apply_sync`：解 tar 到权威源容器 `/data/{ws}` + reparse 入库。
  6. daemon 本地缓存保留（D-003），下次 lease 覆盖。

backend 是唯一真理源（G2）：shared 靠 bind mount 天然一致，tar 靠 apply_sync 整树
覆盖（whole-tree overwrite）保证 `/data/{ws}` 为权威副本。

**已知约束**：全局单一 transport，同一 backend 不能同时服务同机 + 异机 daemon
（R-04 / N1；未来需升级为 per-daemon transport 才能混部）。
```

### R2：CONVENTIONS.md 补 SPEC_TRANSPORT 约定

**插入点**：`## 目录约定` 段（当前行 53-63）。在该段末尾（行 63 之后、`## 已知陷阱`
之前）新增 `### 环境变量约定` 子段。**不改动**现有目录约定条目（R-保留-1）。

**新增段落大纲**：

```
### 环境变量约定

- **SPEC_TRANSPORT**（enum `shared|tar`，默认 `shared`）：spec 文档在 daemon 与
  backend 间的同步模式（D-001: 正交于 SpecWorkspace.strategy，不入库；D-002: 全局
  开关）。读自 backend `Settings.spec_transport`，`field_validator` 规范化（小写 +
  枚举校验）。
  - `shared`（默认）：同机部署，靠 Docker bind mount 共享物理盘，向后兼容现有拓扑。
  - `tar`：异机部署，daemon 与 backend 两台独立设备无共享盘时，spec 文档整树 tar
    回传到 backend 权威源 `/data/{ws}`。
  - 切换 transport 不做历史 spec 数据迁移（CLAUDE.md 规则7，数据可清；D-005）：
    清空 `SPEC_TRANSPORT`（回退 shared）+ 重新 scan 即可。
  - 与 `SPEC_DATA_HOST_DIR` 关系：shared 模式下两者配合（host dir ↔ 容器 bind mount）；
    tar 模式下 `SPEC_DATA_HOST_DIR` 仍指向 backend 权威源宿主路径，但 daemon 侧不再
    依赖它（改用本地 `~/.sillyhub/daemon/specs/{ws}` 缓存）。
```

## 接口定义（文档段落大纲）

| 文件 | 新增子段 | 插入位置 | 大纲要点 |
|---|---|---|---|
| ARCHITECTURE.md | `#### spec 文档 transport 双模式（SPEC_TRANSPORT）` | 部署拓扑段末尾（行 93 后） | shared 现状引用 + tar 六步机制 + backend 独占 + 混部约束 |
| CONVENTIONS.md | `### 环境变量约定` | 目录约定段末尾（行 63 后） | SPEC_TRANSPORT 枚举/默认 + 双模式语义 + 与 SPEC_DATA_HOST_DIR 关系 + 不迁移 |

## 边界处理

1. **保留现有 bind mount 描述**：ARCHITECTURE.md 行 88 `${SPEC_DATA_HOST_DIR}:/data/spec-workspaces`
   bind mount 行**不删不改**，transport 段落作为「双模式说明」补充在其后，明确 shared
   模式即复用该 bind mount（R-保留-1，SC-1 shared 不变性的文档体现）。
2. **补充而非覆盖**：CONVENTIONS.md 现有目录约定条目（行 55-63）全部保留，仅追加
   环境变量子段；不重写已 scan 的部署/约定内容（R-保留-2）。
3. **transport 不入库说明**：CONVENTIONS.md 明确写「不入库，走 Settings.spec_transport」，
   防止后续读者误以为要加表字段（D-001 核心要点，对应 design §8 无表结构变更）。
4. **shared 默认向后兼容**：两处文档均显式标注「默认 shared，向后兼容现有同机部署」，
   呼应 SC-1（未配置 `SPEC_TRANSPORT` 时行为不变）与 D-004（shared 保持现状）。
5. **与 design §5 一致**：tar 模式六步机制严格对照 design §5.2（claim→pull→prompt→
   onSessionEnd sync→apply_sync→缓存保留），不引入 design 外的新机制或措辞偏差。
6. **决策 ID 标注**：文档段落内引用决策时用 `(D-001)` / `(D-002)` / `(D-003)` /
   `(D-004)` / `(D-005)` 内联标注，确保 scan 文档可回溯到 decisions.md。
7. **不动模块文档**：`.sillyspec/docs/multi-agent-platform/scan/modules/*.md`（如
   spec_workspace / agent / daemon 模块文档）不在本 task 范围，归档阶段由
   `sillyspec archive` 统一同步模块级影响（避免重复劳动 + 保证 archive 一致性）。

## 非目标

- 不改任何产品代码（backend / daemon / frontend）——纯文档任务。
- 不改 `.sillyspec/docs/multi-agent-platform/scan/modules/*.md` 模块文档——归档时统一。
- 不重写整个 scan 文档（ARCHITECTURE.md / CONVENTIONS.md 其余段落保持原样）。
- 不补 ROADMAP 或变更工作区内文档（proposal/design/plan/decisions 已成型）。
- 不更新 `docs/` 下的项目级设计文档（非 scan 范围）。

## 参考

- design §5.0（核心机制 X-001 修正后）/ §5.1（shared 现状）/ §5.2（tar 六步）/ §7.4（生命周期契约表）
- decisions D-001@v1（transport 正交 strategy 不入库）/ D-002@v1（全局 env 默认 shared）/ D-003@v1（双向同步）/ D-004@v1（shared 现状）/ D-005@v1（不迁移）
- plan SC-1（shared 不变）/ 覆盖矩阵
- 现有 ARCHITECTURE.md 行 74-93（部署拓扑 + bind mount）/ CONVENTIONS.md 行 53-63（目录约定）

## TDD

本任务为纯文档同步，无产品代码、无单元测试。验收方式为**对照 design 一致性人工审查**：
- ARCHITECTURE.md transport 段落六步机制与 design §5.2 逐步对应（无遗漏/无多余）。
- CONVENTIONS.md 环境变量段落枚举/默认值/与 SPEC_DATA_HOST_DIR 关系与 design §5/§9 一致。
- 决策标注（D-001~D-005）在文档中准确反映 decisions.md 语义。

## 验收

| 编号 | 验收项 | 通过标准 |
|---|---|---|
| AC-1 | ARCHITECTURE.md 新增 `#### spec 文档 transport 双模式（SPEC_TRANSPORT）` 子段 | 段落存在于部署拓扑段；含 shared（bind mount 引用）+ tar（六步机制）双模式；标注 backend 独占 + 混部约束 |
| AC-2 | CONVENTIONS.md 新增 `### 环境变量约定` 子段 | 含 `SPEC_TRANSPORT` enum `shared\|tar` 默认 shared；含不入库说明（D-001）；含与 `SPEC_DATA_HOST_DIR` 关系；含不迁移说明（D-005） |
| AC-3 | 现有 bind mount 描述保留 | ARCHITECTURE.md 行 88 `${SPEC_DATA_HOST_DIR}:/data/spec-workspaces` 行原样保留，未被删除或改写 |
| AC-4 | 现有目录约定保留 | CONVENTIONS.md 行 55-63 目录约定条目原样保留，未被覆盖 |
| AC-5 | 与 design §5 一致 | tar 六步机制（claim→pull→prompt→onSessionEnd sync→apply_sync→缓存）与 design §5.2 逐步对应，无机制偏差 |
| AC-6 | 决策标注准确 | 文档中 D-001/D-002（本 task frontmatter decision_ids）及引用的 D-003/D-004/D-005 语义与 decisions.md 一致 |
| AC-7 | SC-1 体现 | 两处文档显式标注「默认 shared，向后兼容」，呼应 SC-1（未配置 SPEC_TRANSPORT 时现有同机 scan 行为不变） |
| AC-8 | 无产品代码改动 | `git diff --stat` 仅含 2 个 `.sillyspec/docs/.../scan/*.md` 文件，无 backend/daemon/frontend 代码变更 |
| AC-9 | 不触碰模块文档 | `.sillyspec/docs/multi-agent-platform/scan/modules/` 下文件无改动（归档阶段统一同步） |
| AC-10 | 归档前时机 | task-12 端到端验证通过后执行，文档反映已验证的最终架构（非 speculative） |
