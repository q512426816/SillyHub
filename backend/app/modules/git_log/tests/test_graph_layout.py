"""graph_layout.compute_lanes 单测（design §5.5）。

覆盖七类拓扑：线性链 / 分叉 / 合并 / 复合 / 槽回收复用 / 窗口截取一致性 /
lookahead 退化，以及确定性（同一输入多次调用输出全等）。全部为纯函数测试，
不依赖 DB / RPC / 文件系统。
"""

from __future__ import annotations

from app.modules.git_log.graph_layout import (
    CommitRef,
    Edge,
    compute_lanes,
)


def _make_commits(*specs: tuple[str, tuple[str, ...]]) -> list[CommitRef]:
    """按 (哈希, parents) 逐条构造新→旧序输入，index 取列表位置。"""
    return [
        CommitRef(index=pos, hash=name, parents=list(parents))
        for pos, (name, parents) in enumerate(specs)
    ]


class TestLinearChain:
    """线性链：单线历史，全部 lane=0，父边均为 straight。"""

    def test_all_commits_on_lane_zero(self) -> None:
        commits = _make_commits(
            ("c3", ("c2",)),
            ("c2", ("c1",)),
            ("c1", ()),
        )
        layouts = compute_lanes(commits)
        assert [layout.lane for layout in layouts] == [0, 0, 0]

    def test_all_edges_straight_to_next_commit(self) -> None:
        commits = _make_commits(
            ("c3", ("c2",)),
            ("c2", ("c1",)),
            ("c1", ()),
        )
        layouts = compute_lanes(commits)
        assert layouts[0].edges == [Edge(to_index=1, to_lane=0, kind="straight")]
        assert layouts[1].edges == [Edge(to_index=2, to_lane=0, kind="straight")]

    def test_root_commit_has_no_edges(self) -> None:
        commits = _make_commits(
            ("c3", ("c2",)),
            ("c2", ("c1",)),
            ("c1", ()),
        )
        layouts = compute_lanes(commits)
        assert layouts[2].edges == []


class TestFork:
    """分叉：第二分支取最左空闲槽，lane 编号连续无空洞。

    拓扑（新→旧）：m 的 parents 为 a、b，a/b 各自下延到 base。
    """

    @staticmethod
    def _commits() -> list[CommitRef]:
        return _make_commits(
            ("m", ("a", "b")),
            ("a", ("base",)),
            ("b", ("base",)),
            ("base", ()),
        )

    def test_second_branch_takes_leftmost_free_lane(self) -> None:
        layouts = compute_lanes(self._commits())
        assert [layout.lane for layout in layouts] == [0, 0, 1, 0]

    def test_lane_numbers_compact_without_holes(self) -> None:
        layouts = compute_lanes(self._commits())
        assert sorted({layout.lane for layout in layouts}) == [0, 1]

    def test_fork_edges(self) -> None:
        layouts = compute_lanes(self._commits())
        # m：第一 parent a 同泳道直线；第二 parent b 弯入 lane 1。
        assert layouts[0].edges == [
            Edge(to_index=1, to_lane=0, kind="straight"),
            Edge(to_index=2, to_lane=1, kind="curve"),
        ]
        # b 在 lane 1，汇入 base（lane 0）为 curve。
        assert layouts[2].edges == [Edge(to_index=3, to_lane=0, kind="curve")]

    def test_orphan_tip_takes_leftmost_free_lane(self) -> None:
        """哈希不在任何槽（过滤后的独立分支尖端）也取最左空闲槽。"""
        commits = _make_commits(
            ("t1", ("x",)),
            ("t2", ()),
            ("x", ()),
        )
        layouts = compute_lanes(commits)
        assert [layout.lane for layout in layouts] == [0, 1, 0]


