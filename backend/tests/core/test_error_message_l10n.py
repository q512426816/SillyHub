"""守护测试：防止英文报错文案混入前端用户链路。

author: qinyi
created_at: 2026-08-15 11:04:30

依据：.sillyspec/changes/2026-08-15-error-message-l10n/design.md §5.4

策略（目录推导 + 排除清单，不用包含式白名单）：
1. 守护范围 = app/modules/ 下所有 *router*.py / *service*.py / service.py
   （递归，含子包如 agent/profile、ppm/task、daemon/lease；*router*.py 覆盖
   members_router / link_router / policy_router 等非 router 前缀命名），
   加上用户链路 core 文件：app/main.py、app/core/auth_deps.py、app/core/security.py。
2. 排除清单（机器对机器链路，不守护）：
   - app/modules/daemon/ 下除 router.py 外全部（内部 RPC）；
   - app/modules/mcp_gateway/{tools,server,sse}.py（MCP 协议端点）；
   - app/modules/platform_sync/ 全部（CLI 契约端点）；
   - app/modules/storage/ 全部（启动期装配）；
   - 各模块 tests/ 目录下的测试文件（文件名撞 *service*.py 但非业务代码）。
3. 渐进白名单 PENDING_L10N_FILES：待中文化的文件跳过断言；
   各 Wave 改完从中划掉，最终清空（清空后本测试守护全量用户链路）。
4. 断言：raise SomeError("…") / HTTPException(detail="…") 的纯字面量
   message 必须含 CJK 字符。f-string（JoinedStr）静态不可判，跳过——
   已知局限：f-string 内嵌英文片段不会被本测试捕获，靠 code review 把关。
   ALLOWED_ENGLISH 登记合法英文个案（如协议级字符串），起步为空。
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[2]
MODULES_DIR = BACKEND_DIR / "app" / "modules"

# 用户链路 core 文件（目录推导范围之外手工追加）
CORE_USER_FACING_FILES = (
    "app/main.py",
    "app/core/auth_deps.py",
    "app/core/security.py",
)

# 机器对机器链路排除清单（见模块 docstring 第 2 条）
EXCLUDED_PREFIXES = (
    "app/modules/platform_sync/",
    "app/modules/storage/",
)
EXCLUDED_FILES = {
    "app/modules/mcp_gateway/tools.py",
    "app/modules/mcp_gateway/server.py",
    "app/modules/mcp_gateway/sse.py",
}
DAEMON_DIR_PREFIX = "app/modules/daemon/"
DAEMON_ALLOWED = {"app/modules/daemon/router.py"}

_FILE_NAME = ("*router*.py", "*service*.py", "service.py")
_CJK_RE = re.compile(r"[一-鿿]")
# 机器 code 形态：snake_case 单词（如 token_expired）——code-first 双参异常
# 约定（如 AccessTokenError(code, message)）的首参是 code 不是文案。
_SNAKE_CODE_RE = re.compile(r"^[a-z][a-z0-9_]*$")

# 渐进白名单：待中文化文件（W1 完成后剩余全部后续 Wave 文件）。
# 后续 Wave 改完从中划掉，最终清空。
PENDING_L10N_FILES: set[str] = {
    # ↓ task-03（admin 三模块）已中文化并划出白名单
    # ↓ task-04（workspace 全家 6 文件）已中文化并划出白名单
    # ↓ task-05（change 链路 12 文件）已中文化并划出白名单
    # ↓ task-06（spec_workspace 三件 + agent/skills_bundle_service）已中文化并划出白名单
    # ↓ task-07（agent + daemon 用户面 5 文件）已中文化并划出白名单：
    #   agent/service.py、agent/router.py、agent/profile/service.py、
    #   agent/profile/router.py、daemon/router.py（白名单路径端点）；
    #   daemon/router.py 排除段（llm-proxy 透传/websocket/动态 str(exc)）
    #   剩余英文属机器对机器链路，不在守护断言范围（f-string/str(exc) 静态不可判）。
    # ↓ task-08（llm_provider + tool/git gateway）已中文化并划出白名单：
    #   llm_provider/service.py、llm_provider/usage_handlers.py、
    #   llm_provider/schema.py（raise 文案原已中文，本波核验划出）、
    #   tool_gateway/service.py、git_gateway/service.py、git_identity/service.py
    # ↓ task-09（ppm + release + incident + mcp_gateway 用户面）已中文化并划出
    #   白名单：ppm/{task,kanban,problem,plan}/service.py、ppm/project/router.py、
    #   release/service.py、incident/service.py、mcp_gateway/router.py
    #   （含顺带中文化的 McpWebhookNotFound 纯字面量文案）
    # ↓ task-02 跑守护测试发现 design PENDING 清单漏登的后续 Wave 文件
    # （现存英文文案：agent profile 404；worktree/service.py 已随 task-05 中文化划出）
    # ↓ agent/profile/router.py 已随 task-07 中文化并划出白名单
}

# 合法英文个案豁免（如协议级字符串），登记时附原因注释。起步为空。
ALLOWED_ENGLISH: set[str] = {
    # task-07（2026-08-15-error-message-l10n）：daemon/router.py llm-proxy 透传
    # 端点的协议级错误短语。该段（── llm-proxy 透传端点 …… @router.websocket("/ws")
    # 之前）是机器对机器链路（Claude Code 子进程 / daemon 打 LiteLLM 代理），
    # 调用方按 HTTP 状态码分流，不渲染 message，保持协议级短语不动。
    "llm proxy upstream not configured",
    "llm proxy path not allowed",
    "authentication required",
    "llm proxy upstream unavailable",
    "model ownership mismatch",
}


def _iter_module_files() -> list[str]:
    """目录推导守护范围：modules 下 router/service 命名文件，应用排除清单。"""
    result: set[str] = set()
    for pattern in _FILE_NAME:
        for path in MODULES_DIR.rglob(pattern):
            if not path.is_file():
                continue
            rel = path.relative_to(BACKEND_DIR).as_posix()
            parts = path.relative_to(MODULES_DIR).parts
            # 排除各模块 tests/ 目录（文件名撞 *service*.py 的测试代码）
            if "tests" in parts:
                continue
            # 排除清单
            if rel.startswith(EXCLUDED_PREFIXES):
                continue
            if rel in EXCLUDED_FILES:
                continue
            # daemon 仅保留 router.py（其余为内部 RPC）
            if rel.startswith(DAEMON_DIR_PREFIX) and rel not in DAEMON_ALLOWED:
                continue
            result.add(rel)
    result.update(CORE_USER_FACING_FILES)
    return sorted(result)


def _extract_message_literals(tree: ast.AST) -> list[str]:
    """提取 raise 语句中报错 message 的纯字符串字面量。

    覆盖形态：
    - raise SomeError("…")            → 首个位置参数为 str 字面量
    - raise SomeError("code", "…")    → code-first 双参约定（snake_case 机器
      code 首参被识别跳过，取其后第一个 str 字面量，如 AccessTokenError）
    - raise SomeError(message="…")    → message 关键字参数
    - raise HTTPException(…, detail="…") → detail 关键字参数（首个位置参数是
      status_code 整数，天然被 str 字面量过滤排除）
    f-string（JoinedStr）静态不可判，跳过（见模块 docstring 已知局限）。
    """
    literals: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Raise) or not isinstance(node.exc, ast.Call):
            continue
        call = node.exc
        for arg in call.args:
            if not isinstance(arg, ast.Constant) or not isinstance(arg.value, str):
                continue
            # code-first 双参约定（如 AccessTokenError(code, message)）：
            # 若首个位置参数是 snake_case 形态的机器 code（token_expired 等），
            # 说明文案在其后的参数里——跳过 code，取下一个 str 字面量参数。
            if arg is call.args[0] and _SNAKE_CODE_RE.match(arg.value):
                continue
            literals.append(arg.value)
            break
        # message / detail 关键字参数
        for kw in call.keywords:
            if (
                kw.arg in ("message", "detail")
                and isinstance(kw.value, ast.Constant)
                and isinstance(kw.value.value, str)
            ):
                literals.append(kw.value.value)
    return literals


def _guarded_files() -> list[str]:
    files = [f for f in _iter_module_files() if f not in PENDING_L10N_FILES]
    # PENDING 内含不属于推导范围的文件（后续 Wave 也会中文化 schema/dispatch/
    # proxy 等非 router/service 命名文件），它们不进守护集；但登记笔误（磁盘上
    # 不存在的路径）会让划掉时机被静默掩盖——按存在性显式失败暴露。
    missing = sorted(p for p in PENDING_L10N_FILES if not (BACKEND_DIR / p).is_file())
    assert not missing, f"PENDING_L10N_FILES 含磁盘上不存在的文件，请核对: {missing}"
    return files


@pytest.mark.parametrize("rel_path", _guarded_files(), ids=lambda p: p)
def test_error_message_contains_cjk(rel_path: str) -> None:
    """守护文件中 raise 的纯字面量报错 message 必须含中文。"""
    path = BACKEND_DIR / rel_path
    assert path.is_file(), f"守护文件不存在，请核对推导/清单: {rel_path}"
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=rel_path)
    offenders = [
        msg
        for msg in _extract_message_literals(tree)
        if not _CJK_RE.search(msg) and msg not in ALLOWED_ENGLISH
    ]
    assert not offenders, (
        f"{rel_path} 存在不含中文的报错 message 字面量（需中文化或登记 ALLOWED_ENGLISH）: {offenders}"
    )
