---
title: docs check/docs gate 改进建议
date: 2026-09-07
status: 建议（待 sillyspec 工具侧评估）
source: 1058→22 文档引用清理实践（2026-09-07）
---

# docs check / docs gate 改进建议

> 来源：multi-agent-platform 仓库 2026-09-07 文档失效引用清理实践。
> 清理前 1058 处失效（基线 0），清理后 22 处（基线 22），98% 减少。
> 过程中手动写了 4 个临时脚本（路径映射、上下文推断、批量替换），
> 以下建议是这些脚本逻辑的工具化提炼。

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
- 这一次改动就能消化约 160 处确定性修复 + 大部分歧义修复

### 3. `--suggest` 输出不够结构化

`--suggest` 是给人看的文字提示，`--json` 输出里有 `fix.fixable` 和 `fix.reason`，但没有 `fix.suggested_path` 或 `fix.candidates`。

**建议：`--json` 输出增加修复建议字段**

```json
{
  "ref": "model.py:26",
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

当前：`docs check` → 人工逐个修 → 再 `docs check` → 循环（实测跑了 6 轮 + 4 个临时脚本）。

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

---

## 二、流程层面改进

### 6. 门控应支持"仅增量"

当前门控比较"当前失效数 vs 基线"。存量债务（1058 处）远大于增量（0 处）时，门控会阻塞存量修复的提交过程。

**建议：`docs gate` 支持 `--delta-only` 模式**

```bash
sillyspec docs gate --delta-only   # 只检查 git diff 引入的新失效引用
```

本次 commit 没引入新的失效就放行，存量债务通过 `docs fix` 逐步消化。

### 7. `docs migrate` 命令用途不明

`docs --help` 有 `docs migrate` 子命令但无文档。如果有"批量路径迁移"能力（如 `docs migrate --from "modules/" --to "backend/app/modules/"`），这次至少省掉一半工作量。

**建议：** 补全 `docs migrate --help` 文档；如果没有批量重命名能力，这正是需要实现的。

---

## 三、优先级

| 优先级 | 改进项 | 预估收益 |
|:------:|--------|----------|
| **P0** | `--fix-paths`（路径启发式自动修复） | 一次消化 60%+ 债务 |
| **P0** | `--json` 输出增加 `candidates` 字段 | 让脚本批量消费 |
| **P1** | 文档类型标注（living/snapshot/scan） | 门控不再误拦历史文档 |
| **P1** | `docs fix` 交互式修复命令 | 替代 6 轮 check 循环 |
| **P2** | `docs gate --delta-only` | 增量门控不阻塞存量修复 |
| **P2** | 路径猜测引擎（上下文感知推断） | 处理歧义基名 |
| **P3** | `docs migrate` 文档补全 | 未知能力需明确 |

**核心思路：** 把手动清理中写的脚本逻辑（路径映射、上下文推断、批量替换）沉淀到工具里，下次遇到代码库重构时，`sillyspec docs fix --paths` 一条命令解决大部分问题。
