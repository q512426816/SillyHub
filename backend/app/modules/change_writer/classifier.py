"""变更类型自动分类器（ql-20260812-006）。

根据需求描述关键词推导 change_type：feature / quick / prototype。
参考 sillyspec classify-change.js 逻辑，简化为三类（对齐前端 TYPE_LABEL）。
"""

from __future__ import annotations

import re

# 快速修复类关键词（中英文）
_QUICK_PATTERNS = [
    r"改文案|更新文案|文案修改",
    r"样式调整|style.*tweak|UI.*微调",
    r"fix typo|typo.*fix",
    r"快速修复|quick.*fix|hotfix",
    r"小修|minor.*fix",
]

# 原型/探索类关键词
_PROTOTYPE_PATTERNS = [
    r"原型|prototype|POC|proof.*of.*concept",
    r"实验|experiment|尝试|try.*out",
    r"demo|演示",
    r"探索|explore",
    r"调研|research|investigate",
]


def classify_change_type(description: str) -> str:
    """根据需求描述推导变更类型。

    Args:
        description: 用户需求描述文本

    Returns:
        "quick" | "prototype" | "feature"（默认 feature）

    规则：
    - 命中 quick 关键词 → "quick"
    - 命中 prototype 关键词 → "prototype"
    - 否则 → "feature"（默认，对齐前端 TYPE_LABEL）
    """
    desc_lower = description.lower()

    # quick 优先（快速修复类最常见且最明确）
    for pattern in _QUICK_PATTERNS:
        if re.search(pattern, desc_lower, re.IGNORECASE):
            return "quick"

    # prototype 其次
    for pattern in _PROTOTYPE_PATTERNS:
        if re.search(pattern, desc_lower, re.IGNORECASE):
            return "prototype"

    # 默认 feature（功能开发）
    return "feature"
