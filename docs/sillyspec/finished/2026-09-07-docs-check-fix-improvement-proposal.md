---
title: docs check/docs gate 改进建议
date: 2026-09-07
status: 建议（待 sillyspec 工具侧评估）
source: 1058→0 文档引用清理实践（2026-09-07）
---

# docs check / docs gate 改进建议

> 来源：multi-agent-platform 仓库 2026-09-07 文档失效引用清理实践。
> 清理前 1058 处失效，最终清零，docs gate 基线为 0。
> 过程中写了 4 个临时 Python 脚本，并动用 7 个子代理（4 个修历史审计文档 + 3 个收尾清理）。
> **核心教训：大部分修复工作是确定性操作，本可由 CLI 自动完成，实际却耗费了大量 agent 交互。**

**清理历程**（数字为每步之后剩余的失效引用数）：

| 步骤 | 手段 | 剩余 |
|------|------|-----:|
| 起点 | — | 1058 |
| ① `docs check --fix`（行号漂移重锚） | CLI 已有能力 | 1016 |
| ② 临时脚本批量路径映射 | 手写脚本 | 757 |
| ③ `docs check --fix` 二轮（路径修对后新暴露的行号漂移） | CLI 已有能力 | 596 |
| ④ 子代理修路径前缀与歧义基名 | 4 个代理并行 | 372 |
| ⑤ `docs check --fix` 三轮 | CLI 已有能力 | 251 |
| ⑥ 行号剥离（关键词已消失，去掉行号只留文件引用） | 手动 | 116 |
| ⑦ 歧义基名+前端路径修正 | 手动+代理 | 39 |
| ⑧ 最终清理（3 个代理：关键词重锚、工具解析 bug 绕过） | 3 个代理 | 0 |

`--fix` 三轮共消除 42+161+121 = 324 处（全过程最大单一手段），但每次都要等路径先修对才能继续暴露可修的漂移，被迫穿插在手动步骤之间跑了三轮。

---

## 核心问题：CLI 能力不足以替代 agent 操作

整个清理过程中，**最大痛点不是引用修复本身，而是 CLI 缺少批量自动化能力**，导致大量本应由工具完成的工作被 agent 手动执行：

| 实际做了什么 | 理想做法 | agent 消耗 |
|-------------|---------|-----------|
| 写 4 个临时 Python 脚本做路径映射 | `sillyspec docs fix` 一条命令 | 4 轮脚本编写+调试 |
| 7 个子代理逐个文件修引用 | `sillyspec docs fix` 批量修复 | 7 个代理、数十轮交互 |
| 手动 grep 找正确行号 | `--fix` 内置关键词重锚已覆盖 | 中间态残留需二次修复 |
| 手动检查 `(dashboard)` 路径 | 工具正确解析括号路径 | 2 轮排查误判 |

**agent 消耗总量估算**：约 50+ 轮交互、10+ 万 token，其中大部分用于本可由 CLI 自动完成的工作。

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

**关键设计：先修路径、再修行号，循环至收敛。** 本次实践中 `--fix` 被迫跑了三轮，原因就是路径修正后会暴露新的行号漂移；`docs fix` 内部应自动迭代"路径修复 → 行号重锚"直到没有新修复产生，一次命令完成。

**预期收益**：按本次实测数据推算——步骤 2a（324 处）+ 2b（路径映射 567 处中的确定性部分）可由 CLI 全自动完成，1058 处中约 80% 无需 agent 介入。

### 2. 路径自动推断引擎（替代临时脚本）

**当前痛点**：路径解析只做仓库根直匹配 + `src/` 递归，没有常见前缀推断。用户被迫手写约 150 条映射规则（`modules/` → `backend/app/modules/` 等）。

**建议：CLI 内置路径推断逻辑**，无需用户写脚本：

```
输入: "model.py 第 26 行"
推断过程:
  1. 精确匹配: 仓库根 model.py → 不存在
  2. 递归搜索: 找到 5 个 model.py
  3. 上下文推断: 文档上下文提到 "agent" → 优先 backend/app/modules/agent/model.py
  4. 置信度 ≥ 阈值 → 自动修复
  5. 置信度 < 阈值 → 标记歧义，列出候选
```

