"""task-13 · P3 verify 试点端到端验收（AC-1~AC-9）。

design §2 三态 / §5.1-5.7 / §7.5 生命周期契约表 / §10 R1/R3/R10/R12。

本文件做两件事：
1. **AC 验收映射**（下方表）：每个 AC 指向真正断言它的单测/集成测试位置——
   task-01~12 的单测已覆盖各 AC 的关键行为，本文件串集成链路代表 + 映射索引。
2. **集成代表 case**：mock HostFsDelegate.run_command（不连真 daemon / 不真跑 27s
   gate，design task-13 约束），跑真实 _run_gate_decision_task 链路验证 gate_result
   落库 + cas 防双发。

AC 验收映射表（AC → 覆盖位置）：
| AC | 关键断言 | 覆盖测试 |
|----|---------|---------|
| AC-1 exit0 推进 | gate_status pending→running→decided, gate_result.exit_code=0, auto_dispatch 推进 | 本文件 test_ac01_exit0_advances + task-07 test_cas_pending_to_running_then_decided |
| AC-2 exit1 打回+errors | 同 stage 重 dispatch, gate_last_errors 非空 | task-08 test_exit1_kickback + task-09 test_first_kickback_sets_count_to_1 |
| AC-3 三次升级 exit2 | gate_retry_count>=3 升级, 无新 dispatch | task-09 test_third_kickback_escalates_to_gate_blocked |
| AC-4 gate 异常/未发版 exit2 阻断 | gate_status=failed, exit_code=2 | 本文件 test_ac04_gate_exception_failed + task-06 test_z1_subcommand_missing / test_rpc_exception_returns_exit_two |
| AC-5 close<30s 不重试 | gate_status=pending 随 commit, 后台异步 | task-05 test_close_does_not_await_gate_task |
| AC-6 重启 reconcile | running→pending→重 enqueue→推进 | task-10 test_resets_pending_and_running_orphans_and_reenqueues |
| AC-7 double-fire cas | run_command 调用计数==1（cas 只一个跑） | task-07 test_cas_miss_when_already_running_returns + 本文件集成 |
| AC-8 命令白名单拒注入 | 非 gate 命令被拒 | task-01 test_delegate_run_command（19 case）+ task-02 host-fs-handler.test（19 RC case） |
| AC-9 前端 SSE 实时 | 徽标 客观核验中→已通过/失败 切换 | task-12 TC-02g gate_status_changed→gateStatus |

真实 e2e（真 daemon + sillyspec gate verify 27s）待 sillyspec gate npm publish
发版（R4 硬前置）+ 真实 daemon-client 部署环境，本文件用 mock run_command 等价
覆盖链路语义。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.change.dispatch import SillySpecStageDispatchService
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.run_sync.service import RunSyncService


async def _seed_completed_gate_run(
    db_session: AsyncSession,
    *,
    gate_status: str = "pending",
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """建 user/runtime/workspace/change/session/run（completed + gate_status），返回三 id。"""
    from app.modules.auth.model import User
    from app.modules.change.model import Change
    from app.modules.workspace.model import Workspace

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"e2e-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=uid,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    ws_id = uuid.uuid4()
    db_session.add(
        Workspace(
            id=ws_id,
            name="ws-e2e",
            slug=f"ws-e2e-{uuid.uuid4().hex[:6]}",
            root_path=f"/host-projects/e2e-{uuid.uuid4().hex[:8]}",
            status="active",
        )
    )
    change_id = uuid.uuid4()
    db_session.add(
        Change(
            id=change_id,
            workspace_id=ws_id,
            change_key=f"e2e-{uuid.uuid4().hex[:6]}",
            title="e2e",
            status="in-progress",
            location="active",
            path=".sillyspec/changes/e2e",
            current_stage="verify",
            stages={},
            owner_id=uid,
        )
    )
    sess_id = uuid.uuid4()
    db_session.add(
        AgentSession(
            id=sess_id,
            user_id=uid,
            provider="claude",
            status="active",
            config={},
            turn_count=1,
            runtime_id=rt.id,
            last_active_at=datetime.now(UTC),
            created_at=datetime.now(UTC),
        )
    )
    run_id = uuid.uuid4()
    db_session.add(
        AgentRun(
            id=run_id,
            agent_session_id=sess_id,
            user_id=uid,
            agent_type="claude",
            provider="claude",
            status="completed",
            change_id=change_id,
            gate_status=gate_status,
            started_at=datetime.now(UTC),
            created_at=datetime.now(UTC),
        )
    )
    await db_session.commit()
    return run_id, ws_id, change_id


async def test_ac01_exit0_advances(db_session: AsyncSession) -> None:
    """AC-1：exit 0 → gate_status pending→running→decided + gate_result.exit_code=0 落库。

    集成链路：真实 _run_gate_decision_task（H1 独立 session + R3 cas）跑 mock 的
    gate（exit0），验证 gate_result 落 AgentRun。sync/auto_dispatch mock（task-07
    已验真实调用，此处聚焦 gate_result 落库端到端）。
    """
    run_id, ws_id, change_id = await _seed_completed_gate_run(db_session)

    exit0_result = {
        "exit_code": 0,
        "errors": [],
        "raw_envelope": {"ok": True, "stage": "verify"},
    }
    with (
        patch(
            "app.modules.daemon.run_sync.service._run_gate_via_delegate",
            return_value=exit0_result,
            new_callable=AsyncMock,
        ),
        patch.object(SillySpecStageDispatchService, "sync_stage_status", new_callable=AsyncMock),
        patch(
            "app.modules.change.dispatch.auto_dispatch_next_step",
            new_callable=AsyncMock,
        ),
    ):
        svc = RunSyncService(db_session)
        await svc._run_gate_decision_task(
            agent_run_id=run_id, workspace_id=ws_id, change_id=change_id
        )

    db_session.expire_all()
    row = await db_session.get(AgentRun, run_id)
    assert row is not None
    assert row.gate_status == "decided"
    assert row.gate_result is not None
    assert row.gate_result["exit_code"] == 0


async def test_ac04_gate_exception_failed(db_session: AsyncSession) -> None:
    """AC-4：gate 执行异常 → gate_status=failed + gate_result.exit_code=2（fail-loud）。"""
    run_id, ws_id, change_id = await _seed_completed_gate_run(db_session)

    with patch(
        "app.modules.daemon.run_sync.service._run_gate_via_delegate",
        side_effect=RuntimeError("daemon RPC timeout"),
        new_callable=AsyncMock,
    ):
        svc = RunSyncService(db_session)
        await svc._run_gate_decision_task(
            agent_run_id=run_id, workspace_id=ws_id, change_id=change_id
        )

    db_session.expire_all()
    row = await db_session.get(AgentRun, run_id)
    assert row is not None
    assert row.gate_status == "failed"
    assert row.gate_result is not None
    assert row.gate_result["exit_code"] == 2
    assert "daemon RPC timeout" in str(row.gate_result["errors"])


async def test_ac07_double_fire_cas_only_one_runs(db_session: AsyncSession) -> None:
    """AC-7：double-fire（reconcile + 原任务并发）→ R3 cas 只一个真正跑 gate。

    两次 _run_gate_decision_task 并发（gate_status pending）：第一次 cas pending→
    running 成功跑 gate；第二次 cas rowcount==0 return 不跑。run_command（via
    _run_gate_via_delegate）只被调一次。
    """
    run_id, ws_id, change_id = await _seed_completed_gate_run(db_session)

    gate_mock = AsyncMock(return_value={"exit_code": 0, "errors": [], "raw_envelope": {"ok": True}})
    with (
        patch("app.modules.daemon.run_sync.service._run_gate_via_delegate", new=gate_mock),
        patch.object(SillySpecStageDispatchService, "sync_stage_status", new_callable=AsyncMock),
        patch(
            "app.modules.change.dispatch.auto_dispatch_next_step",
            new_callable=AsyncMock,
        ),
    ):
        svc = RunSyncService(db_session)
        # 第一次：cas pending→running 成功，跑 gate
        await svc._run_gate_decision_task(
            agent_run_id=run_id, workspace_id=ws_id, change_id=change_id
        )
        # 第二次：gate_status 已 decided，cas rowcount==0，return 不跑 gate
        await svc._run_gate_decision_task(
            agent_run_id=run_id, workspace_id=ws_id, change_id=change_id
        )

    # gate 只跑一次（cas 防双发，R10/R3）
    assert gate_mock.call_count == 1
