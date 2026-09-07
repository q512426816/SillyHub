---
title: docs check/docs gate 改进建议
date: 2026-09-07
status: 建议（待 sillyspec 工具侧评估）
source: 1058→0 文档引用清理实践（2026-09-07）
---

# docs check / docs gate 改进建议

> 来源：multi-agent-platform 仓库 2026-09-07 文档失效引用清理实践。
> 清理前 1058 处失效（基线 0），最终清零（基线 0），100% 消除。
> 过程中写了 4 个临时脚本 + 3 个子代理并行修复（路径映射、上下文推断、批量替换），
> 以下建议是这些脚本逻辑的工具化提炼。
>
> **清理历程**：1058 → 1016（`--fix` 42 处）→ 757（批量路径映射 567 处）→ 596（`--fix` 161 处）
> → 372（子代理 4 组并行修路径前缀+歧义基名）→ 251（`--fix` 121 处）→ 116（行号剥离 132 处）
> → 39（歧义基名+路径修正）→ 22（前端路径修正+member_runtimes 路径）→ 0（关键词重锚+工具解析 bug 绕过）

---

## 一、核心能力短板

### 1. 路径解析过于刚性

`docs check` 文件解析只做仓库根直匹配 + `src/` 递归搜索。实际 994 处"文件不存在"中，52 种唯一路径（159 处引用）只是缺了 `backend/app/modules/` 或 `sillyhub-daemon/src/` 前缀——属于**系统性重构遗留**，工具完全有能力自动识别但没有做。

**建议：增加路径启发式解析层**

```
docs check 的文件解析应尝试常见前缀：
  bare "model.py" → 递归搜索 → 在展示时提示
    "找到 5 个 model.py，按上下文推断最可能的是 backend/app/modules/agent/model.py"
```

不是猜，而是给出候选列表 + 上下文匹配评分，让 `--fix` 能自动选择最高置信度的那个。手动维护的 `MODULE_PREFIX_MAP`（约 150 条规则）完全可以沉淀为工具内置的"路径猜测引擎"。

### 2. 缺少 `--fix-paths` 模式

`--fix` 只处理"文件存在但行号漂移"。**最大的债务是路径前缀缺失**（994/1058），工具对此无能为力。

**建议：新增 `docs check --fix-paths` 子模式**

- 自动识别"文件不存在但加前缀后存在"的情况（高置信度）→ 直接修复
- 对歧义情况（如 `model.py` 存在于 5 个模块）给出候选列表，让用户选择或通过上下文自动判别
- 这一次改动就能消化约 160 处确定性修复；歧义部分（如 `model.py` 存在于 5 个模块）仍需人工判别，工具可做的是缩小候选范围

### 3. `--suggest` 输出不够结构化

`--suggest` 是给人看的文字提示，`--json` 输出里有 `fix.fixable` 和 `fix.reason`，但没有 `fix.suggested_path` 或 `fix.candidates`。

**建议：`--json` 输出增加修复建议字段**

```json
{
  "ref": "model.py 第 26 行",
  "reason": "文件不存在",
  "fix": {
    "fixable": true,
    "candidates": [
      {"path": "backend/app/modules/agent/model.py", "confidence": 0.85, "reason": "上下文提到 agent"},
      {"path": "backend/app/modules/daemon/model.py", "confidence": 0.6, "reason": "同模块高频"}
    ]
  }
}
```

有了结构化输出，调用方就能写脚本批量消费，而不是逐个 Read→grep→判断。

### 4. 没有区分文档类型

`docs check` 对所有 `.md` 一视同仁。但实际有三类：

| 类型 | 特征 | 应有行为 |
|------|------|---------|
| **living** | `architecture-4a.md` 等活文档 | 严格校验，门控计算 |
| **snapshot** | 带日期戳的审计报告 | 引用过时是正常的，不计入门控 |
| **scan** | `.sillyspec/docs/*/scan/` 自动生成 | 可通过 `--force-rescan` 整体重生 |

**建议：**

