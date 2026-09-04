"""caps 三端对齐守护测试（源文件读取式，R-04）。

守护意图：ProviderCaps 能力矩阵有三份表源——daemon 单源
``sillyhub-daemon/src/interactive/providers.ts``、backend 镜像
``app/modules/agent/provider_caps.py``（本测试直接 import）、frontend 镜像
``frontend/src/lib/provider-caps.ts``。手工镜像天然会漂移（R-04），本测试
**读取 TS 表源文件解析出表**与 Python 表比对（先例：backend
tests/modules/agent/test_tool_kind.py 的双端共享用例——那是复制用例值，
本机制为其扩展：不复制值，直接读源），任一端键集合 / provider 集合 /
取值漂移即失败。

修改 caps 取值的正确顺序：先改 daemon 单源（含依据锚点注释），再同步
backend / frontend 两端镜像，然后本测试全绿。

路径解析：测试文件位于 ``backend/app/modules/agent/tests/``，向上 6 级
parents 定位仓库根（tests → agent → modules → app → backend → 仓库根），
表源路径相对仓库根拼接（worktree 内运行时读到的即本 worktree 的表源）。
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.modules.agent.provider_caps import PROVIDER_CAPS, get_provider_caps

# 仓库根（见模块 docstring 的定位说明）。
_REPO_ROOT = Path(__file__).resolve().parents[5]

# 三端表源路径（daemon = 唯一维护源）。
_DAEMON_TABLE_PATH = _REPO_ROOT / "sillyhub-daemon" / "src" / "interactive" / "providers.ts"
_FRONTEND_TABLE_PATH = _REPO_ROOT / "frontend" / "src" / "lib" / "provider-caps.ts"

# 契约键（design §5.2 ProviderCaps 8 键；task-02 provides 契约字段）。
EXPECTED_CAPS_KEYS: frozenset[str] = frozenset(
    {
        "resume",
        "mcp",
        "multimodal",
        "thinking",
        "subagent",
        "permission_dialog",
        "edit_patch",
        "model_select",
    }
)

# 契约 provider（现状交互式 driver 全集；新 provider 接入时三端同加。
# pi 由 2026-09-04-provider-pi-onboarding task-04 接入）。
EXPECTED_PROVIDERS: frozenset[str] = frozenset({"claude", "codex", "pi"})

# TS 表源解析：provider 条目块（`claude: { ... }`）与块内布尔键值对。
_TS_PROVIDER_BLOCK_RE = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{([^{}]*)\}")
_TS_BOOL_PAIR_RE = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(true|false)\b")


def _strip_ts_comments(text: str) -> str:
    """剥离 /* */ 块注释与 // 行注释（取值依据锚点写在注释里，不参与解析）。"""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", text)


def _extract_ts_const_object_body(text: str, const_name: str) -> str:
    """提取 ``const_name ... = { ... }`` 对象字面量正文（花括号配平，取首个匹配）。"""
    opener = re.search(re.escape(const_name) + r"[^=]*=\s*\{", text)
    assert opener is not None, f"未找到常量声明: {const_name}"
    start = opener.end()
    depth = 1
    i = start
    while i < len(text) and depth > 0:
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        i += 1
    assert depth == 0, f"常量 {const_name} 对象字面量花括号不配平"
    return text[start : i - 1]


def _parse_ts_caps_table(path: Path) -> dict[str, dict[str, bool]]:
    """解析 TS 表源为 {provider: {key: bool}}（手写解析，不引 TS 运行时依赖）。"""
    text = _strip_ts_comments(path.read_text(encoding="utf-8"))
    body = _extract_ts_const_object_body(text, "PROVIDER_CAPS")
    table: dict[str, dict[str, bool]] = {}
    for m in _TS_PROVIDER_BLOCK_RE.finditer(body):
        provider = m.group(1)
        table[provider] = {k: v == "true" for k, v in _TS_BOOL_PAIR_RE.findall(m.group(2))}
    return table


