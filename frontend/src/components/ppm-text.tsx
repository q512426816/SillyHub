"use client";

/**
 * PpmText — id → 名字展示(表格列、只读视图用)。
 *
 * 对照源 dept_project_front 表格里把 dutyUserId / executeUserId 渲染成名字的场景。
 * 两种用法:
 *  1. 调用方已知名字:直接传 `name`,组件原样展示(零请求,首选)。
 *  2. 调用方只有 id:传 `value`,组件按 `res` 从对应 API 反查 label 并缓存。
 *
 * 反查策略:复用对应资源的 list 接口拉全量,本地建 id→label 映射并缓存到模块级
 * (同一资源在一次会话内只拉一次,避免表格 N 行触发 N 次请求)。
 *
 * 设计依据:.sillyspec/changes/2026-06-21-ppm-frontend-alignment/design.md §7
 *           .sillyspec/changes/2026-06-21-ppm-frontend-alignment/tasks/task-01.md
 */
import { useEffect, useState } from "react";

import { listRoles, listUsers } from "@/lib/admin";
import { listProjectMembers, listSimpleProjects } from "@/lib/ppm";
import type { PpmUserSelectRes } from "@/components/ppm-user-select";

export interface PpmTextProps {
  /** 资源类型(与 PpmUserSelect 一致)。 */
  res: PpmUserSelectRes;
  /** 主键值(user/project/projectMember=id;role=name)。 */
  value?: string | null;
  /** 已知名字时直接展示,跳过反查(优先级高于 value)。 */
  name?: string | null;
  /** 值为空时的兜底文案。 */
  fallback?: string;
  /** 额外查询参数(如 projectMember 需指定项目才能精确反查)。 */
  searchData?: Record<string, string | number | null | undefined>;
}

// ── 模块级缓存:res+searchData → Map<value,label> ──────────────────────────
//
// key = res + JSON.stringify(searchData),value = 该集合的 id→label 映射。
// 多页表格里同一资源复用缓存,避免每行重复请求。

interface CacheEntry {
  promise: Promise<Map<string, string>>;
  map?: Map<string, string>;
  err?: unknown;
}

const labelCache = new Map<string, CacheEntry>();

function cacheKey(res: PpmUserSelectRes, searchData?: PpmTextProps["searchData"]) {
  return res + "::" + JSON.stringify(searchData ?? {});
}

async function buildLabelMap(
  res: PpmUserSelectRes,
  searchData?: PpmTextProps["searchData"],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  switch (res) {
    case "user": {
      const { items } = await listUsers({ limit: 1000 });
      for (const u of items) map.set(u.id, u.display_name || u.email || u.username || u.id);
      break;
    }
    case "role": {
      const { items } = await listRoles({ size: 1000 });
      // D-009@v1: role 的 value=name,所以 key/name 都是 name。
      for (const r of items) map.set(r.name, r.name);
      break;
    }
    case "project": {
      const items = await listSimpleProjects();
      for (const p of items) map.set(p.id, p.project_name || p.id);
      break;
    }
    case "projectMember": {
      const q = searchData ?? {};
      const norm = (v: string | number | null | undefined): string | undefined =>
        v == null ? undefined : String(v);
      const items = await listProjectMembers({
        pm_project_id: norm(q.pm_project_id),
        role_name: norm(q.role_name),
        user_id: norm(q.user_id),
      });
      for (const m of items) map.set(m.user_id, m.user_name || m.user_id);
      break;
    }
  }
  return map;
}

function getOrCreateMap(
  res: PpmUserSelectRes,
  searchData?: PpmTextProps["searchData"],
): Promise<Map<string, string>> {
  const key = cacheKey(res, searchData);
  let entry = labelCache.get(key);
  if (!entry) {
    entry = { promise: buildLabelMap(res, searchData) };
    labelCache.set(key, entry);
    entry.promise
      .then((m) => {
        if (entry) entry.map = m;
      })
      .catch((err) => {
        if (entry) entry.err = err;
        // 失败清除缓存,允许下次重试。
        labelCache.delete(key);
      });
  }
  return entry.promise;
}

export function PpmText(props: PpmTextProps) {
  const { res, value, name, fallback = "-", searchData } = props;
  const [label, setLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 已知 name 直接用,无需请求。
  const directName = name ?? null;

  useEffect(() => {
    if (directName != null && directName !== "") {
      setLabel(directName);
      return;
    }
    if (value == null || value === "") {
      setLabel(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getOrCreateMap(res, searchData)
      .then((m) => {
        if (cancelled) return;
        setLabel(m.get(String(value)) ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setLabel(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [res, value, directName, JSON.stringify(searchData ?? {})]);

  if (loading && !directName) {
    return <span style={{ color: "#999" }}>加载中…</span>;
  }
  const text = directName ?? label;
  if (text == null || text === "") {
    if (value == null || value === "") return <span>{fallback}</span>;
    // 有 value 但映射里没找到(可能是旧数据/X-001 兼容):原样展示 value。
    return <span>{String(value)}</span>;
  }
  return <span>{text}</span>;
}

export default PpmText;
