"""mcp_registry 渲染层——注入集渲染 + 平台注入集诊断预检五项。

Change: 2026-09-10-mcp-central-registry（task-04 / design「接口定义」render.py 段
——两个函数签名与五项诊断定义的唯一权威，逐项对照无发明）。供 task-05 的
daemon 拉取端点（``GET /api/daemon/mcp/config`` 换源）与诊断端点
（``GET /api/mcp-servers/diagnostics``，router 惰性 import 本模块）共用。

- ``render_injection_set(session, user_id)``：注入集 = platform binding 全集 ∪
  该用户的 user binding（scope_ref=user_id，D-008@v2；user_id=None 时仅
  platform 位，等同旧 platform_default 语义），enabled=false 过滤；
  ``encrypted_env`` 经 ``McpRegistryService.decrypt_server_env``（task-02 公开
  方法）解密回填 env；server_type 非 stdio 条目剔除不输出（对应
  invalid_type_defensive 的防御——防 daemon 侧 platform 位整包回落 builtin-only）；
  解密失败（CipherKeyMismatch 等）不炸渲染——该 server 整体降级为无 secret
  形态（env 只剩 server_config 明文键）继续输出，「标记」以结构化日志 +
  precheck 的 decrypt_failed 诊断项承载（输出形状钉死 ``{"mcpServers": {...}}``，
  塞标记字段会破坏 daemon 响应形状兼容）。
- ``precheck_diagnostics(session)``：D-011 五项现行定义（Grill B-03 重定义版，
  不实现已废弃的 will_be_rejected_by_whitelist / will_be_prepurged）。后两项读
  各 workspace ``specDir/.mcp.json``（定位与 daemon_rpc._read_mcp_config_raw
  同源：``SpecWorkspace.spec_root`` + platform_managed 扁平根 + 文件 IO 走
  ``asyncio.to_thread`` + 同款容错集，render 侧按 task 指示重实现）；whitelist
  读 settings KV ``mcp.whitelist``（``_read_setting_json`` 语义）。白名单判定
  方向与 daemon ``mcp-config.ts:382-389`` 一致——有效白名单 = KV 白名单 ∪
  platform 渲染集名（platform 位自动放行），只过滤 workspace 位。

预检覆盖口径（design 注释未细到 enabled 粒度，此处收敛为「预检=提前暴露」）：
decrypt_failed 与 invalid_type_defensive 对**全部 platform-bound** server 探测
（禁用/非 stdio 的存量病灶启用后才会咬人，预检正是要在咬人前报出来；
禁用位另由 bound_but_disabled 单独提示）；platform_name_shadow 只对真正进入
platform 渲染集（bound ∧ enabled ∧ stdio）的名字判定遮蔽。

全程容错不抛错（渲染与诊断路径一致，task constraints）：解密与 workspace 文件
读失败都降级为标记/跳过；registry 空库输出空 ``{"mcpServers": {}}``（对齐 KV
缺失回落语义）。
"""

from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path
from typing import Any

from nacl.exceptions import CryptoError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.crypto import CipherKeyMismatch
from app.core.logging import get_logger
from app.core.spec_paths import SpecPathResolver
from app.modules.mcp_registry.model import McpServer, McpServerBinding
from app.modules.mcp_registry.schema import McpDiagnostic
from app.modules.mcp_registry.service import McpRegistryService

log = get_logger(__name__)

# 解密路径容错集（"解密失败（CipherKeyMismatch 等）不炸渲染"）：
# - CipherKeyMismatch：key 轮换失配（crypto.py:72-77，主预期形态）；
# - CryptoError：nacl 认证失败（密文 bytes 损坏）；
# - ValueError：pydantic ValidationError（信封结构脏）⊂ ValueError，base64
#   binascii.Error ⊂ ValueError，utf-8 UnicodeDecodeError ⊂ ValueError。
_DECRYPT_ERRORS = (CipherKeyMismatch, CryptoError, ValueError)