class TestMerge:
    """合并：merge 各 parent 边复用或指派正确槽位（to_lane 断言）。

    拓扑（新→旧）：c4 是 merge（parents c2、c3），两支在 c1 汇合。
    """

    @staticmethod
    def _commits() -> list[CommitRef]:
        return _make_commits(
            ("c4", ("c2", "c3")),
            ("c3", ("c1",)),
            ("c2", ("c1",)),
            ("c1", ()),
        )

    def test_merge_lanes(self) -> None:
        layouts = compute_lanes(self._commits())
        assert [layout.lane for layout in layouts] == [0, 1, 0, 0]

    def test_merge_parent_edges_carry_correct_to_lane(self) -> None:
        layouts = compute_lanes(self._commits())
        # 边序跟随 parents 序：第一 parent c2（index 2，lane 0）直线；
        # 第二 parent c3（index 1，lane 1）弯出分叉槽。
        assert layouts[0].edges == [
            Edge(to_index=2, to_lane=0, kind="straight"),
            Edge(to_index=1, to_lane=1, kind="curve"),
        ]

    def test_both_branches_converge_to_merge_base(self) -> None:
        layouts = compute_lanes(self._commits())
        # c3（lane 1）汇入 c1（lane 0）为 curve；c2（lane 0）沿本泳道直线到 c1。
        assert layouts[1].edges == [Edge(to_index=3, to_lane=0, kind="curve")]
        assert layouts[2].edges == [Edge(to_index=3, to_lane=0, kind="straight")]


class TestCompositeTopology:
    """复合：分叉+合并混合拓扑，与手工推演对照。

    拓扑（新→旧，手工推演 lane）::

        idx0 m2(merge f+m1)  lane 0
        idx1 f               lane 0
        idx2 m1(merge d+e)   lane 1
        idx3 d               lane 1
        idx4 e               lane 2
        idx5 c(root)         lane 0
    """

    @staticmethod
    def _commits() -> list[CommitRef]:
        return _make_commits(
            ("m2", ("f", "m1")),
            ("f", ("c",)),
            ("m1", ("d", "e")),
            ("d", ("c",)),
            ("e", ("c",)),
            ("c", ()),
        )

    def test_lane_assignment_matches_manual_trace(self) -> None:
        layouts = compute_lanes(self._commits())
        assert [layout.lane for layout in layouts] == [0, 0, 1, 1, 2, 0]

    def test_edges_match_manual_trace(self) -> None:
        layouts = compute_lanes(self._commits())
        assert layouts[0].edges == [
            Edge(to_index=1, to_lane=0, kind="straight"),
            Edge(to_index=2, to_lane=1, kind="curve"),
        ]
        assert layouts[1].edges == [Edge(to_index=5, to_lane=0, kind="straight")]
        assert layouts[2].edges == [
            Edge(to_index=3, to_lane=1, kind="straight"),
            Edge(to_index=4, to_lane=2, kind="curve"),
        ]
        assert layouts[3].edges == [Edge(to_index=5, to_lane=0, kind="curve")]
        assert layouts[4].edges == [Edge(to_index=5, to_lane=0, kind="curve")]
        assert layouts[5].edges == []


class TestSlotRecycling:
    """槽回收：分支终结（汇合）后槽位回收并被后续更早的分叉复用。

    拓扑（新→旧）：c4 merge c2+c3，两支在 c1 汇合（lane 1 回收）；
    更早处 d0 再次分叉出 d2，d2 必须复用 lane 1 而非新开 lane 2。
    """

    @staticmethod
    def _commits() -> list[CommitRef]:
        return _make_commits(
            ("c4", ("c2", "c3")),
            ("c3", ("c1",)),
            ("c2", ("c1",)),
            ("c1", ("d0",)),
            ("d0", ("d1", "d2")),
            ("d1", ("e",)),
            ("d2", ("e",)),
            ("e", ()),
        )

    def test_recycled_slot_reused_by_later_fork(self) -> None:
        layouts = compute_lanes(self._commits())
        assert [layout.lane for layout in layouts] == [0, 1, 0, 0, 0, 0, 1, 0]
        # 第二次分叉（d2）复用已回收的 lane 1，而不是新开 lane 2。
        assert layouts[6].lane == 1

    def test_lane_numbers_back_to_compact(self) -> None:
        layouts = compute_lanes(self._commits())
        assert max(layout.lane for layout in layouts) == 1


