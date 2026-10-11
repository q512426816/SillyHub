"""alembic 迁移单头守卫（2026-10-11-alembic-single-head-guard FR-01）。

生产实证（2026-10-11）：并行变更各自新增迁移未合流即部署——两条 revision 同父分叉，
backend 容器 ``alembic upgrade head`` 报 ``Multiple head revisions`` crash-loop，平台
宕机约 2 分钟（回滚 backup-20261011-1907 保服务后手工 ``alembic merge heads`` 修复）。
本测试在 CI 测试套件内把该形态提前拦成红灯：heads 必须恰一个，多头即 fail 并给出
merge 解法提示。

实现走 alembic API（ScriptDirectory.get_heads），不 shell out——CI/本地环境无差异。
部署侧同款守卫见 deploy/scripts/build-and-save.sh 预检步骤（双闸：CI 拦 PR、脚本拦
打镜像）。
"""

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


def test_alembic_single_head() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    script = ScriptDirectory.from_config(Config(str(backend_root / "alembic.ini")))
    heads = script.get_heads()
    assert len(heads) == 1, (
        "alembic 迁移多头（并行变更各自加迁移未合流）——部署会 crash-loop："
        f"当前 heads={heads}。解法：cd backend && python -m alembic merge heads "
        '-m "merge parallel heads ..." 后提交 merge revision（纯 DAG 接线无 DDL）。'
        "（生产实证 2026-10-11：Multiple head revisions 宕机）"
    )