# ── 注入集渲染（daemon 拉取端点换源共用，design「接口定义」）──────────────────


async def render_injection_set(session: AsyncSession, user_id: uuid.UUID | None) -> dict[str, Any]:
    """渲染注入集：``{"mcpServers": {name: {command, args, env}}}``。

    platform binding 全集 ∪ user binding（scope_ref=user_id）；enabled=false
    过滤；encrypted_env 解密回填 env（与 server_config 明文键合并）；非 stdio
    条目剔除不输出；解密失败该 server 降级为无 secret 形态继续输出（标记走
    结构化日志 + precheck_diagnostics 的 decrypt_failed）。只产出 mcpServers
    内容——三键响应外壳（platform_default/whitelist/workspace）由 task-05
    端点组装（task constraints）。
    """
    svc = McpRegistryService(session)
    mcp_servers: dict[str, Any] = {}
    for row in await _injection_rows(session, user_id):
        if row.server_type != "stdio":
            # 防御性剔除（invalid_type_defensive）：platform 位若混入非 stdio，
            # daemon 侧会整包回落 builtin-only——宁缺勿坏（task implementation）。
            log.warning(
                "mcp_registry.render_skip_non_stdio",
                server_id=str(row.id),
                name=row.name,
                server_type=row.server_type,
            )
            continue
        config = dict(row.server_config) if isinstance(row.server_config, dict) else {}
        try:
            env = svc.decrypt_server_env(row)
        except _DECRYPT_ERRORS as exc:
            # 降级为无 secret 形态：env 回落 server_config 明文键（secret 键整体
            # 丢弃，不做逐键半解密——带陈旧 token 启动比不带更糟）。
            plain_env = config.get("env")
            env = dict(plain_env) if isinstance(plain_env, dict) else {}
            log.warning(
                "mcp_registry.render_decrypt_failed",
                server_id=str(row.id),
                name=row.name,
                error=str(exc),
            )
        config["env"] = env
        mcp_servers[row.name] = config
    return {"mcpServers": mcp_servers}


async def _injection_rows(session: AsyncSession, user_id: uuid.UUID | None) -> list[McpServer]:
    """单查询 join binding 取注入集行（R-03：索引齐备，不分桶多查）。

    platform binding 全集 ∪ user binding（scope_ref=user_id）；enabled=false
    过滤；``distinct()`` 去掉「同 server 同时挂 platform + user binding」的
    join 重复行；按 name 排序保证输出确定性（golden 测试可复现）。
    """
    scope = col(McpServerBinding.scope_type) == "platform"
    if user_id is not None:
        scope = scope | (
            (col(McpServerBinding.scope_type) == "user") & (McpServerBinding.scope_ref == user_id)
        )
    stmt = (
        select(McpServer)
        .join(McpServerBinding, McpServerBinding.server_id == McpServer.id)
        .where(col(McpServer.enabled).is_(True), scope)
        .order_by(col(McpServer.name))
    )
    # verify 集成实测（真实 PG）发现：SELECT DISTINCT 整行（含 json 列）在 PG 报
    # ``could not identify an equality operator for type json``（SQLite 把 json 当
    # 文本可比，单测不暴露）。DISTINCT ON(id) 是 PG 方言 SQLite 不支持——改 Python
    # 侧按 id 去重（name 排序已定，dict 保序先到先得），两方言同语义。
    rows = (await session.execute(stmt)).scalars().all()
    dedup: dict[uuid.UUID, McpServer] = {}
    for row in rows:
        dedup.setdefault(row.id, row)
    return list(dedup.values())


# ── 诊断预检五项（D-011 现行定义，design「接口定义」注释逐字对照）─────────────