class TestWindowConsistency:
    """窗口一致：对前缀（skip+limit）计算后取窗口，与全量计算逐条一致。

    拓扑为"分叉阶梯"（12 条，新→旧）：m3 分叉 t1/t2 汇于 m2，m2 分叉 u1/u2
    汇于 m1，m1 分叉 v1/v2 汇于 c，c 下延 r1、r2 到根。
    """

    @staticmethod
    def _commits() -> list[CommitRef]:
        return _make_commits(
            ("m3", ("t1", "t2")),
            ("t1", ("m2",)),
            ("t2", ("m2",)),
            ("m2", ("u1", "u2")),
            ("u1", ("m1",)),
            ("u2", ("m1",)),
            ("m1", ("v1", "v2")),
            ("v1", ("c",)),
            ("v2", ("c",)),
            ("c", ("r1",)),
            ("r1", ("r2",)),
            ("r2", ()),
        )

    def test_window_lanes_match_full_computation(self) -> None:
        commits = self._commits()
        skip, limit = 3, 5
        full = compute_lanes(commits)
        prefix = compute_lanes(commits[: skip + limit])
        for offset in range(skip, skip + limit):
            assert prefix[offset].lane == full[offset].lane

    def test_window_edges_match_full_computation_for_in_window_targets(self) -> None:
        """窗口内边的目标也落在前缀内时，边与全量计算完全一致；
        指向前缀外的边（本夹具不存在，由 lookahead 用例覆盖）按定义剔除。"""
        commits = self._commits()
        skip, limit = 3, 5
        full = compute_lanes(commits)
        prefix = compute_lanes(commits[: skip + limit])
        for offset in range(skip, skip + limit):
            expected = [edge for edge in full[offset].edges if edge.to_index < skip + limit]
            assert prefix[offset].edges == expected

    def test_first_page_matches_full(self) -> None:
        commits = self._commits()
        assert compute_lanes(commits) == compute_lanes(commits[: len(commits)])


class TestLookaheadDegradation:
    """lookahead 退化：父边目标超出结果集（50 条窗口）时不产该边且 lane 不变。

    夹具：60 条线性主干 s0..s59（parent 为下一条），s5 改为 merge（第二父边
    目标 s55 落在 50 条之外），s20 为窗口内普通 merge（第二父边目标 s40）。
    """

    @staticmethod
    def _commits() -> list[CommitRef]:
        commits = _make_commits(*[(f"s{i}", (f"s{i + 1}",)) for i in range(59)] + [("s59", ())])
        commits[5] = CommitRef(index=5, hash="s5", parents=["s6", "s55"])
        commits[20] = CommitRef(index=20, hash="s20", parents=["s21", "s40"])
        return commits

    def test_edge_beyond_lookahead_not_emitted(self) -> None:
        layouts = compute_lanes(self._commits()[:50])
        # s5 只保留指向 s6 的边；s55 不在结果集 → 无该边、无出界短线。
        assert layouts[5].edges == [Edge(to_index=6, to_lane=0, kind="straight")]

    def test_lanes_unchanged_by_truncation(self) -> None:
        commits = self._commits()
        truncated = compute_lanes(commits[:50])
        full = compute_lanes(commits)
        assert [layout.lane for layout in truncated] == [layout.lane for layout in full[:50]]

    def test_merge_lane_stable_with_and_without_far_parent(self) -> None:
        commits = self._commits()
        truncated = compute_lanes(commits[:50])
        full = compute_lanes(commits)
        assert truncated[5].lane == full[5].lane == 0
        # 全量计算中该长边存在（to_index/to_lane 指向 s55 的最终槽位）。
        assert [(e.to_index, e.to_lane) for e in full[5].edges] == [(6, 0), (55, 0)]


class TestDeterminism:
    """确定性：同一输入多次调用输出全等；等价输入重建后输出全等。"""

    @staticmethod
    def _commits() -> list[CommitRef]:
        return _make_commits(
            ("m", ("a", "b")),
            ("a", ("base",)),
            ("b", ("base",)),
            ("base", ()),
        )

    def test_repeated_calls_produce_identical_output(self) -> None:
        commits = self._commits()
        assert compute_lanes(commits) == compute_lanes(commits)

    def test_equivalent_rebuilt_input_produces_identical_output(self) -> None:
        """等价输入的不同构造顺序（倒序构造再反转 + 全新对象）输出全等。"""
        spec: dict[str, tuple[str, ...]] = {
            "m": ("a", "b"),
            "a": ("base",),
            "b": ("base",),
            "base": (),
        }
        order = ["m", "a", "b", "base"]
        rebuilt = [
            CommitRef(index=pos, hash=name, parents=list(spec[name]))
            for pos, name in enumerate(reversed(order[::-1]))
        ]
        assert rebuilt == self._commits()
        assert compute_lanes(rebuilt) == compute_lanes(self._commits())

    def test_empty_input_returns_empty(self) -> None:
        assert compute_lanes([]) == []

    def test_input_not_mutated(self) -> None:
        commits = self._commits()
        snapshot = [(c.index, c.hash, list(c.parents)) for c in commits]
        compute_lanes(commits)
        assert [(c.index, c.hash, list(c.parents)) for c in commits] == snapshot
