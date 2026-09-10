"""JSON 粘贴导入——三包装解析、逐条容错、name 归一化与同名冲突 skip。

Change: 2026-09-10-mcp-central-registry（task-08 / FR-06、D-004、D-005）。与
task-09（workspace 扫描导入）共享本模块：本卡仅 JSON 粘贴路径，扫描候选与
dedup_key 去重锚归 task-09。

分层铁律：落库一律经 ``McpRegistryService.create_server``（task-02）——secret
键判定（``_SECRET_KEY_MARKERS`` 键名规则）与 CredentialCipher 抽列加密全部在
service 完成，本模块禁止直接触碰 get_cipher / CredentialCipher；scope 语义
（platform → owner NULL 需 admin / mine → owner=操作者）同样由 service 承载。

包装探测（ai-toolbox 粘贴导入兼容思路）：顶层 dict 依次探测 ``mcpServers``、
``servers``、``mcp`` 三键取首个 dict 值（Claude Code / Cursor / 旧式 mcp 键三
种粘贴形态）；整体非合法 JSON 或三键均未命中 → ``McpImportPayloadInvalid``
400 中文提示（不静默把任意 dict 当 server map，防误导入无关 JSON）。

逐条容错（R-07）：非 dict 条目、非 stdio（D-005）、缺 command、name 归一化
（小写 + 非 [a-z0-9-] 字符合并为连字符）后仍不匹配 ``^[a-z0-9][a-z0-9-]{1,99}$``
→ 记 skipped 带原因不中断整批；同 owner 维度同名冲突（既有资产 / 同批归一化
撞名 / 再次导入）捕获 service ``McpServerNameConflict`` 转 skip，绝不改写既有
资产（幂等）。

元数据：source 固定 ``imported_json``；dedup_key 留空（去重锚仅归 workspace
导入，task-09）；``renamed`` 统计 name 被归一化改写的条目（记录归一化后新名）。
"""

from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.mcp_registry.schema import McpImportResult, McpServerCreate, Scope
from app.modules.mcp_registry.service import McpRegistryService, McpServerNameConflict

log = get_logger(__name__)

# 三种顶层包装键（按探测优先级取首个值为 dict 的键）。
_WRAPPER_KEYS = ("mcpServers", "servers", "mcp")

# name 合法形态（design 数据模型节 ^[a-z0-9][a-z0-9-]{1,99}$，与 service 同源规则）。
_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,99}$")

# name 归一化：小写后把 [a-z0-9-] 之外的字符合并为单个连字符（空格/下划线/中文等）。
_NON_NAME_CHARS = re.compile(r"[^a-z0-9-]+")

# 写路径仅 stdio（D-005，条目级拒收；与 service._ALLOWED_SERVER_TYPE 同一决策）。
_STDIO_TYPE = "stdio"

_SOURCE_IMPORTED_JSON = "imported_json"


class McpImportPayloadInvalid(AppError):
    """JSON 粘贴文本非合法 JSON，或未命中 mcpServers/servers/mcp 三包装（400）。"""

    code = "HTTP_400_MCP_IMPORT_PAYLOAD_INVALID"
    http_status = 400


def _extract_server_map(json_text: str) -> dict[str, Any]:
    """三包装探测 → server map（``{name: {command, args, env}}``）。

    非法 JSON / 顶层非 dict / 三键均未命中（或命中键的值非 dict）→ 400
    中文提示。
    """
    try:
        payload = json.loads(json_text)
    except json.JSONDecodeError as exc:
        raise McpImportPayloadInvalid(
            "JSON 解析失败：请粘贴合法的 MCP server 配置 JSON。",
            details={"reason": "invalid_json"},
        ) from exc
    if not isinstance(payload, dict):
        raise McpImportPayloadInvalid(
            '顶层必须是 JSON 对象：请粘贴形如 {"mcpServers": {...}} 的配置。',
            details={"reason": "top_level_not_object"},
        )
    for key in _WRAPPER_KEYS:
        value = payload.get(key)
        if isinstance(value, dict):
            return value
    raise McpImportPayloadInvalid(
        "未找到 mcpServers/servers/mcp 任一顶层键，无法识别为 MCP server 配置。",
        details={"reason": "wrapper_key_missing", "expected_keys": list(_WRAPPER_KEYS)},
    )


def _normalize_name(raw: str) -> str:
    """name 归一化：strip + 小写 + 非 [a-z0-9-] 字符合并为单个连字符（R-07）。"""
    return _NON_NAME_CHARS.sub("-", raw.strip().lower())


async def import_from_json(
    session: AsyncSession,
    json_text: str,
    scope: Scope,
    user: User,
) -> McpImportResult:
    """JSON 粘贴导入入口（router import-json 端点的惰性委托目标，签名逐字对齐）。

    返回 ``{imported, skipped, renamed}``：imported 为归一化后落库名单；
    skipped 条目为 ``"<原始键>: <原因>"``（可直出前端）；renamed 为归一化
    改写后成功落库的新名。权限错误（如非 admin 直调 platform）不在逐条容错
    范围，原样上抛（router 已在端点侧落同权限门，此处是 service 纵深防御）。
    """
    server_map = _extract_server_map(json_text)
    service = McpRegistryService(session)
    imported: list[str] = []
    skipped: list[str] = []
    renamed: list[str] = []

    for raw_name, entry in server_map.items():
        if not isinstance(entry, dict):
            skipped.append(f"{raw_name}: 配置必须是对象（command/args/env）")
            continue
        declared_type = entry.get("type", _STDIO_TYPE)
        if declared_type != _STDIO_TYPE:
            skipped.append(f"{raw_name}: 仅支持 stdio 类型（当前 type={declared_type!r}）")
            continue
        command = entry.get("command")
        if not isinstance(command, str) or not command.strip():
            skipped.append(f"{raw_name}: 缺少 command")
            continue
        name = _normalize_name(raw_name)
        if not _NAME_PATTERN.match(name):
            skipped.append(f"{raw_name}: name 归一化后仍非法（{name!r}）")
            continue
        try:
            # env 明文整体放入 server_config——secret 抽列与加密全在 service。
            await service.create_server(
                McpServerCreate(
                    name=name,
                    server_config=dict(entry),
                    scope=scope,
                    source=_SOURCE_IMPORTED_JSON,
                ),
                user,
            )
        except McpServerNameConflict:
            # 既有同名 / 同批归一化撞名 / 重复导入——skip 不改写既有资产（幂等）。
            skipped.append(f"{raw_name}: 同名已存在，跳过（不覆盖既有配置）")
            continue
        imported.append(name)
        if name != raw_name:
            renamed.append(name)

    log.info(
        "mcp_registry.json_imported",
        imported=len(imported),
        skipped=len(skipped),
        renamed=len(renamed),
        scope=scope,
        user_id=str(user.id),
    )
    return McpImportResult(imported=imported, skipped=skipped, renamed=renamed)