推断规则应内置在 CLI 中，不需要用户维护映射表。

### 3. 结构化修复报告（替代 agent 逐个确认）

**当前痛点**：`--json` 输出只有 `fix.fixable: false`，没有可操作的建议。

**建议：`docs fix --json` 输出修复计划**（以下为示意，数字取自本次实测规模）：

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
  - 中文顿号分隔的多路径引用: "path1 第 21 行、path2 第 63 行" → 正确拆分
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

本次清理中约一半的批量替换（路径前缀类，567 处中的大头）可用此命令完成。

---

## 三、做得好的地方（继续保持）

1. **`--fix` 行号漂移重锚**：三轮共自动修复 324 处，是全过程消除量最大的单一手段，核心逻辑（搜索关键词→重锚行号）是正确的
2. **`docs gate` 门控设计**：基线比对 + pre-push 拦截，有效阻止了新债的产生——如果没有这个门控，1058 处债不会被发现
3. **多命中歧义的保守默认**："严格落后才自动改"避免了误修，比激进自动改更安全
4. **JSON 输出格式**：`docs check --json` 的结构化输出让外部脚本可以批量消费

---

## 四、优先级

| 优先级 | 改进项 | 替代了什么 agent 操作 | 预估收益 |
|:------:|--------|---------------------|----------|
| **P0** | `docs fix` 一站式修复命令（含路径→行号循环收敛） | 4 个临时脚本 + 7 个子代理的大部分工作 | 一次消化约 80% 债务 |
| **P0** | 路径自动推断引擎 | 手写约 150 条映射规则 | 消除路径前缀类失效 |
| **P0** | 工具解析括号/省略号路径 | 手动排查误判 | 消除假阳性 |
| **P1** | 结构化修复报告（JSON 候选） | agent 逐个 grep 确认 | 歧义部分脚本化 |
| **P1** | 文档类型标注 | 无（减少门控噪音） | 历史文档不再拦截 |
| **P2** | `docs gate --delta-only` | 无（减少阻塞） | 存量修复不被阻塞 |
| **P2** | `docs migrate` 补全 | 批量替换脚本 | 重构场景一键迁移 |
| **P3** | 上下文置信度推断细化 | 歧义基名人工判别 | 减少歧义标记数 |

**核心思路：** 把清理过程中的确定性操作（路径映射、批量替换、行号重锚）全部沉淀为 CLI 命令能力，做到 `sillyspec docs fix` 一条命令解决约 80% 问题；剩余需要语意判断的部分（约 20%，如"文件已删除，该删引用还是改写描述"）以结构化 JSON 输出供脚本或人工批量决策，尽量避免逐条 agent 交互。

## 评审结论（2026-09-08，工具侧代码审查后）：摘三个便宜果子，重的两项暂缓

评审方对照 sillyspec 仓源码逐项复核（gate 为计数 ratchet：失效数 ≤ 基线即放行；resolveCandidates 按本生态 src/ 布局特化），结论比本提案的 P0 排序更保守。**核心理由：清零之后，P0 大包服务的"批量路径迁移连锁暴露行号漂移"是一次性事件而非稳态需求——基线 0 时任何新增失效即被 gate 拦截，日常只剩行号漂移，而 `--fix` 已覆盖（本次最大单一手段 324 处）。**

