"""ql-20260917-009：agent_run_logs 入库 NUL 字节清洗（TypeDecorator）。

生产实证（2026-09-17 阿里云部署后日志）：daemon 上报的 tool_result 内容含
NUL 字节（UTF-16 宽字符残段，如 ``docker: command not found`` 后跟
``\\x00N\\x00A\\x00M\\x00E`` 形态的 wmic/tasklist 输出），PG 的 VARCHAR/TEXT/JSON
不接受 U+0000（asyncpg CharacterNotInRepertoireError），整条 INSERT 拒收丢单条
日志。

方案：NulSafeStr/NulSafeText/NulSafeJSON（照 ConstraintsJSON TypeDecorator 先例）
在 SQLAlchemy bind 参数层剥 \\x00——SQLModel table 模型不走 pydantic 验证
（field_validator 无效），bind 层是全部构造/写入路径（submit_steps 主路径 /
service user_input / file_artifacts / mcp_tools / 群聊投影行）的单一收口；
impl 仍为 String/Text/JSON，DDL 零变化无迁移。
"""

from __future__ import annotations

import uuid

from app.modules.agent.model import AgentRunLog, NulSafeJSON, NulSafeStr, NulSafeText

PROD_SAMPLE = "docker: command not found\n \x00N\x00A\x00M\x00E\x00 \x00S\x00T\x00A\x00T\x00"
PROD_STRIPPED = "docker: command not found\n NAME STAT"


def test_nul_safe_str_bind() -> None:
    t = NulSafeStr(200)
    assert t.process_bind_param(PROD_SAMPLE, None) == PROD_STRIPPED
    assert t.process_bind_param("clean", None) == "clean"
    assert t.process_bind_param(None, None) is None


def test_nul_safe_text_bind() -> None:
    t = NulSafeText()
    assert t.process_bind_param(PROD_SAMPLE, None) == PROD_STRIPPED
    # 其余控制字符（\t\r\n）PG 可接受，不剥——保内容最大保真。
    ctrl = "a\tb\r\nc"
    assert t.process_bind_param(ctrl, None) == ctrl


def test_nul_safe_json_bind_deep() -> None:
    """metadata JSON 深层字符串（agent_event.content 原文）同样剥 NUL。"""
    t = NulSafeJSON()
    out = t.process_bind_param(
        {
            "agent_event": {
                "event_type": "tool_result",
                "content": PROD_SAMPLE,
                "nested": ["a\x00b", {"deep": "c\x00d", "num": 1, "none": None}],
            }
        },
        None,
    )
    assert isinstance(out, dict)
    ae = out["agent_event"]
    assert ae["content"] == PROD_STRIPPED
    nested = ae["nested"]
    assert isinstance(nested, list)
    assert nested[0] == "ab"
    assert isinstance(nested[1], dict)
    assert nested[1]["deep"] == "cd"
    assert nested[1]["num"] == 1 and nested[1]["none"] is None


def test_nul_safe_json_passthrough() -> None:
    t = NulSafeJSON()
    clean = {"k": "v", "n": 3}
    assert t.process_bind_param(clean, None) == clean
    assert t.process_bind_param(None, None) is None


def test_agent_run_log_columns_use_nul_safe_types() -> None:
    """七个清洗目标列 + metadata_ 全部挂 NulSafe 系列（防后续字段改动漂移）。"""
    expected = {
        "content_redacted": NulSafeText,
        "dedup_key": NulSafeStr,
        "parent_tool_use_id": NulSafeStr,
        "subagent_type": NulSafeStr,
        "tool_kind": NulSafeStr,
        "segment_id": NulSafeStr,
        "edit_patch": NulSafeText,
        "metadata_": NulSafeJSON,
    }
    for name, ty in expected.items():
        sa_column = AgentRunLog.model_fields[name].sa_column
        assert isinstance(sa_column.type, ty), f"{name} 应为 {ty.__name__}"


def test_roundtrip_sqlite_strips_on_flush() -> None:
    """端到端：含 NUL 的行经 SQLAlchemy flush 后库里为剥离值（bind 层真实生效）。"""
    import asyncio

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
    from sqlalchemy.ext.asyncio import create_async_engine as cae
    from sqlmodel import select

    async def run() -> None:
        engine = cae("sqlite+aiosqlite:///:memory:", future=True)
        async with engine.begin() as conn:
            await conn.run_sync(AgentRunLog.metadata.create_all)
        row = AgentRunLog(
            run_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
            channel="stdout",
            content_redacted=PROD_SAMPLE,
            dedup_key="k\x001",
            metadata_={"c": "x\x00y"},
        )
        factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
        async with factory() as session:
            session.add(row)
            await session.commit()
        # 新会话从库重读（同会话 identity map 会命中构造原对象，读不到 bind 层剥离值；
        # SQLite 本身接受 NUL 存储，剥离仅发生在写库 bind 参数——PG 则直接拒收）。
        async with factory() as session:
            got = (await session.execute(select(AgentRunLog).limit(1))).scalar_one()
            assert got.content_redacted == PROD_STRIPPED
            assert got.dedup_key == "k1"
            assert got.metadata_ == {"c": "xy"}
        await engine.dispose()

    asyncio.run(run())