```bash
# 文档类型标注（frontmatter 或目录约定）
docs check --include "living"        # 只检查活文档
docs check --exclude "snapshot"      # 排除历史快照
docs check --exclude "scan"          # 排除自动生成文档
```

或在文档 frontmatter 中标注 `doc_type: living | snapshot | scan`，门控只计算 `living` 类型。

### 5. 缺少批量修复工作流

当前：`docs check` → 人工逐个修 → 再 `docs check` → 循环（实测跑了 6 轮 + 4 个临时脚本 + 3 个子代理）。

**建议：新增 `docs fix` 命令**

```bash
sillyspec docs fix                    # 自动修复所有高置信度问题
sillyspec docs fix --interactive      # 逐个确认歧义问题
sillyspec docs fix --dry-run          # 预览修复内容
```

内部流程：
1. `--fix` 处理行号漂移
2. 路径启发式处理文件不存在
3. 对低置信度的交互确认
4. 输出修复报告

### 6. 工具解析局限（括号/省略号路径）

`docs check` 无法解析路径中的 `(...)`（如 `frontend/src/app/(dashboard)/ppm/shared.tsx`）和 `...` 省略号（如 `frontend/app/api/.../stream/route.ts`）。前者被截断为 `/ppm/shared.tsx`，后者被当成不完整路径。清理中约 6 处因此类解析 bug 误判为失效。

**建议：**
- 支持 Next.js App Router 的 `(group)` 路由组括号语法
- 对 `...` 省略号路径，标记为"模糊引用"而非"文件不存在"，或者直接跳过校验

---

## 二、流程层面改进

### 7. 门控应支持"仅增量"

当前门控比较"当前失效数 vs 基线"。存量债务（1058 处）远大于增量（0 处）时，门控会阻塞存量修复的提交过程。

**建议：`docs gate` 支持 `--delta-only` 模式**

```bash
sillyspec docs gate --delta-only   # 只检查 git diff 引入的新失效引用
```

本次 commit 没引入新的失效就放行，存量债务通过 `docs fix` 逐步消化。

### 8. `docs migrate` 命令用途不明

`docs --help` 有 `docs migrate` 子命令但无文档。如果有"批量路径迁移"能力（如 `docs migrate --from "modules/" --to "backend/app/modules/"`），这次至少省掉一半工作量。

**建议：** 补全 `docs migrate --help` 文档；如果没有批量重命名能力，这正是需要实现的。

---

## 三、做得好的地方（继续保持）

1. **`--fix` 行号漂移重锚**：自动修复了 163+121=284 处行号漂移，核心逻辑（搜索关键词→重锚行号）是正确的
2. **`docs gate` 门控设计**：基线比对 + pre-push 拦截，有效阻止了新债的产生——如果没有这个门控，1058 处债不会被发现
3. **多命中歧义的保守默认**："严格落后才自动改"避免了误修，比激进自动改更安全
4. **JSON 输出格式**：`docs check --json` 的结构化输出让外部脚本可以批量消费，这是自动化修复的基础

---

## 四、优先级

| 优先级 | 改进项 | 预估收益 |
|:------:|--------|----------|
| **P0** | `--fix-paths`（路径启发式自动修复） | 一次消化 ~160 处确定性修复 |
| **P0** | `--json` 输出增加 `candidates` 字段 | 让脚本批量消费 |
| **P0** | 工具解析括号/省略号路径 | 消除误判，避免"修不掉的失效" |
| **P1** | 文档类型标注（living/snapshot/scan） | 门控不再误拦历史文档 |
| **P1** | `docs fix` 交互式修复命令 | 替代 6 轮 check 循环 |
| **P2** | `docs gate --delta-only` | 增量门控不阻塞存量修复 |
| **P2** | 路径猜测引擎（上下文感知推断） | 处理歧义基名 |
| **P3** | `docs migrate` 文档补全 | 未知能力需明确 |

**核心思路：** 把手动清理中写的脚本逻辑（路径映射、上下文推断、批量替换）沉淀到工具里，下次遇到代码库重构时，`sillyspec docs fix` 一条命令解决大部分问题。
