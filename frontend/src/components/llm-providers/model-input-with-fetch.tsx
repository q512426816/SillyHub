"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Download, Loader2 } from "lucide-react";

/**
 * 从供应商上游 /v1/models 拉到的模型条目。
 * 字段名对齐后端响应（owned_by 下划线），不照抄 cc-switch 的驼峰 ownedBy。
 */
export interface FetchedModel {
  id: string;
  owned_by: string | null;
}

export interface ModelInputWithFetchProps {
  value: string;
  onChange: (value: string) => void;
  /** 非空时在 Input 旁显示按 owned_by 分组的选择下拉。 */
  fetchedModels?: FetchedModel[];
  /** 拉取中：在 Input 旁显示 spinner 占位。 */
  isLoading?: boolean;
  /** 传入时显示「获取」按钮触发拉取；不传且无数据则退化为纯 Input（手填）。 */
  onFetch?: () => void;
  /** 透传给内部 Input 的 placeholder（保留角色行原占位文案，兼容表单单测按 placeholder 定位）。 */
  placeholder?: string;
}

/** 无 owned_by（null 或空白）的模型归到此分组（中文兜底，不照抄 cc-switch 的 "Other"）。 */
const OTHER_GROUP_LABEL = "其他";

/**
 * 模型输入框（带可选的获取/下拉选）。
 *
 * 三态分支（按优先级，对齐 cc-switch ModelInputWithFetch + design §6.1）：
 *   1. fetchedModels 非空 → Input + DropdownMenu（按 owned_by 分组，DropdownMenuItem onSelect 调 onChange(model.id)）
 *   2. isLoading=true     → Input + Loader2 spinner
 *   3. 有 onFetch         → Input + Download「获取」按钮（title 获取模型列表）
 *   4. 否则                → 纯 Input（手填）
 *
 * 组件纯展示 + 回调，不自己发请求（请求由父组件 task-09 经 task-11 的 fetchProviderModels 发）。
 */
export function ModelInputWithFetch({
  value,
  onChange,
  fetchedModels,
  isLoading = false,
  onFetch,
  placeholder,
}: ModelInputWithFetchProps) {
  const hasModels = (fetchedModels?.length ?? 0) > 0;

  // 态 1: 有模型数据 → Input + 按 owned_by 分组的下拉
  if (hasModels && fetchedModels) {
    const grouped = groupByOwnedBy(fetchedModels);
    const vendors = Object.keys(grouped).sort();

    return (
      <div className="flex gap-1">
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          placeholder={placeholder}
          className="flex-1"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-9 w-9 shrink-0 p-0"
              title="选择模型"
              aria-label="选择模型"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="max-h-64 overflow-y-auto z-[200]"
          >
            {vendors.map((vendor, vi) => {
              const list = grouped[vendor] ?? [];
              return (
                <div key={vendor}>
                  {vi > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel>{vendor}</DropdownMenuLabel>
                  {list.map((model, mi) => (
                    <DropdownMenuItem
                      key={`${model.id}-${mi}`}
                      onSelect={() => onChange(model.id)}
                    >
                      {model.id}
                    </DropdownMenuItem>
                  ))}
                </div>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  // 态 2: 拉取中 → Input + spinner
  if (isLoading) {
    return (
      <div className="flex gap-1">
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          placeholder={placeholder}
          className="flex-1"
        />
        <Button
          variant="outline"
          className="h-9 w-9 shrink-0 p-0"
          disabled
          title="正在获取模型列表"
          aria-label="正在获取模型列表"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
        </Button>
      </div>
    );
  }

  // 态 3: 有 onFetch → Input + 「获取」按钮
  if (onFetch) {
    return (
      <div className="flex gap-1">
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          placeholder={placeholder}
          className="flex-1"
        />
        <Button
          variant="outline"
          className="h-9 w-9 shrink-0 p-0"
          onClick={onFetch}
          title="获取模型列表"
          aria-label="获取模型列表"
        >
          <Download className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  // 态 4: 无 onFetch 且无数据 → 纯 Input
  return (
    <Input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete="off"
      placeholder={placeholder}
    />
  );
}

/**
 * 按 owned_by 分组；null / 空白字符串归「其他」。
 * 返回的 Record 键即下拉分组标题，值的顺序保留上游返回顺序。
 */
function groupByOwnedBy(models: FetchedModel[]): Record<string, FetchedModel[]> {
  const grouped: Record<string, FetchedModel[]> = {};
  for (const model of models) {
    const raw = model.owned_by;
    const vendor =
      raw !== null && raw.trim().length > 0 ? raw : OTHER_GROUP_LABEL;
    const arr = grouped[vendor];
    if (arr) {
      arr.push(model);
    } else {
      grouped[vendor] = [model];
    }
  }
  return grouped;
}
