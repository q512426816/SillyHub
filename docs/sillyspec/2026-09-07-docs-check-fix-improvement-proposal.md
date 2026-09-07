---
title: docs check/docs gate 改进建议
date: 2026-09-07
status: 建议（待 sillyspec 工具侧评估）
source: 1058→0 文档引用清理实践（2026-09-07）
---

# docs check / docs gate 改进建议

> 来源：multi-agent-platform 仓库 2026-09-07 文档失效引用清理实践。
> 清理前 1058 处失效（基线 0），最终清零（基线 0），100% 消除。
> 过程中写了 4 个临时脚本 + 3 个子代理并行修复（路径映射、上下文推断、批量替换）。
> **核心教训：本可用一条 CLI 命令解决的事，实际耗费了大量 agent 交互轮次。**
>
> **清理历程**：1058 → 1016（`--fix` 42 处）→ 757（批量路径映射 567 处）→ 596（`--fix` 161 处）
> → 372（子代理 4 组并行修路径前缀+歧义基名）→ 251（`--fix` 121 处）→ 116（行号剥离 132 处）
> → 39（歧义基名+路径修正）→ 22（前端路径修正+member_runtimes 路径）→ 0（关键词重锚+工具解析 bug 绕过）

---

## 核心问题：CLI 能力不足以替代 agent 操作

整个清理过程中，**最大痛点不是引用修复本身，而是 CLI 缺少批量自动化能力**，导致大量本应由工具完成的工作被 agent 手动执行：

| 实际做了什么 | 理想做法 | agent 消耗 |
|-------------|---------|-----------|
| 写 4 个临时 Python 脚本做路径映射 | `sillyspec docs fix --paths` 一条命令 | 4 轮脚本编写+调试 |
| 3 个子代理逐个文件修引用 | `sillyspec docs fix --all` 批量修复 | 3 个代理 × 20+ 轮交互 |
| 手动 grep 找正确行号 | `--fix` 内置关键词重锚已覆盖 | 中间态残留需二次修复 |
| 手动检查 `(dashboard)` 路径 | 工具正确解析括号路径 | 2 轮排查误判 |

**agent 消耗总量估算**：约 50+ 轮交互、10+ 万 token，全部用于本可由 CLI 自动完成的工作。

---

## 一、CLI 能力建设（替代 agent 操作）

### 1. `docs fix` 一站式修复命令

**当前痛点**：`docs check --fix` 只处理行号漂移，路径修复完全空白。用户被迫写脚本或手动修。

**建议：新增 `sillyspec docs fix` 命令**，串联所有修复能力：

```bash
# 一条命令完成全部自动修复
sillyspec docs fix                    # 路径修复 + 行号重锚 + 歧义标记

# 只预览不修改
sillyspec docs fix --dry-run          # 输出修复计划，不写文件

# 只修复路径问题
sillyspec docs fix --paths            # 只处理"文件不存在"的路径修复

# 只修复行号漂移
sillyspec docs fix --lines            # 只处理关键词漂移的行号重锚

# 交互模式处理歧义
sillyspec docs fix --interactive      # 对歧义引用逐个确认
```

**内部流程**（全部由 CLI 自动完成，无需 agent）：

```
1. 扫描所有 .md 文件提取引用
2. 分类：
   a. 文件存在 + 行号漂移 → 关键词重锚（现有 --fix 逻辑）
   b. 文件不存在 + 加前缀后存在 → 自动路径修复（新增）
   c. 文件不存在 + 多个候选 → 标记歧义，交互确认（新增）
   d. 文件不存在 + 无候选 → 标记待人工，跳过（新增）
3. 批量写回修改后的文件
4. 输出修复报告（修复数/跳过数/待人工数）
```

**预期收益**：本次清理中步骤 2b（159 处）+ 2c（686 处中的高置信度部分）完全自动化，步骤 2a（284 处）已有 `--fix` 覆盖。1058 处中约 80% 无需 agent 介入。

### 2. 路径自动推断引擎（替代临时脚本）

**当前痛点**：路径解析只做仓库根直匹配，没有常见前缀推断。用户被迫维护 `MODULE_PREFIX_MAP`（150 条手动规则）。

**建议：CLI 内置路径推断逻辑**，无需用户写脚本：

```
输入: "model.py 第 26 行"
推断过程:
  1. 精确匹配: 仓库根 model.py → 不存在
  2. 递归搜索: 找到 5 个 model.py
  3. 上下文推断: 文档上下文提到 "agent" → 优先 backend/app/modules/agent/model.py
  4. 置信度 > 0.8 → 自动修复
  5. 置信度 < 0.8 → 标记歧义，列出候选
```

推断规则应内置在 CLI 中，不需要用户维护映射表。

### 3. 结构化修复报告（替代 agent 逐个确认）

**当前痛点**：`--json` 输出只有 `fix.fixable: false`，没有可操作的建议。