async def precheck_diagnostics(session: AsyncSession) -> list[McpDiagnostic]:
    """平台注入集预检（``GET /api/mcp-servers/diagnostics`` 数据源）。

    五项定义（design 接口定义 render.py 段注释）：
    - decrypt_failed：encrypted_env 解密失败（key 轮换失配等）→ 渲染时该
      server 降级为无 secret 形态并标记；
    - bound_but_disabled：server 有 binding 但 enabled=false（配置死角提示）；
    - platform_name_shadow：platform 渲染集 server 名与某 workspace .mcp.json
      server 名相同（三层合并 platform < workspace，workspace 位会遮蔽 platform
      位——用户可能不知道自己的平台配置没生效）；
    - workspace_blocked_by_whitelist：各 workspace .mcp.json 中会被白名单拒绝
      的 server（whitelist 只过滤 workspace 位，mcp-config.ts:382-389）；
    - invalid_type_defensive：server_type != stdio（写路径已挡，防御性——
      platform 位若混入非 stdio 会整包回落 builtin-only，严重级提示）。

    诊断为平台全局视图（platform binding 位），user binding 归属各用户自查，
    不在本预检范围。全程容错不抛错（task constraints）。
    """
    diagnostics: list[McpDiagnostic] = []
    svc = McpRegistryService(session)

    platform_rows = await _platform_bound_rows(session)
    for row in platform_rows:
        if not row.enabled:
            diagnostics.append(
                McpDiagnostic(
                    code="bound_but_disabled",
                    server_id=row.id,
                    server_name=row.name,
                    detail="server 已绑定 platform 但 enabled=false，不会进入注入集（配置死角）。",
                )
            )
        if row.server_type != "stdio":
            diagnostics.append(
                McpDiagnostic(
                    code="invalid_type_defensive",
                    server_id=row.id,
                    server_name=row.name,
                    detail=(
                        f"server_type={row.server_type!r} 非 stdio（写路径已拦截，"
                        "防御性提示）——渲染时剔除，防 daemon platform 位整包回落 builtin-only。"
                    ),
                )
            )
        if row.encrypted_env:
            # 探测解密（enabled/类型不设门槛——预检要在病灶启用咬人前报出来；
            # 失败明细复用 decrypt_server_env 的上抛异常消息，含 key_id 失配对）。
            try:
                svc.decrypt_server_env(row)
            except _DECRYPT_ERRORS as exc:
                diagnostics.append(
                    McpDiagnostic(
                        code="decrypt_failed",
                        server_id=row.id,
                        server_name=row.name,
                        detail=f"encrypted_env 解密失败（{exc}）——渲染降级为无 secret 形态。",
                    )
                )

    # platform 渲染集（名 → server_id）：以 render_injection_set 的实际输出为
    # 单一事实源（bound ∧ enabled ∧ stdio），shadow 判定与白名单自动放行共用。
    rendered = (await render_injection_set(session, None))["mcpServers"]
    platform_render_ids = {row.name: row.id for row in platform_rows}
    platform_render = {
        name: platform_render_ids[name] for name in rendered if name in platform_render_ids
    }

    # 有效白名单 = KV mcp.whitelist ∪ platform 渲染集名（platform 位自动放行，
    # mcp-config.ts 步骤 2 同款）；KV 缺失/脏数据归一为空集（daemon 端点同语义）。
    whitelist = await _read_whitelist(session)
    combined_whitelist = whitelist | set(rendered)

    for ws_name, ws_servers in await _workspace_mcp_configs(session):
        for ws_server_name in ws_servers:
            if ws_server_name in platform_render:
                diagnostics.append(
                    McpDiagnostic(
                        code="platform_name_shadow",
                        server_id=platform_render[ws_server_name],
                        server_name=ws_server_name,
                        detail=(
                            f"workspace {ws_name!r} 的 .mcp.json 存在同名 server，"
                            "三层合并 platform < workspace 下会遮蔽平台注入位。"
                        ),
                    )
                )
            if ws_server_name not in combined_whitelist:
                diagnostics.append(
                    McpDiagnostic(
                        code="workspace_blocked_by_whitelist",
                        server_id=None,
                        server_name=ws_server_name,
                        detail=(
                            f"workspace {ws_name!r} 的 server 不在 mcp.whitelist 白名单内，"
                            "daemon 侧注入时会被拒绝（whitelist 只过滤 workspace 位）。"
                        ),
                    )
                )
    return diagnostics


