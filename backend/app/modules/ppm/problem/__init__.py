"""problem 问题清单子域 (4 节点审批流状态机)。

6 张表 + 4 节点审批流:申请(10)→开发经理(20)→项目经理(30)→
[非bug部门经理(40)]→处置中→待验证→已关闭;驳回→已作废。
"""

from __future__ import annotations

__all__: list[str] = []
