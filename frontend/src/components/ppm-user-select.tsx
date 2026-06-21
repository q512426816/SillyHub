"use client";

/**
 * PpmUserSelect — 通用资源下拉(user / role / project / projectMember)。
 *
 * 对照源 dept_project_front `components/Silly/SillySelect`(resConfig 6 资源),
 * 重写为 React + AntD Select,适配本仓 API 路径与字段约定:
 *
 *   res            | API                                            | value        | label
 *   ---------------|------------------------------------------------|--------------|------------------
 *   user           | /api/admin/users   (listUsers,  {items,total}) | id           | display_name / email
 *   role           | /api/admin/roles   (listRoles,  {items,total}) | name         | name           (D-009@v1: 角色值=name)
 *   project        | /api/ppm/project-maintenance/simple-list       | id           | project_name
 *   projectMember  | /api/ppm/project-member  (searchData 透传 query)| user_id      | user_name
 *
 * 能力(对齐 task-01 验收):
 *  - 服务端搜索(user/role 走 q/search;project/projectMember 本地过滤,后端无分页语义)
 *  - 分页:滚动到底部 loadMore(user/role 真服务端分页;project/projectMember 本地分页切片)
 *  - 初始值回填:受控 value,额外查询把已选 id 补进 options,保证 label 展示
 *  - 去重:options 按 value 去重
 *  - onChange 回传 value(单选标量 / 多选数组)
 *  - onLoadedOptions 透出全量 options(供 task-03 联动回填部门/手机)
 *  - searchData 变化重新拉取(projectMember 按项目/角色过滤)
 *
 * 设计依据:.sillyspec/changes/2026-06-21-ppm-frontend-alignment/design.md §7
 *           .sillyspec/changes/2026-06-21-ppm-frontend-alignment/tasks/task-01.md
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { message, Select, Spin, Tag } from "antd";
import type { DefaultOptionType } from "antd/es/select";

import { ApiError } from "@/lib/api";
import { listRoles, listUsers } from "@/lib/admin";
import {
  listProjectMembers,
  listSimpleProjects,
  type ProjectMember,
  type ProjectSimpleItem,
} from "@/lib/ppm";

// ── 类型 ─────────────────────────────────────────────────────────────────

export type PpmUserSelectRes = "user" | "projectMember" | "role" | "project";

/** 已选项回传的完整对象(onLoadedOptions / 未来 change-data 用)。 */
export interface PpmSelectOption {
  value: string;
  label: string;
  /** 原始记录(供调用方取 user_name / phone / role_name 等)。 */
  raw?: unknown;
}

export interface PpmUserSelectProps {
  /** 资源类型。 */
  res: PpmUserSelectRes;
  /**
   * 服务端查询参数(透传作 query)。典型:
   *  - projectMember: { pm_project_id, role_name }(配合 task-02 后端过滤)
   */
  searchData?: Record<string, string | number | null | undefined>;
  /** 受控值。单选为标量 string;多选为 string[]。 */
  value?: string | string[] | null;
  /** 选中变化回调。单选回传 string|null,多选回传 string[]。 */
  onChange?: (value: string | string[] | null) => void;
  /** 多选模式(multiple=标签可移除;tags=可自由输入)。 */
  mode?: "multiple" | "tags";
  /** 占位提示。 */
  placeholder?: string;
  /** 是否禁用。 */
  disabled?: boolean;
  /** 是否允许清空。 */
  allowClear?: boolean;
  /** 自定义样式(宽度等)。 */
  style?: React.CSSProperties;
  /** 拉到选项后回调(供 task-03 联动回填)。 */
  onLoadedOptions?: (options: PpmSelectOption[]) => void;
  /** 服务端分页大小(user/role 生效)。默认 20。 */
  pageSize?: number;
}

// ── 内部:资源适配器 ────────────────────────────────────────────────────────
//
// 两种后端语义:
//  - paged    : 支持 page/offset + 关键字,返回 {items,total}(user/role)
//  - fullList : 后端直返全量数组(project / projectMember),前端做本地过滤 + 本地分页

interface Adapter {
  kind: "paged" | "fullList";
  /** 拉一页。paged 返回 {items,total};fullList 忽略 page,返回全量(已应用 searchData)。 */
  fetchPage(args: {
    keyword: string;
    page: number; // 1-based
    pageSize: number;
    searchData?: Record<string, string | number | null | undefined>;
  }): Promise<{ items: PpmSelectOption[]; total: number }>;
}

