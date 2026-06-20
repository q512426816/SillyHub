"use client";

/**
 * PpmFileUrls — 附件多 URL 管理组件 (D-010@v1)。
 *
 * 纯前端 URL 管理:不真上传、不依赖任何后端文件服务。组件仅维护
 * `string[]`,通过 `value`/`onChange` 受控交由父级表单统一提交。对照源
 * Vue 附件 URL 管理模式(明细附件列):一列已添加 URL + 输入框 + 「添加」 +
 * 每行「删除」。
 *
 * 设计依据:
 * - decisions.md D-010@v1(answer:纯前端 URL 管理,保持 D-007,不建文件服务)
 * - tasks/task-07.md(PpmFileUrls 组件 props `{ value: string[]; onChange }`)
 * - 源 dept_project_front 各附件 URL 管理字段模式
 *
 * 受控用法:
 * ```tsx
 * const [urls, setUrls] = useState<string[]>([]);
 * <PpmFileUrls value={urls} onChange={setUrls} />
 * ```
 */
import { useState } from "react";
import { Button, Input, Space, Typography } from "antd";

const { Text, Link } = Typography;

export interface PpmFileUrlsProps {
  /** 当前 URL 列表(受控)。 */
  value?: string[];
  /** URL 列表变更回调。 */
  onChange?: (next: string[]) => void;
  /** 禁用增删(查看态/字段 disabled)。默认 false。 */
  disabled?: boolean;
  /** 输入框 placeholder。 */
  placeholder?: string;
}

/**
 * 校验是否为合法 http(s) URL,避免把无意义字符串塞进列表。
 * 不强求完整协议(http://localhost 之类也允许),只要能被 URL 解析且 host 非空。
 */
function isValidUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function PpmFileUrls({
  value = [],
  onChange,
  disabled = false,
  placeholder = "粘贴附件链接(https://...)",
}: PpmFileUrlsProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const urls = Array.isArray(value) ? value : [];

  const emit = (next: string[]) => {
    onChange?.(next);
  };

  const addUrl = () => {
    const u = draft.trim();
    if (!u) {
      setError("请输入链接");
      return;
    }
    if (urls.includes(u)) {
      setError("该链接已添加");
      return;
    }
    if (!isValidUrl(u)) {
      setError("请输入合法的 http/https 链接");
      return;
    }
    setError(null);
    emit([...urls, u]);
    setDraft("");
  };

  const removeAt = (index: number) => {
    emit(urls.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {urls.length > 0 ? (
        <ul className="space-y-1">
          {urls.map((u, i) => (
            <li
              key={`${u}-${i}`}
              className="flex items-center gap-2 rounded border border-border bg-muted/20 px-2 py-1"
            >
              <Link
                href={u}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 truncate text-xs"
                title={u}
              >
                {u}
              </Link>
              {!disabled && (
                <Button
                  size="small"
                  type="link"
                  danger
                  onClick={() => removeAt(i)}
                >
                  删除
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Text type="secondary" className="text-xs">
          暂无附件
        </Text>
      )}

      {!disabled && (
        <Space.Compact style={{ width: "100%" }}>
          <Input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onPressEnter={addUrl}
            placeholder={placeholder}
            status={error ? "error" : undefined}
            size="small"
          />
          <Button size="small" type="primary" onClick={addUrl}>
            添加
          </Button>
        </Space.Compact>
      )}

      {error && (
        <Text type="danger" className="text-[11px]">
          {error}
        </Text>
      )}
    </div>
  );
}

export default PpmFileUrls;