def _load_ts_table(path: Path, end_name: str) -> dict[str, dict[str, bool]]:
    """读取并解析一端 TS 表源；文件缺失 / 解析为空都以失败信息点明（防哑绿）。"""
    if not path.is_file():
        pytest.fail(f"{end_name} 表源文件缺失: {path}（三端镜像守护前提）")
    table = _parse_ts_caps_table(path)
    if not table:
        pytest.fail(f"{end_name} 表源解析结果为空: {path}（表格式漂移，检查解析器）")
    return table


def _all_ends() -> dict[str, dict[str, dict[str, bool]]]:
    """三端表汇总：daemon / frontend 读源解析，python 直接 import 本模块表。"""
    return {
        "daemon(sillyhub-daemon/src/interactive/providers.ts)": _load_ts_table(
            _DAEMON_TABLE_PATH, "daemon"
        ),
        "frontend(frontend/src/lib/provider-caps.ts)": _load_ts_table(
            _FRONTEND_TABLE_PATH, "frontend"
        ),
        "python(app/modules/agent/provider_caps.py)": {
            provider: dict(caps) for provider, caps in PROVIDER_CAPS.items()
        },
    }


def test_caps_key_sets_identical_and_are_the_8_contract_keys() -> None:
    """①三端每个 provider 条目的键集合一致，且恰为契约 8 键（多键少键都失败）。"""
    assert len(EXPECTED_CAPS_KEYS) == 8
    for end_name, table in _all_ends().items():
        for provider, caps in table.items():
            assert set(caps) == EXPECTED_CAPS_KEYS, (
                f"{end_name} 的 {provider} 键集合漂移: "
                f"多出 {set(caps) - EXPECTED_CAPS_KEYS} / 缺少 "
                f"{EXPECTED_CAPS_KEYS - set(caps)}"
            )


def test_provider_sets_identical() -> None:
    """②三端 provider 集合一致，且覆盖契约 provider（claude / codex / pi）。"""
    ends = _all_ends()
    for end_name, table in ends.items():
        assert set(table) == EXPECTED_PROVIDERS, (
            f"{end_name} provider 集合漂移: {sorted(table)}（期望 {sorted(EXPECTED_PROVIDERS)}）"
        )


def test_cap_values_identical_per_provider_per_key() -> None:
    """③每个 provider 每键取值三端一致（逐键断言，漂移信息带端名与锚点）。"""
    ends = _all_ends()
    reference_name = next(iter(ends))
    reference = ends[reference_name]
    for end_name, table in ends.items():
        for provider in EXPECTED_PROVIDERS:
            for key in sorted(EXPECTED_CAPS_KEYS):
                expected = reference[provider][key]
                actual = table[provider][key]
                assert actual == expected, (
                    f"caps 漂移: {provider}.{key} 在 {end_name} 为 {actual}，"
                    f"与 {reference_name} 的 {expected} 不一致"
                    f"（先改 daemon 单源再同步镜像）"
                )


def test_unknown_provider_returns_all_false_with_8_keys() -> None:
    """④未知 provider 查询：不抛错 + 8 键齐全 + 全 False（默认拒绝，FR-06）。"""
    caps = get_provider_caps("__definitely_unknown_provider__")
    assert set(caps) == EXPECTED_CAPS_KEYS
    assert len(caps) == 8
    assert all(value is False for value in caps.values())
    # 返回新 dict：调用方修改不污染模块级镜像表。
    caps["resume"] = True
    assert PROVIDER_CAPS["claude"]["resume"] is True
    assert get_provider_caps("__definitely_unknown_provider__")["resume"] is False
    # 已知 provider 返回副本，同样不污染共享表。
    known = get_provider_caps("codex")
    known["mcp"] = True
    assert PROVIDER_CAPS["codex"]["mcp"] is False