**建议：`docs fix --json` 输出修复计划**：

```json
{
  "summary": {
    "total_refs": 1058,
    "auto_fixed": 847,
    "ambiguous": 180,
    "manual_needed": 31
  },
  "auto_fixed": [
    {
      "doc": "docs/architecture-4a.md",
      "docLine": 75,
      "old_ref": "model.py 第 26 行",
      "new_ref": "backend/app/modules/agent/model.py 第 26 行",
      "fix_type": "path_prefix",
      "confidence": 0.95
    }
  ],
  "ambiguous": [
    {
      "doc": "docs/architecture-4a.md",
      "docLine": 211,
      "ref": "service.py 第 361 行",
      "candidates": [
        {"path": "backend/app/modules/agent/service.py", "confidence": 0.85, "context_match": "agent 编排"},
        {"path": "backend/app/modules/daemon/service.py", "confidence": 0.6, "context_match": "daemon"}
      ],
      "needs_input": true
    }
  ]
}
```

**预期收益**：歧义部分不再是"待人工"的死胡同，而是结构化的决策点，脚本或简单确认即可批量处理。

### 4. 工具解析完善（消除误判）

**当前痛点**：约 6 处"修不掉的失效"是工具解析 bug 导致的，不是真正的引用问题。

**建议：**

```
支持的语法:
  - Next.js App Router 路由组: frontend/src/app/(dashboard)/ppm/shared.tsx
  - 路径省略号: frontend/app/api/.../stream/route.ts → 标记为"模糊引用"，跳过校验
  - 中文逗号分隔的多路径引用: "path1:21、path2:63" → 正确拆分
```

**预期收益**：消除误判，避免"文档是对的但工具报错"的假阳性。

---

## 二、流程改进（减少 agent 轮次）

### 5. 门控应支持"仅增量"

**当前痛点**：存量债务 1058 处时，门控阻塞所有提交，迫使一次性修复或重置基线。

**建议：`docs gate` 支持 `--delta-only` 模式**

```bash
sillyspec docs gate --delta-only   # 只检查 git diff 引入的新失效引用
```

存量债务通过 `docs fix` 逐步消化，新增债务立即拦截。

### 6. 文档类型标注（减少门控噪音）

**当前痛点**：历史审计报告的引用过时是正常的，但门控一律拦截。

**建议：**

```bash
# 在文档 frontmatter 标注类型
---
doc_type: snapshot   # 历史快照，不计入门控
---

# 或目录约定
docs/archive/**/*.md  → 自动识别为 snapshot，不校验
.sillyspec/docs/*/scan/*.md  → 自动识别为 scan，可用 --force-rescan 重生
```

### 7. `docs migrate` 能力补全

`docs --help` 有 `docs migrate` 但无文档。如果支持批量路径迁移：

```bash
sillyspec docs migrate --from "modules/" --to "backend/app/modules/"
```

本次清理中至少一半的批量替换可用此命令完成。

---

## 三、做得好的地方（继续保持）

1. **`--fix` 行号漂移重锚**：自动修复了 163+121=284 处行号漂移，核心逻辑（搜索关键词→重锚行号）是正确的
2. **`docs gate` 门控设计**：基线比对 + pre-push 拦截，有效阻止了新债的产生——如果没有这个门控，1058 处债不会被发现
3. **多命中歧义的保守默认**："严格落后才自动改"避免了误修，比激进自动改更安全
4. **JSON 输出格式**：`docs check --json` 的结构化输出让外部脚本可以批量消费

---

## 四、优先级

| 优先级 | 改进项 | 替代了什么 agent 操作 | 预估收益 |
|:------:|--------|---------------------|----------|
| **P0** | `docs fix` 一站式修复命令 | 4 个临时脚本 + 3 个子代理 | 一次消化 80% 债务 |
| **P0** | 路径自动推断引擎 | 手动维护 150 条映射规则 | 消除路径前缀类失效 |
| **P0** | 工具解析括号/省略号路径 | 手动排查误判 | 消除假阳性 |
| **P1** | 结构化修复报告（JSON 候选） | agent 逐个 grep 确认 | 歧义部分脚本化 |
| **P1** | 文档类型标注 | 无（减少门控噪音） | 历史文档不再拦截 |
| **P2** | `docs gate --delta-only` | 无（减少阻塞） | 存量修复不被阻塞 |
| **P2** | `docs migrate` 补全 | 批量 sed 替换 | 重构场景一键迁移 |
| **P3** | 路径猜测引擎上下文推断 | 歧义基名人工判别 | 减少歧义标记数 |

**核心思路：** 把清理过程中所有 agent 手动操作（写脚本、逐个 grep、批量替换、确认歧义）全部沉淀为 CLI 命令能力，做到 `sillyspec docs fix` 一条命令解决 80% 问题，剩余 20% 以结构化 JSON 输出供脚本消费，零 agent 交互。
