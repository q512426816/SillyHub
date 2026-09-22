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

# 契约键（design §5.2 ProviderCaps 8 个 boolean 键 + 2026-09-09-askuser-pi-cursor
# task-12（FR-06）新增 dialog string 枚举键 + 2026-09-11-provider-adapter-registry
# task-04 新增 provider_switch boolean 键（FR-04 会话级供应商切换，三端生成产物
# 由 sillyhub-daemon/scripts/gen-provider-caps.mjs 产出）+ 2026-09-13-ctx-usage-
# all-providers task-06 新增 ctx_usage boolean 键（FR-04 上下文窗口用量上报，
# 四引擎全 true）+ 2026-09-14-session-ctx-compact task-01 新增 compact boolean
# 键（FR-01 会话级上下文压缩通道，claude/pi/codex 原生通道实证 true、cursor
# 无通道 false）+ 2026-09-14-session-thinking-level task-01 新增 thinking_level
# boolean 键（FR-01 会话级思考强度档位通道，claude/pi/codex 三引擎通道实证
# true、cursor 无通道 false）+ 2026-09-18-single-chat-steering task-01 新增
# steering boolean 键（FR-02 运行中会话追加消息转向通道，pi/claude/codex
# true、cursor 无通道 false——claude/codex 取值待 spike 实测后收口）+
# ql-20260921-005 新增 attachments boolean 键（会话附件链路开通，deliver=disk
# 落盘 + 路径清单也算：claude/pi/cursor=true、codex=false；multimodal 键语义
# 自此收窄为多模态块通道，cursor 附件图片经 gate 相与强制落盘）+
# 2026-09-22-session-fork-continuation task-03 新增 sessionFork string 枚举键
# （D-008 / D-010 会话分叉通道形态：'native' 原生截断 / 'seed' 种子克隆 /
# 'none' 无通道——dialog 后第二个非 boolean 键）= 16 键。
EXPECTED_CAPS_KEYS: frozenset[str] = frozenset(
    {
        "resume",
        "mcp",
        "multimodal",
        "attachments",
        "thinking",
        "subagent",
        "permission_dialog",
        "dialog",
        "edit_patch",
        "model_select",
        "provider_switch",
        "ctx_usage",
        "compact",
        "thinking_level",
        "steering",
        "sessionFork",
    }
)

# 契约 provider（现状交互式 driver 全集；新 provider 接入时三端同加。
# pi 由 2026-09-04-provider-pi-onboarding task-04 接入；
# cursor 由 2026-09-08-cursor-interactive-session task-07 接入）。
EXPECTED_PROVIDERS: frozenset[str] = frozenset({"claude", "codex", "cursor", "pi"})

# TS 表源解析：provider 条目块（`claude: { ... }`）与块内键值对。
# 值形态两代（R-09：解析器扩展与 caps 键同任务交付，防止 string 枚举键被
# 静默丢弃后键集合断言哑绿）：
# - 14 个 boolean 键：true / false 裸字面量；
# - dialog string 枚举键（task-12 / FR-06）：带引号 'native' / 'marker' / 'none'；
# - sessionFork string 枚举键（session-fork task-03 / D-008）：带引号
#   'native' / 'seed' / 'none'（与 dialog 共用字符串值域并集）。
_TS_PROVIDER_BLOCK_RE = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{([^{}]*)\}")
_TS_BOOL_PAIR_RE = re.compile(
    r"([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?:(true|false)\b|'(native|marker|seed|none)')"
)


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


def _parse_ts_caps_table(path: Path) -> dict[str, dict[str, bool | str]]:
    """解析 TS 表源为 {provider: {key: bool | str}}（手写解析，不引 TS 运行时依赖）。

    boolean 键还原为 bool，string 枚举键（dialog：'native' / 'marker' / 'none'；
    sessionFork：'native' / 'seed' / 'none'）还原为 str（task-12 / FR-06、
    session-fork task-03 / D-008）。
    """
    text = _strip_ts_comments(path.read_text(encoding="utf-8"))
    body = _extract_ts_const_object_body(text, "PROVIDER_CAPS")
    table: dict[str, dict[str, bool | str]] = {}
    for m in _TS_PROVIDER_BLOCK_RE.finditer(body):
        provider = m.group(1)
        values: dict[str, bool | str] = {}
        for pair in _TS_BOOL_PAIR_RE.finditer(m.group(2)):
            if pair.group(3) is not None:
                # dialog string 枚举（带引号字面量）。
                values[pair.group(1)] = pair.group(3)
            else:
                values[pair.group(1)] = pair.group(2) == "true"
        table[provider] = values
    return table


