"use client";

/**
 * KanbanDateNav — 矩阵看板的日期范围导航。
 *
 * 提供:
 *  - 快速切换:上周 / 本周 / 下周(默认本周一~周日 7 天)
 *  - 自定义范围:DatePicker.RangePicker
 *  - 当前范围文字提示(06-16 ~ 06-22)
 *
 * 选中范围以 [start, end] 的 Dayjs 元组回传给父级,父级据此拉任务 + 渲染列。
 */
import { Button, DatePicker, Space } from "antd";
import {
  DoubleLeftOutlined,
  DoubleRightOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";

export interface KanbanDateNavProps {
  range: [Dayjs, Dayjs];
  onChange: (range: [Dayjs, Dayjs]) => void;
}

/** 以周一为起点的本周范围 [weekStart, weekEnd]。 */
function weekRangeOf(d: Dayjs): [Dayjs, Dayjs] {
  // dayjs().day(): 周日=0, 周一=1 ... 周六=6
  // 转换为"周一=0"偏移
  const dow = d.day();
  const offset = dow === 0 ? -6 : 1 - dow; // 周日回到上周一
  const monday = d.add(offset, "day").startOf("day");
  const sunday = monday.add(6, "day").endOf("day");
  return [monday, sunday];
}

export function KanbanDateNav({ range, onChange }: KanbanDateNavProps) {
  const [curStart, curEnd] = range;

  const goThisWeek = () => onChange(weekRangeOf(dayjs()));
  const goPrevWeek = () => {
    const [s, e] = weekRangeOf(curStart.subtract(7, "day"));
    onChange([s, e]);
  };
  const goNextWeek = () => {
    const [s, e] = weekRangeOf(curStart.add(7, "day"));
    onChange([s, e]);
  };

  const isThisWeek = (() => {
    const [ms, me] = weekRangeOf(dayjs());
    return ms.isSame(curStart, "day") && me.isSame(curEnd, "day");
  })();

  return (
    <Space size="small" wrap>
      <Button
        size="small"
        icon={<DoubleLeftOutlined />}
        onClick={goPrevWeek}
        title="上一周"
      />
      <Button
        size="small"
        type={isThisWeek ? "primary" : "default"}
        onClick={goThisWeek}
      >
        本周
      </Button>
      <Button
        size="small"
        icon={<DoubleRightOutlined />}
        onClick={goNextWeek}
        title="下一周"
      />
      <DatePicker.RangePicker
        size="small"
        allowClear={false}
        value={[curStart, curEnd]}
        onChange={(r) => {
          if (r && r[0] && r[1]) {
            onChange([r[0].startOf("day"), r[1].endOf("day")]);
          }
        }}
      />
      <span className="text-xs text-muted-foreground">
        {curStart.format("MM-DD")} ~ {curEnd.format("MM-DD")}
        <span className="ml-1">
          (共 {curEnd.diff(curStart, "day") + 1} 天)
        </span>
      </span>
    </Space>
  );
}

export default KanbanDateNav;
