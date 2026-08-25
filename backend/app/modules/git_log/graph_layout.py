"""Git 提交泳道图（lane）布局纯函数（design §5.3 / §7.3，D-004）。

算法移植自 Gitea ``modules/git/graph`` 的泳道分配思路：对按新→旧序排列的提交
序列做单趟扫描，为每个提交分配确定的泳道编号（lane）与父提交连线（edges），
前端 SVG 泳道图只做纯渲染、不再自行计算布局。

扫描过程维护一个有序活跃槽列表 ``lanes``（下标即 lane 编号）：

* 元素为该槽正在等待的下一个提交哈希——语义是"这条泳道向下延伸时期待遇到
  的提交"；``None`` 表示空闲槽（已回收，可被后续分叉复用，保证编号紧凑）；
* 当前提交哈希命中槽时（可能多条子分支等待同一提交，即汇合场景）：取最左
  命中槽作为本提交 lane，其余命中槽回收置空；未命中任何槽（分支尖端 / 被
  过滤后的起点）则取最左空闲槽，无空闲时追加新槽；
* 处理 parents：第一 parent 继承当前槽继续下延；其余 parent 若已有槽在等待
  同一哈希则复用（不新开槽），否则取最左空闲槽——即分叉；根提交（无
  parent）在处理后回收自己的槽。

edges 在扫描结束后按最终 lane 统一解析：parent 存在于结果集（按哈希定位其
index / lane）才产生一条边，目标 lane 与本提交 lane 相同为 ``straight``、不同
为 ``curve``；parent 不在结果集（分支 / 作者过滤、lookahead 截断或更早历史）
时不产边，lane 分配不受影响（CC-03 退化行为）。

确定性保证：全程只做列表按下标顺序扫描与字典按哈希定位，无 set 迭代序、
无随机、无 IO、无全局状态——同一输入（含同一前缀）任意次调用输出全等；
因此 service 对 ``commits[:skip+limit+lookahead]`` 全前缀计算后截取窗口，
窗口内 lane 与全量计算逐条一致（D-004 跨页一致性）。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

EdgeKind = Literal["straight", "curve"]


@dataclass(frozen=True, slots=True)
class CommitRef:
    """lane 计算输入：结果集中的一条提交（列表整体按新→旧序）。

    index 通常传全局绝对序（service 侧 seq），仅透传到输出、不参与计算；
    hash / parents 为全长哈希，parents 第一位是第一 parent。
    """

    index: int
    hash: str
    parents: list[str]


@dataclass(frozen=True, slots=True)
class Edge:
    """一条父连线，指向结果集内的目标提交。"""

    to_index: int
    to_lane: int
    kind: EdgeKind


@dataclass(frozen=True, slots=True)
class CommitLayout:
    """lane 计算输出：与输入 CommitRef 按列表位置一一对应。"""

    index: int
    lane: int
    edges: list[Edge]


def compute_lanes(commits: Sequence[CommitRef]) -> list[CommitLayout]:
    """对按新→旧序排列的提交序列计算泳道布局（纯函数）。

    只依赖列表顺序与各条目自身字段，无 IO / 无随机 / 无全局状态，也不修改
    入参；同一前缀输入的输出恒等，窗口截取（skip/limit）不影响前缀 lane 分配。
    """
    # 第一趟：按下标顺序分配 lane。状态只由已处理前缀决定 → 天然前缀不变。
    lanes: list[str | None] = []  # 下标 = lane 编号；值 = 槽等待的哈希；None = 空闲
    lane_by_pos: list[int] = []

    for commit in commits:
        # 该哈希的命中槽：可能多个（多条子分支汇合于同一提交）。
        hit_slots = [pos for pos, waiting in enumerate(lanes) if waiting == commit.hash]
        if hit_slots:
            lane = hit_slots[0]  # 最左命中槽即本提交 lane
            for pos in hit_slots[1:]:  # 汇合后多余槽回收，编号可供后续分叉复用
                lanes[pos] = None
        else:
            # 分支尖端 / 被过滤后的起点：取最左空闲槽（无则追加，保持编号紧凑）。
            lane = _occupy_leftmost_free(lanes, commit.hash)
        if commit.parents:
            lanes[lane] = commit.parents[0]  # 第一 parent 继承当前槽
            for parent in commit.parents[1:]:
                if parent not in lanes:  # 已有槽等待同一 parent 则复用，不新开
                    _occupy_leftmost_free(lanes, parent)
        else:
            lanes[lane] = None  # 根提交：槽回收
        lane_by_pos.append(lane)

    # 第二趟：按最终 lane 解析父边；结果集外的 parent 不产边（过滤 / lookahead 截断）。
    target_by_hash = {
        commit.hash: (commit.index, lane_by_pos[pos]) for pos, commit in enumerate(commits)
    }

    layouts: list[CommitLayout] = []
    for pos, commit in enumerate(commits):
        lane = lane_by_pos[pos]
        edges: list[Edge] = []
        for parent in commit.parents:
            target = target_by_hash.get(parent)
            if target is None:
                continue
            to_index, to_lane = target
            edges.append(
                Edge(
                    to_index=to_index,
                    to_lane=to_lane,
                    kind="straight" if to_lane == lane else "curve",
                )
            )
        layouts.append(CommitLayout(index=commit.index, lane=lane, edges=edges))
    return layouts


def _occupy_leftmost_free(lanes: list[str | None], waiting: str) -> int:
    """让 waiting 占据最左空闲槽并返回槽号；无空闲则追加新槽（保持编号紧凑）。"""
    for pos, occupant in enumerate(lanes):
        if occupant is None:
            lanes[pos] = waiting
            return pos
    lanes.append(waiting)
    return len(lanes) - 1