def _load_ts_table(path: Path, end_name: str) -> dict[str, dict[str, bool | str]]:
    """读取并解析一端 TS 表源；文件缺失 / 解析为空都以失败信息点明（防哑绿）。"""
    if not path.is_file():
        pytest.fail(f"{end_name} 表源文件缺失: {path}（三端镜像守护前提）")
    table = _parse_ts_caps_table(path)
    if not table:
        pytest.fail(f"{end_name} 表源解析结果为空: {path}（表格式漂移，检查解析器）")
    return table


def _all_ends() -> dict[str, dict[str, dict[str, bool | str]]]:
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


def test_caps_key_sets_identical_and_are_the_16_contract_keys() -> None:
    """①三端每个 provider 条目的键集合一致，且恰为契约 16 键（多键少键都失败）。

    16 键 = 14 个 boolean 键 + dialog / sessionFork 两 string 枚举键
    （task-12 / FR-06、session-fork task-03 / D-008）——任一端漏加枚举键即在
    此失败（R-09：解析器已扩 string 值支持，不会静默丢弃）。
    """
    assert len(EXPECTED_CAPS_KEYS) == 16
    for end_name, table in _all_ends().items():
        for provider, caps in table.items():
            assert set(caps) == EXPECTED_CAPS_KEYS, (
                f"{end_name} 的 {provider} 键集合漂移: "
                f"多出 {set(caps) - EXPECTED_CAPS_KEYS} / 缺少 "
                f"{EXPECTED_CAPS_KEYS - set(caps)}"
            )


def test_provider_sets_identical() -> None:
    """②三端 provider 集合一致，且覆盖契约 provider（claude / codex / cursor / pi）。"""
    ends = _all_ends()
    for end_name, table in ends.items():
        assert set(table) == EXPECTED_PROVIDERS, (
            f"{end_name} provider 集合漂移: {sorted(table)}（期望 {sorted(EXPECTED_PROVIDERS)}）"
        )


def test_cap_values_identical_per_provider_per_key() -> None:
    """③每个 provider 每键取值三端一致（逐键断言，漂移信息带端名与锚点）。

    == 同时覆盖 bool 与 str 值形态——dialog（'native' / 'marker' / 'none'）与
    sessionFork（'native' / 'seed' / 'none'）两 string 枚举随
    EXPECTED_CAPS_KEYS 一并逐端比对，三端值漂移即失败。
    """
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


def test_unknown_provider_returns_default_deny_with_16_keys() -> None:
    """④未知 provider 查询：不抛错 + 16 键齐全 + 默认拒绝（FR-06 / R-09）。

    默认拒绝形态：14 个 boolean 键全 False + dialog / sessionFork 两 string
    枚举键缺键兜底回退 'none'。
    """
    caps = get_provider_caps("__definitely_unknown_provider__")
    assert set(caps) == EXPECTED_CAPS_KEYS
    assert len(caps) == 16
    assert caps["dialog"] == "none"
    assert caps["sessionFork"] == "none"
    assert all(
        value is False for key, value in caps.items() if key not in ("dialog", "sessionFork")
    )
    # 返回新 dict：调用方修改不污染模块级镜像表。
    caps["resume"] = True
    assert PROVIDER_CAPS["claude"]["resume"] is True
    assert get_provider_caps("__definitely_unknown_provider__")["resume"] is False
    # 已知 provider 返回副本，同样不污染共享表。
    known = get_provider_caps("codex")
    known["mcp"] = True
    assert PROVIDER_CAPS["codex"]["mcp"] is False


def test_session_fork_enum_domain_and_contract_values() -> None:
    """⑤sessionFork 第 16 键（D-008 / D-010）：值域三值枚举 + 四引擎定值三端一致。

    值域：'native'（原生截断分叉）/ 'seed'（种子克隆档）/ 'none'（无通道）；
    定值：claude / pi='native'、codex='seed'、cursor='none'——键集合断言只保证
    键存在，值域与 D-008 定档取值由本测试钉死（任一端漂移即失败）。
    """
    expected_values = {
        "claude": "native",
        "codex": "seed",
        "cursor": "none",
        "pi": "native",
    }
    enum_domain = {"native", "seed", "none"}
    for end_name, table in _all_ends().items():
        for provider, expected in expected_values.items():
            actual = table[provider]["sessionFork"]
            assert actual in enum_domain, (
                f"sessionFork 值域漂移: {end_name} 的 {provider} 为 {actual}"
                f"（值域 {sorted(enum_domain)}）"
            )
            assert actual == expected, (
                f"sessionFork 定值漂移: {end_name} 的 {provider} 为 {actual}，"
                f"期望 {expected}（D-008 / D-010 定档）"
            )
