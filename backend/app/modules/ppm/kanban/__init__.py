"""ppm kanban 看板子域。

D-011@v1 新增两表:``ppm_kanban_comment``(评论) +
``ppm_kanban_subtask``(子任务),对齐源看板 TaskDetailDrawer 功能。
聚合 ``ppm_project_member``(人员) + ``ppm_plan_task``(任务卡片)。
设计依据:``design.md`` §7(kanban 端点)+ §13 X-001(人员=可见
project_member,可按 Organization 分组)+ §8 D-011(两新表)。
"""

# 触发 metadata 注册(task-01 D-011 两张新表)
from app.modules.ppm.kanban import model  # noqa: F401
