"""导入层——JSON 粘贴导入（task-08）+ workspace .mcp.json 扫描导入（task-09）。

Change: 2026-09-10-mcp-central-registry（task-08 / FR-06、D-004、D-005 +
task-09 / FR-07、D-004）。两路径共享本模块与 ``service.create_server`` 落库
链路，行为互不干扰：JSON 路径无 dedup_key，workspace 路径有去重锚。

分层铁律：落库一律经 ``McpRegistryService.create_server``（task-02）——secret
键判定（``_SECRET_KEY_MARKERS`` 键名规则）与 CredentialCipher 抽列加密全部在
service 完成，本模块禁止直接触碰 get_cipher / CredentialCipher；scope 语义
（platform → owner NULL 需 admin / mine → owner=操作者）同样由 service 承载。

JSON 粘贴路径（task-08）——包装探测（ai-toolbox 粘贴导入兼容思路）：顶层 dict
依次探测 ``mcpServers``、``servers``、``mcp`` 三键取首个 dict 值（Claude Code /
Cursor / 旧式 mcp 键三种粘贴形态）；整体非合法 JSON 或三键均未命中 →
``McpImportPayloadInvalid`` 400 中文提示（不静默把任意 dict 当 server map，防误
导入无关 JSON）。逐条容错（R-07）：非 dict 条目、非 stdio（D-005）、缺 command、
name 归一化（小写 + 非 [a-z0-9-] 字符合并为连字符）后仍不匹配
``^[a-z0-9][a-z0-9-]{1,99}$`` → 记 skipped 带原因不中断整批；同 owner 维度同名
冲突捕获 service ``McpServerNameConflict`` 转 skip，绝不改写既有资产（幂等）。
元数据：source 固定 ``imported_json``；dedup_key 留空（去重锚仅归 workspace
导入）。

workspace 扫描路径（task-09）——scan/apply 两阶段：
- ``scan_workspaces`` 只读：遍历（或指定）未软删 workspace，复用
  ``daemon_rpc._read_mcp_config_raw`` 逐个读 ``specDir/.mcp.json`` 明文（容错
  空集语义一致：无 spec_ws / 文件缺失 / 坏 JSON → 空 mcpServers 不抛错；文件
  IO 走 ``asyncio.to_thread`` 且逐 workspace 串行，R-04）；候选附三态去重判定
  ——按 ``dedup_key = ws:<workspace_id>:<原名>`` 查既有行：new（无行）/
  duplicate（有行且配置等价）/ renamed（有行且配置相异）；**零写库**（不碰
  service、不动 workspace 的 .mcp.json——registry 吸收不替代，design 非目标）。
- ``apply_workspace_import`` 落库：候选经 ``service.create_server`` 写入，
  source=``imported_workspace``、dedup_key 带 ws 锚；候选 ``server_config`` 是
  脱敏形态（API 往返后 secret 值 ``<set>``），apply 按 workspace_id+name **重读
  原文件取明文**（schema 契约，脱敏展示不阻断应用）；三态按 apply 时库态重判
  ——等价行已存在 → skip（幂等）、同锚异配置 → 落库为 ``原名-<workspace 短名>``
  （短名取 workspace 名 slug，空 slug 回退 id 前 6 位）。
- cmd 归一化（design 六项能力之六，去重比对用）：command basename 为
  cmd/cmd.exe 且 args 首元素为 ``/c``（大小写不敏感）时剥掉包装——比对双端
  归一化（``cmd /c npx …`` 与裸 ``npx …`` 判同配置）；workspace 导入落库保留
  归一化后形态（JSON 粘贴路径行为不变，仍存原样）。secret 值不参与比对
  （registry 侧为密文不可逆），env 只比键集合不比值。
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Collection
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.mcp_registry.model import McpServer
from app.modules.mcp_registry.schema import (
    McpImportResult,
    McpServerCreate,
    McpWorkspaceCandidate,
    Scope,
)
from app.modules.mcp_registry.service import McpRegistryService, McpServerNameConflict

if TYPE_CHECKING:
    from app.modules.workspace.model import Workspace

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

# workspace 导入行 source（design 数据模型节 'manual'|'imported_json'|'imported_workspace'）。
_SOURCE_IMPORTED_WORKSPACE = "imported_workspace"

# dedup_key 前缀（design 数据模型节 'ws:<workspace_id>:<name>' 扫描导入去重锚）。
_DEDUP_KEY_PREFIX = "ws"

# cmd 归一化：Windows cmd 包装的 command basename 集合（大小写 / 路径前缀归一到此判定）。
_CMD_BASENAMES = frozenset({"cmd", "cmd.exe"})


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


# ── workspace 扫描导入（task-09 / FR-07、D-004）──────────────────────────────


def _dedup_key(workspace_id: uuid.UUID, raw_name: str) -> str:
    """``ws:<workspace_id>:<原名>``——workspace 维度去重锚（R-07 原名可追溯）。

    归一化只改行名不改锚：文件键 ``Context7_Fetch`` 落库名 context7-fetch，
    dedup_key 仍含原名——重复扫描 / 重复 apply 按锚命中，与归一化形态解耦。
    """
    return f"{_DEDUP_KEY_PREFIX}:{workspace_id}:{raw_name}"


def _strip_cmd_wrapper(command: Any, args: Any) -> tuple[Any, Any]:
    """剥 Windows ``cmd /c`` 包装：command basename 为 cmd/cmd.exe 且 args 首元素
    为 ``/c``（大小写不敏感）时，command ← args[1]、args ← args[2:]（单层、幂等）。

    仅识别完整可靠形态（剥离后必须有可用 command），其余原样返回同一对象
    （调用方以 ``is`` 判断是否发生剥离）。
    """
    if not isinstance(command, str) or not isinstance(args, list) or len(args) < 2:
        return command, args
    basename = command.strip().lower().replace("\\", "/").rsplit("/", 1)[-1]
    first, successor = args[0], args[1]
    if (
        basename in _CMD_BASENAMES
        and isinstance(first, str)
        and first.strip().lower() == "/c"
        and isinstance(successor, str)
        and successor.strip()
    ):
        return successor, list(args[2:])
    return command, args


def _normalize_entry_config(entry: dict[str, Any]) -> dict[str, Any]:
    """cmd 归一化后的条目浅拷贝（无包装时原样拷贝）——比对与落库共用同一形态。

    workspace 导入落库保留归一化后形态（``cmd /c npx …`` 存为 ``npx …``）；
    JSON 粘贴路径不走本函数，仍存原样（task-08 行为不变）。
    """
    raw_command, raw_args = entry.get("command"), entry.get("args")
    command, args = _strip_cmd_wrapper(raw_command, raw_args)
    if command is raw_command and args is raw_args:
        return dict(entry)
    normalized = dict(entry)
    normalized["command"] = command
    normalized["args"] = args
    return normalized


def _config_signature(
    config: dict[str, Any], extra_env_keys: Collection[str] = ()
) -> tuple[Any, tuple[Any, ...], frozenset[str]]:
    """配置比对签名：cmd 归一化后的 ``(command, args 元组, env 键集合)``。

    env 只比键集合不比值——secret 值 registry 侧为密文不可逆，非 secret 值的
    差异按卡定不触发改名（task implementation 配置相等判定）。rename 谱系行的
    secret 键经 ``extra_env_keys``（encrypted_env 键）并入。
    """
    command, args = _strip_cmd_wrapper(config.get("command"), config.get("args"))
    env = config.get("env")
    env_keys = frozenset(env) if isinstance(env, dict) else frozenset()
    return (
        command,
        tuple(args) if isinstance(args, list) else (),
        env_keys | frozenset(extra_env_keys),
    )


def _row_signature(row: McpServer) -> tuple[Any, tuple[Any, ...], frozenset[str]]:
    """既有行比对签名：server_config（含 env 明文键）∪ encrypted_env 的 secret 键。"""
    config = row.server_config if isinstance(row.server_config, dict) else {}
    return _config_signature(config, extra_env_keys=frozenset(row.encrypted_env or {}))


def _verdict(rows: list[McpServer] | None, entry_config: dict[str, Any]) -> str:
    """三态判定（schema ``dedup_verdict`` 词表）：new / duplicate / renamed。

    同锚多行（rename 谱系）时任一行配置等价即 duplicate——导入过的形态不再
    重复提示改名，判定稳定。
    """
    if not rows:
        return "new"
    signature = _config_signature(entry_config)
    if any(_row_signature(row) == signature for row in rows):
        return "duplicate"
    return "renamed"


def _entry_invalid_reason(entry: Any) -> str | None:
    """条目校验（与 JSON 导入路径同规则，D-005 / R-07）：返回中文原因或 None。

    name 归一化后仍非法的判定归调用方（需先归一化才知道结果）。
    """
    if not isinstance(entry, dict):
        return "配置必须是对象（command/args/env）"
    declared_type = entry.get("type", _STDIO_TYPE)
    if declared_type != _STDIO_TYPE:
        return f"仅支持 stdio 类型（当前 type={declared_type!r}）"
    command = entry.get("command")
    if not isinstance(command, str) or not command.strip():
        return "缺少 command"
    return None


def _workspace_short_name(ws: Workspace) -> str:
    """rename 后缀短名：workspace 名 slug（同 name 归一化规则），空 slug 回退
    id 前 6 位（纯非 ASCII 名 workspace）。"""
    slug = _NON_NAME_CHARS.sub("-", ws.name.strip().lower()).strip("-")
    return slug or ws.id.hex[:6]


def _renamed_name(name: str, ws: Workspace) -> str:
    """改名形态：``<归一化名>-<workspace 短名>``（原名加连字符加短名）。

    超长截断到 name 列上限 100 并去尾连字符（保持 ^[a-z0-9][a-z0-9-]{1,99}$）。
    """
    renamed = f"{name}-{_workspace_short_name(ws)}"
    if len(renamed) > 100:
        renamed = renamed[:100].rstrip("-")
    return renamed


def _match_file_entry(servers: dict[str, Any], name: str) -> tuple[str, dict[str, Any]] | None:
    """按归一化名在文件 server map 中找回 ``(原名, 条目)``（R-07 原名供 dedup_key）。"""
    for raw_name, entry in servers.items():
        if isinstance(entry, dict) and _normalize_name(raw_name) == name:
            return raw_name, entry
    return None


async def _dedup_lineage(session: AsyncSession) -> dict[str, list[McpServer]]:
    """全部带 dedup_key 的行按锚分组（单查询预载——registry 规模小，R-04）。"""
    stmt = select(McpServer).where(col(McpServer.dedup_key).is_not(None))
    rows = (await session.execute(stmt)).scalars().all()
    lineage: dict[str, list[McpServer]] = {}
    for row in rows:
        lineage.setdefault(row.dedup_key or "", []).append(row)
    return lineage


async def _find_lineage(session: AsyncSession, dedup_key: str) -> list[McpServer]:
    """按单个 dedup_key 查同锚行（apply 路径逐候选查询，批内此前已 commit 可见）。"""
    stmt = select(McpServer).where(McpServer.dedup_key == dedup_key)
    return list((await session.execute(stmt)).scalars().all())


async def scan_workspaces(
    session: AsyncSession,
    workspace_id: uuid.UUID | None,
    user: User,
) -> list[McpWorkspaceCandidate]:
    """workspace 扫描（只读阶段）：读各 workspace ``specDir/.mcp.json`` 出候选 +
    三态去重判定，**零写库**（无新行、不碰 service、不动 workspace 文件）。

    ``workspace_id`` 缺省遍历全部未软删 workspace（按名排序，输出确定）；
    指定时不存在 / 已软删 → ``WorkspaceNotFound``（404，与
    ``daemon_rpc._read_mcp_config_raw`` 同语义）。文件读取复用该函数（容错
    空集一致：无 spec_ws / spec_root 缺失 / 文件缺失 / 坏 JSON → 空集），
    文件 IO 走 ``asyncio.to_thread`` 且逐 workspace 串行（R-04）。坏条目
    （非 dict / 非 stdio / 缺 command / 归一化后名非法）不进候选，仅记日志。
    """
    # 惰性 import（router→importer→daemon_rpc 链路避免 import 期耦合，先例
    # daemon_rpc 自身 / render._read_whitelist）。
    from app.modules.daemon.router.daemon_rpc import _read_mcp_config_raw
    from app.modules.workspace.model import Workspace as WorkspaceModel
    from app.modules.workspace.service import WorkspaceService

    if workspace_id is not None:
        workspaces = [await WorkspaceService(session).get(workspace_id)]
    else:
        stmt = (
            select(WorkspaceModel)
            .where(col(WorkspaceModel.deleted_at).is_(None))
            .order_by(col(WorkspaceModel.name))
        )
        workspaces = list((await session.execute(stmt)).scalars().all())

    lineage = await _dedup_lineage(session)
    candidates: list[McpWorkspaceCandidate] = []
    for ws in workspaces:
        servers = (await _read_mcp_config_raw(session, ws.id)).get("mcpServers", {})
        if not isinstance(servers, dict):
            continue
        for raw_name, entry in sorted(servers.items()):
            reason = _entry_invalid_reason(entry)
            name = _normalize_name(raw_name)
            if reason is None and not _NAME_PATTERN.match(name):
                reason = f"name 归一化后仍非法（{name!r}）"
            if reason is not None:
                log.warning(
                    "mcp_registry.workspace_scan_entry_skipped",
                    workspace_id=str(ws.id),
                    name=raw_name,
                    reason=reason,
                )
                continue
            entry_config = _normalize_entry_config(entry)
            candidates.append(
                McpWorkspaceCandidate(
                    name=name,
                    server_config=entry_config,
                    workspace_id=ws.id,
                    dedup_verdict=_verdict(lineage.get(_dedup_key(ws.id, raw_name)), entry_config),
                )
            )

    log.info(
        "mcp_registry.workspace_scanned",
        workspaces=len(workspaces),
        candidates=len(candidates),
        requested=str(workspace_id) if workspace_id is not None else None,
        user_id=str(user.id),
    )
    return candidates


async def apply_workspace_import(
    session: AsyncSession,
    candidates: list[McpWorkspaceCandidate],
    scope: Scope,
    user: User,
) -> McpImportResult:
    """应用扫描候选（写阶段）：选中候选经 ``service.create_server`` 落库。

    候选 ``server_config`` 是脱敏形态（API 往返后 secret 值为 ``<set>``）——apply
    按 ``workspace_id + name`` **重读原文件取明文**（schema 契约），脱敏展示不
    阻断应用；文件中已消失（扫描后变更）/ 变成坏条目 → skipped 带原因。

    三态按 apply 时库态重判（scan 与 apply 之间库可能已变，不信任陈旧 verdict）：
    等价行已存在 → skip（幂等，dedup_key 命中）；同锚行存在但配置相异 → 落库为
    ``原名-<workspace 短名>``；无锚行 → 原名（归一化后）落库。行带
    ``source=imported_workspace`` 与 ``dedup_key=ws:<workspace_id>:<原名>``。
    owner 维度同名冲突（如手工已建同名 server）捕获 ``McpServerNameConflict``
    转 skip 不改写；权限错误（非 admin 直调 platform）不在容错范围，原样上抛
    （router 已落同权限门，service 纵深防御——与 JSON 路径同策略）。
    """
    from app.modules.daemon.router.daemon_rpc import _read_mcp_config_raw
    from app.modules.workspace.model import Workspace as WorkspaceModel

    service = McpRegistryService(session)
    imported: list[str] = []
    skipped: list[str] = []
    renamed: list[str] = []
    file_cache: dict[uuid.UUID, dict[str, Any]] = {}

    for candidate in candidates:
        ws = await session.get(WorkspaceModel, candidate.workspace_id)
        if ws is None or ws.deleted_at is not None:
            skipped.append(f"{candidate.name}: workspace 不存在或已被删除")
            continue
        servers = file_cache.get(candidate.workspace_id)
        if servers is None:
            servers = (await _read_mcp_config_raw(session, candidate.workspace_id)).get(
                "mcpServers", {}
            )
            file_cache[candidate.workspace_id] = servers
        matched = _match_file_entry(servers, candidate.name)
        if matched is None:
            skipped.append(f"{candidate.name}: workspace .mcp.json 中已不存在（文件已变更）")
            continue
        raw_name, entry = matched
        reason = _entry_invalid_reason(entry)
        if reason is not None:
            skipped.append(f"{raw_name}: {reason}")
            continue
        entry_config = _normalize_entry_config(entry)
        dedup_key = _dedup_key(candidate.workspace_id, raw_name)
        existing = await _find_lineage(session, dedup_key)
        signature = _config_signature(entry_config)
        if any(_row_signature(row) == signature for row in existing):
            skipped.append(f"{raw_name}: 已导入过（配置相同），跳过")
            continue
        name = _normalize_name(raw_name)
        if existing:  # 同锚异配置 → rename 落库（原名加连字符加 workspace 短名）
            name = _renamed_name(name, ws)
        try:
            await service.create_server(
                McpServerCreate(
                    name=name,
                    server_config=dict(entry_config),
                    scope=scope,
                    source=_SOURCE_IMPORTED_WORKSPACE,
                    dedup_key=dedup_key,
                ),
                user,
            )
        except McpServerNameConflict:
            skipped.append(f"{raw_name}: 同名已存在，跳过（不覆盖既有配置）")
            continue
        imported.append(name)
        if name != raw_name:
            renamed.append(name)

    log.info(
        "mcp_registry.workspace_import_applied",
        imported=len(imported),
        skipped=len(skipped),
        renamed=len(renamed),
        scope=scope,
        user_id=str(user.id),
    )
    return McpImportResult(imported=imported, skipped=skipped, renamed=renamed)