async def _platform_bound_rows(session: AsyncSession) -> list[McpServer]:
    """platform binding 全集（enabled 不过滤——bound_but_disabled 要看禁用位）。"""
    stmt = (
        select(McpServer)
        .join(McpServerBinding, McpServerBinding.server_id == McpServer.id)
        .where(col(McpServerBinding.scope_type) == "platform")
        .order_by(col(McpServer.name))
    )
    # 同 _injection_rows：PG json 列无等值算子，禁用 SQL DISTINCT，Python 按 id
    # 去重（platform binding 每 server 至多一行——partial unique 保证，此处去重
    # 仅为防御性，语义与原 distinct 等价）。
    rows = (await session.execute(stmt)).scalars().all()
    dedup: dict[uuid.UUID, McpServer] = {}
    for row in rows:
        dedup.setdefault(row.id, row)
    return list(dedup.values())


async def _read_whitelist(session: AsyncSession) -> set[str]:
    """读 settings KV ``mcp.whitelist``（_read_setting_json 语义，非 list 归一空集）。

    惰性 import 对齐 daemon_rpc 端点先例（settings/router.py:538-542 同款）；
    task-05 daemon 换源时与端点共用同一条读取路径。
    """
    from app.modules.settings.router import MCP_WHITELIST_KEY, _read_setting_json

    raw = await _read_setting_json(session, MCP_WHITELIST_KEY, [])
    return {str(x) for x in raw} if isinstance(raw, list) else set()


# ── workspace .mcp.json 读取（daemon_rpc._read_mcp_config_raw 同源容错语义）───


async def _workspace_mcp_configs(session: AsyncSession) -> list[tuple[str, dict[str, Any]]]:
    """枚举各 workspace 的 ``specDir/.mcp.json`` server 名集（(workspace 名, mcpServers)）。

    定位与 daemon_rpc._read_mcp_config_raw / skills_view_service 同法：
    ``SpecWorkspace.spec_root`` + platform_managed 扁平根，backend 本地直读。
    软删 workspace（deleted_at 非空）排除；无 spec_ws 行 / spec_root 为空的
    workspace 跳过（无 specDir 即无 .mcp.json 可读）。文件 IO 全部走
    ``asyncio.to_thread``（移出事件循环）。
    """
    from app.modules.spec_workspace.model import SpecWorkspace
    from app.modules.workspace.model import Workspace

    stmt = (
        select(Workspace, SpecWorkspace)
        .join(SpecWorkspace, SpecWorkspace.workspace_id == Workspace.id)
        .where(col(Workspace.deleted_at).is_(None))
        .order_by(col(Workspace.name))
    )
    rows = (await session.execute(stmt)).all()
    configs: list[tuple[str, dict[str, Any]]] = []
    for ws, spec_ws in rows:
        if not spec_ws.spec_root:
            continue
        resolver = SpecPathResolver(spec_ws.spec_root, platform_managed=True)
        mcp_path = resolver._spec_root() / ".mcp.json"
        configs.append((ws.name, await asyncio.to_thread(_read_mcp_json_sync, mcp_path)))
    return configs


def _read_mcp_json_sync(mcp_path: Path) -> dict[str, Any]:
    """读单个 ``.mcp.json`` 返回其 ``mcpServers`` dict（to_thread 的同步段）。

    容错集与 daemon_rpc._read_mcp_json_sync / skills_view_service 一致：文件
    缺失 / OSError / JSON 解析失败 / 非 dict 结构 → 空 dict 不抛错（诊断路径
    与渲染路径同样全程容错）。
    """
    if not mcp_path.is_file():
        return {}
    try:
        raw = mcp_path.read_text(encoding="utf-8")
    except (OSError, PermissionError):
        return {}
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}
    if not isinstance(data, dict):
        return {}
    mcp_servers = data.get("mcpServers")
    return mcp_servers if isinstance(mcp_servers, dict) else {}