- **落实 ① 解析修复**（括号路径/省略号/顿号拆分，本提案 §一.4）：小 diff、消假阳性、零设计风险，所有被检仓永久受益。
- **落实 ② `docs migrate --from/--to`**（本提案 §二.7，**提至最前**）：清理中确定性大头是已知改名规则的前缀映射（`modules/` → `backend/app/modules/`），一条 migrate 即可替代临时脚本，不需要置信度推断；全提案性价比最高。
- **落实 ③ snapshot/archive 豁免**（本提案 §二.6）：归档文档引用天然过时，目录约定识别很便宜。
- **顺带做 ④ JSON 输出补 candidates 数组**（本提案 §一.3）：现有 `--json` 已有骨架，增量小。
- **暂缓 §一.1/§一.2（docs fix 一站式 + 路径推断引擎 + --interactive）**：真正需要推断的只是歧义 20%，那部分离不开人/agent 判断，JSON 候选已够；通用推断引擎还须先解决跨仓布局泛化（resolveCandidates 现为 src/ 布局特化），量级比提案预估大。等第二次批量事件真实发生再认领；有了 migrate 后"循环收敛"也就是 `migrate && check --fix` 两条链式命令。
- **可不做 §二.5（--delta-only）**：基线 0 时计数语义与逐条语义等价；它只在"非零基线 + 边清偿边引入新债"窗口期有增益，而 ratchet 机制本身已把存量问题解掉。
- **元考量（YAGNI）**：自用工具 + agent 干活生态下，"50+ 轮交互"的 agent 消耗是弹性成本——第二次痛之前不建机器。已另核实：sillyspec 仓在途的 `src/docs-check.js` 改动是 known_failures 提取加固，与本提案 8 项无关，目前尚无认领。
- **状态更新**：前四项可合开一个小 change（量级约一两天，不需单独立大设计）；本提案维持 backlog 活跃，重点跟踪 §一.1/§一.2 是否等到真实批量事件再启动。

## 认领对账（2026-09-08，工具侧实施）

评审结论五项已全部落地并归档（sillyspec change：`2026-09-08-docs-fix-capability`，commit 94c5eb0+6db00e8+归档提交，verify PASS）：

| 评审项 | 实现 | 实证 |
|--------|------|------|
| ① 解析修复 | REF_RE 展开循环形支持括号路径（`app/(dashboard)/x.tsx:21` 全量提取、markdown 链接零回归）；`...` 模糊路径 skippedFuzzy 跳过；顿号拆分测试锚定 | 单测 16/16；evil 用例 0ms（初稿原子序列形被 Design Grill 实证 ReDoS n=30→73.8s 否决，落 D-006） |
| ② docs migrate | `sillyspec docs migrate --from X --to Y [--apply]`：dry-run 默认零写盘、apply 复用 applyFixes、写盘后自动 docs check 复核、unverified 警示（防 from/to 写反） | 单测 6/6 + CLI 实测 |
| ③ 豁免双通道 | 路径段 archive/finished + frontmatter `doc_type: snapshot`，skippedExempt 计数，`--no-exempt` 可关 | CLI 实测；dogfood gate 0=基线 0 |
| ④ candidates JSON | `--json` fix 对象增 candidates（tie 歧义 {file,line}/带 / 路径文件不存在 {file}），机械数据无置信度 | --json 实测 |
| ⑤ stdout 出口（添头） | 非 JSON 报告内容统一 stdout、stderr 仅 ⚠️ 诊断与用法错误；--json/exit code 不变 | CLI 实测 stderr 0 行 |

未做项维持原判：§一.1/一.2（一站式+推断引擎）、§二.5（--delta-only）等第二次批量事件再认领。dogfood 附带实证：本变更自身引发 40 处行号漂移，`docs check --fix` 一把梭 39 处+人工 1 处——印证提案「--fix 是最大单一修复手段」判断。

## 巡检注记（2026-09-08 定时扫描）

- 定性：改进提案（状态「待 sillyspec 工具侧评估」），P0-P3 共 8 项能力建设——属工具 roadmap 认领制工作，非缺陷修复，定时巡检不代位实现（P0 的 `docs fix` 一站式命令 + 路径推断引擎是量级不小的特性开发，需设计取舍：置信度阈值、交互模式、门控语义）。
- 观察到 sillyspec 仓工作区当前有 `src/docs-check.js` 在途改动（另一会话）——可能与本提案部分项相关，待其提交后下轮巡检对账认领情况。
- 保持活跃，作为工具侧 backlog 清单跟踪。

- 2026-09-09 复核：认领对账已实证（sillyspec 仓 commit 94c5eb0 系列在 main，五项实现 + dogfood gate 0=基线 0 本轮再验证）；暂缓项（一站式 fix/推断引擎/--delta-only）维持「等第二次批量事件」裁决。本提案继续作为 backlog 跟踪文件活跃。