const USER_ADAPTER: Adapter = {
  kind: "paged",
  async fetchPage({ keyword, page, pageSize }) {
    const { items, total } = await listUsers({
      q: keyword || undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return {
      total,
      items: items.map((u) => ({
        value: u.id,
        label: u.display_name || u.email,
        raw: u,
      })),
    };
  },
};

const ROLE_ADAPTER: Adapter = {
  kind: "paged",
  async fetchPage({ keyword, page, pageSize }) {
    // D-009@v1: 角色 value=name 字符串(对齐 auth.Role),label=name。
    const { items, total } = await listRoles({
      search: keyword || undefined,
      page,
      size: pageSize,
    });
    return {
      total,
      items: items.map((r) => ({ value: r.name, label: r.name, raw: r })),
    };
  },
};

const PROJECT_ADAPTER: Adapter = {
  kind: "fullList",
  async fetchPage({ keyword }) {
    const all: ProjectSimpleItem[] = await listSimpleProjects();
    const lower = keyword.trim().toLowerCase();
    const filtered = lower
      ? all.filter((p) => (p.project_name || "").toLowerCase().includes(lower))
      : all;
    return {
      total: filtered.length,
      items: filtered.map((p) => ({
        value: p.id,
        label: p.project_name || p.id,
        raw: p,
      })),
    };
  },
};

const PROJECT_MEMBER_ADAPTER: Adapter = {
  kind: "fullList",
  async fetchPage({ keyword, searchData }) {
    // searchData 透传作 query(pm_project_id / role_name 等,配合 task-02 后端过滤)。
    // 归一化 searchData 值为 string(ppm PageReq 字段为 string|null)。
    const q = searchData ?? {};
    const norm = (v: string | number | null | undefined): string | undefined =>
      v == null ? undefined : String(v);
    const all: ProjectMember[] = await listProjectMembers({
      pm_project_id: norm(q.pm_project_id),
      role_name: norm(q.role_name),
      user_id: norm(q.user_id),
    });
    const lower = keyword.trim().toLowerCase();
    const filtered = lower
      ? all.filter((m) => (m.user_name || "").toLowerCase().includes(lower))
      : all;
    return {
      total: filtered.length,
      items: filtered.map((m) => ({
        value: m.user_id,
        label: m.user_name || m.user_id,
        raw: m,
      })),
    };
  },
};

function getAdapter(res: PpmUserSelectRes): Adapter {
  switch (res) {
    case "user":
      return USER_ADAPTER;
    case "role":
      return ROLE_ADAPTER;
    case "project":
      return PROJECT_ADAPTER;
    case "projectMember":
      return PROJECT_MEMBER_ADAPTER;
  }
}

// ── 去重 ──────────────────────────────────────────────────────────────────

function dedupeOptions(list: PpmSelectOption[]): PpmSelectOption[] {
  const seen = new Set<string>();
  const out: PpmSelectOption[] = [];
  for (const it of list) {
    if (it.value == null || it.value === "") continue;
    if (seen.has(it.value)) continue;
    seen.add(it.value);
    out.push(it);
  }
  return out;
}

// ── 组件 ──────────────────────────────────────────────────────────────────

export function PpmUserSelect(props: PpmUserSelectProps) {
  const {
    res,
    searchData,
    value,
    onChange,
    mode,
    placeholder,
    disabled,
    allowClear = true,
    style,
    onLoadedOptions,
    pageSize = 20,
  } = props;

  const adapter = useMemo(() => getAdapter(res), [res]);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<PpmSelectOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");

  // 用于丢弃过期请求(关键字/searchData 变化时,旧请求结果不应覆盖新结果)。
  const reqIdRef = useRef(0);

  // 用于本地分页(fullList adapter)切片缓存,避免每页重复全量拉取。
  const fullListCacheRef = useRef<PpmSelectOption[] | null>(null);

  const isMultiple = mode === "multiple" || mode === "tags";

  // 拉一页(paged: 真服务端;fullList: 首页拉全量缓存,后续页切片)。
  const fetchPage = useCallback(
    async (nextPage: number, kw: string, reset: boolean) => {
      const myReqId = ++reqIdRef.current;
      setLoading(true);
      try {
        if (adapter.kind === "fullList" && !reset && fullListCacheRef.current) {
          // 命中本地缓存:直接切片。
          const cached = fullListCacheRef.current;
          const slice = cached.slice((nextPage - 1) * pageSize, nextPage * pageSize);
          if (myReqId === reqIdRef.current) {
            setOptions((prev) => dedupeOptions([...prev, ...slice]));
            setPage(nextPage);
          }
          return;
        }
        const { items, total: t } = await adapter.fetchPage({
          keyword: kw,
          page: nextPage,
          pageSize,
          searchData,
        });
        if (myReqId !== reqIdRef.current) return; // 过期
        if (adapter.kind === "fullList" && reset) {
          fullListCacheRef.current = items; // 缓存全量
        }
        setTotal(t);
        setOptions((prev) =>
          reset ? dedupeOptions(items) : dedupeOptions([...prev, ...items]),
        );
        setPage(nextPage);
      } catch (err) {
        // 下拉数据加载失败:提示用户(避免静默 console.error),下拉显示空。
        // 关键字搜索/翻页的失败不刷屏:仅在首屏重置时提示。
        if (reset && err instanceof ApiError) {
          message.error(err.message || "加载选项失败");
        }
      } finally {
        if (myReqId === reqIdRef.current) setLoading(false);
      }
    },
    [adapter, pageSize, searchData],
  );

  // 首屏 / res / searchData 变化:重置拉第一页。
  useEffect(() => {
    fullListCacheRef.current = null;
    void fetchPage(1, "", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, JSON.stringify(searchData ?? {})]);

  // options 变化时透出。
  useEffect(() => {
    onLoadedOptions?.(options);
  }, [options, onLoadedOptions]);

  // 已选值回填:确保 value 对应的 option 始终在列表里(单选/多选)。
  const valueArr = useMemo<string[]>(() => {
    if (value == null) return [];
    return Array.isArray(value) ? value.filter((v) => v != null) : [value];
  }, [value]);

  const mergedOptions = useMemo<PpmSelectOption[]>(() => {
    if (valueArr.length === 0) return options;
    const known = new Set(options.map((o) => o.value));
    const missing = valueArr.filter((v) => !known.has(v));
    if (missing.length === 0) return options;
    // 为缺失 value 补占位 option(label 用 value 兜底,展示不至于空白)。
    const placeholders: PpmSelectOption[] = missing.map((v) => ({
      value: v,
      label: v,
    }));
    return dedupeOptions([...options, ...placeholders]);
  }, [options, valueArr]);

  // 搜索:防抖 300ms(对齐源 dataFilter debounce 300)。
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearch = useCallback(
    (kw: string) => {
      setKeyword(kw);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        fullListCacheRef.current = null;
        void fetchPage(1, kw, true);
      }, 300);
    },
    [fetchPage],
  );

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  // 滚动到底部加载更多。
  const handlePopupScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const reachedBottom =
        el.scrollTop + el.clientHeight >= el.scrollHeight - 32;
      if (!reachedBottom || loading) return;
      // fullList: 用缓存判断是否还有下一页;paged: 用 total 判断。
      const loaded = options.length;
      const totalCount = adapter.kind === "fullList"
        ? fullListCacheRef.current?.length ?? total
        : total;
      if (totalCount > 0 && loaded >= totalCount) return;
      void fetchPage(page + 1, keyword, false);
    },
    [loading, options.length, total, adapter.kind, page, keyword, fetchPage],
  );

  const handleChange = useCallback(
    (next: unknown) => {
      if (isMultiple) {
        const arr = Array.isArray(next) ? (next as string[]) : [];
        onChange?.(arr);
      } else {
        onChange?.((next as string | undefined) ?? null);
      }
    },
    [isMultiple, onChange],
  );

  // 把 PpmSelectOption[] 转成 AntD option(保留 raw 供后续取字段)。
  const antOptions: DefaultOptionType[] = useMemo(
    () =>
      mergedOptions.map((o) => ({
        value: o.value,
        label: o.label,
        raw: o.raw,
      })),
    [mergedOptions],
  );

  return (
    <Select<string | string[]>
      mode={mode}
      value={value as string | string[] | undefined}
      onChange={handleChange}
      onSearch={handleSearch}
      onPopupScroll={handlePopupScroll}
      onDropdownVisibleChange={(v) => setOpen(v)}
      open={open}
      showSearch
      filterOption={false} // 服务端/本地已过滤,关闭 AntD 内置过滤
      placeholder={placeholder ?? "请选择"}
      disabled={disabled}
      allowClear={allowClear}
      style={{ width: "100%", ...style }}
      options={antOptions}
      notFoundContent={
        loading ? <Spin size="small" /> : <Tag color="default">无数据</Tag>
      }
      optionFilterProp="label"
      tagRender={
        mode === "tags"
          ? (tagProps) => (
              <Tag
                color="blue"
                closable={!disabled}
                onClose={tagProps.onClose}
                style={{ marginInlineEnd: 4 }}
              >
                {tagProps.label}
              </Tag>
            )
          : undefined
      }
    />
  );
}

export default PpmUserSelect;
