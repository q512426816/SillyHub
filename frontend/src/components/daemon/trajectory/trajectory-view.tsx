"use client";

/**
 * 轨迹视图装配层（2026-10-22-trajectory-view-redesign / D-009 / D-012）。
 *
 * 布局（对齐 dsh ui-trajectory）：
 *   工具栏（32px，固定）→ 时间线（约 50px，固定）→ 账本（唯一滚动区）+ 详情面板。
 *
 * 本文件只持有交互状态与组合子组件：
 *   - 折叠集合（轮次 / 调用）与搜索词：实例内存状态，卸载即丢弃（R-03）；
 *   - 选中行：受控-可选（传 `selectedRowId` 即受控，与 dev 预览页一致）；
 *   - 时长模式：全局偏好，localStorage `sillyhub.trajectory.scaleMode`（D-020）。
 *
 * 纯数据推导在 trajectory-view-model.ts；渲染在 toolbar / ledger / detail-panel。
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import type { Trajectory } from "./build-trajectory";
import { TrajectoryDetailPanel } from "./trajectory-detail-panel";
import { TrajectoryLedger } from "./trajectory-ledger";
import { TrajectoryTimeline, type TrajectoryScaleMode } from "./trajectory-timeline";
import { TrajectoryToolbar } from "./trajectory-toolbar";
import {
  buildLedgerView,
  collectCollapsibleCallGroups,
  visibleRecordIds,
} from "./trajectory-view-model";

const SCALE_MODE_KEY = "sillyhub.trajectory.scaleMode";

function readScaleMode(): TrajectoryScaleMode {
  if (typeof window === "undefined") return "duration";
  try {
    return window.localStorage.getItem(SCALE_MODE_KEY) === "equal" ? "equal" : "duration";
  } catch {
    return "duration";
  }
}

function writeScaleMode(mode: TrajectoryScaleMode): void {
  try {
    window.localStorage.setItem(SCALE_MODE_KEY, mode);
  } catch {
    /* 隐私模式写入失败：静默 */
  }
}

export interface TrajectoryViewProps {
  trajectory: Trajectory;
  selectedRowId?: string | null;
  // eslint-disable-next-line no-unused-vars -- 接口回调签名形参
  onSelectRow?: (rowId: string | null) => void;
  className?: string;
}

export function TrajectoryView({
  trajectory,
  selectedRowId: selectedProp,
  onSelectRow: onSelectProp,
  className,
}: TrajectoryViewProps) {
  const controlled = selectedProp !== undefined;
  const [internalSelected, setInternalSelected] = useState<string | null>(null);
  const selectedRowId = controlled ? selectedProp : internalSelected;

  const [collapsedTurns, setCollapsedTurns] = useState<Set<number>>(() => new Set());
  const [collapsedCalls, setCollapsedCalls] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [scaleMode, setScaleMode] = useState<TrajectoryScaleMode>(readScaleMode);

  const setSelectedRow = useCallback(
    (rowId: string | null) => {
      if (onSelectProp) onSelectProp(rowId);
      if (!controlled) setInternalSelected(rowId);
    },
    [controlled, onSelectProp],
  );

  const callGroups = useMemo(() => collectCollapsibleCallGroups(trajectory), [trajectory]);
  const groups = useMemo(
    () => buildLedgerView(trajectory, { collapsedTurns, collapsedCalls, query }),
    [trajectory, collapsedTurns, collapsedCalls, query],
  );
  const visibleIds = useMemo(() => visibleRecordIds(groups), [groups]);

  // D-014：折叠/搜索使选中行不可见时清空选中（详情随之关闭）。
  useEffect(() => {
    if (selectedRowId && !visibleIds.includes(selectedRowId)) {
      setSelectedRow(null);
    }
  }, [selectedRowId, visibleIds, setSelectedRow]);

  const turnIndexes = useMemo(
    () => Array.from(new Set(trajectory.rows.map((row) => row.turnIndex))),
    [trajectory.rows],
  );

  const allTurnsCollapsed =
    turnIndexes.length > 0 && turnIndexes.every((index) => collapsedTurns.has(index));
  const allCallsCollapsed =
    callGroups.length > 0 && callGroups.every((group) => collapsedCalls.has(group.key));

  const toggleAllTurns = useCallback(() => {
    setCollapsedTurns(allTurnsCollapsed ? new Set() : new Set(turnIndexes));
  }, [allTurnsCollapsed, turnIndexes]);

  const toggleAllCalls = useCallback(() => {
    setCollapsedCalls(
      allCallsCollapsed ? new Set() : new Set(callGroups.map((group) => group.key)),
    );
  }, [allCallsCollapsed, callGroups]);

  const expandTurn = useCallback((turnIndex: number) => {
    setCollapsedTurns((previous) => {
      const next = new Set(previous);
      next.delete(turnIndex);
      return next;
    });
  }, []);

  const expandCalls = useCallback((key: string) => {
    setCollapsedCalls((previous) => {
      const next = new Set(previous);
      next.delete(key);
      return next;
    });
  }, []);

  const changeScaleMode = useCallback((mode: TrajectoryScaleMode) => {
    setScaleMode(mode);
    writeScaleMode(mode);
  }, []);

  return (
    <div
      className={cn(
        "@container flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background text-foreground",
        className,
      )}
    >
      <TrajectoryToolbar
        query={query}
        onQueryChange={setQuery}
        scaleMode={scaleMode}
        onScaleModeChange={changeScaleMode}
        allTurnsCollapsed={allTurnsCollapsed}
        onToggleAllTurns={toggleAllTurns}
        allCallsCollapsed={allCallsCollapsed}
        onToggleAllCalls={toggleAllCalls}
      />
      <TrajectoryTimeline
        trajectory={trajectory}
        selectedRowId={selectedRowId}
        onSelectRow={setSelectedRow}
        scaleMode={scaleMode}
      />
      <div className="relative flex min-h-0 flex-1">
        <TrajectoryLedger
          groups={groups}
          selectedRowId={selectedRowId}
          onSelectRow={setSelectedRow}
          onExpandTurn={expandTurn}
          onExpandCalls={expandCalls}
          query={query}
        />
        <TrajectoryDetailPanel
          trajectory={trajectory}
          selectedRowId={selectedRowId}
          onClose={() => setSelectedRow(null)}
        />
      </div>
    </div>
  );
}
