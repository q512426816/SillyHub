---
proposed_at: 2026-11-03T02:05:18.751Z
category: known-issues
source: session-distill:2026-11-03-prompt-eval
status: pending_review
---

# knowledge propose 的 --body 含反引号或美元符时双引号传参静默损坏——单引号包裹

## 问题
sillyspec knowledge propose 仅支持命令行传 body（无 --body-file 或 stdin 通道）。提炼类 Markdown 正文几乎必含行内代码与路径：在 Git Bash 双引号串内，反引号触发命令替换、美元符触发变量展开、双引号直接截断参数——正文静默损坏落库，全程无报错。

## 解法
--body 一律用单引号包裹（单引号内反引号、美元符、双引号均为字面量）；正文确需 ASCII 单引号时按标准三段法（闭引号、转义引号、再开引号）处理或改写避开；中文正文天然低风险。写完可 head 落盘文件与原文比对抽查。

## 证据
- 本会话（2026-11-03）对知识沉淀提示词的评审结论；CLI 源码 knowledge 命令参数面（sillyspec 仓 v3.34.0）
- 本机实证：本批 5 条全部按单引号传参落盘成功（含反引号、美元符字样正文）

## 适用条件
POSIX shell / Git Bash 环境；PowerShell 转义规则不同需另行验证。

---
> This is a proposed knowledge entry. Review and merge into manual/ or generated/.