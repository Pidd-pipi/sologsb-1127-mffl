import { useEffect, useState } from 'react';
import { Button, DatePicker, Empty, Form, Input, Popconfirm, Select, Space, Table, TimePicker, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import {
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  isOvernight,
  type ClosedDate,
  type WeeklyHour,
} from '../../types/schedule';

interface ScheduleEditorProps {
  weeklyHours: WeeklyHour[];
  closedDates: ClosedDate[];
  onChange: (next: { weeklyHours: WeeklyHour[]; closedDates: ClosedDate[] }) => void;
  /** 表格密度，点位详情页用默认尺寸 */
  size?: 'small' | 'middle';
}

interface HourRow extends WeeklyHour {
  key: string;
}

let hourSeq = 0;
function newKey(): string {
  hourSeq += 1;
  return `wh-${Date.now().toString(36)}-${hourSeq}`;
}

function hhmmOf(d: dayjs.Dayjs | null): string {
  return d ? d.format('HH:mm') : '00:00';
}

/** 每周开放时段 + 例外闭馆日编辑；保存由调用方统一落库 */
export default function ScheduleEditor({
  weeklyHours,
  closedDates,
  onChange,
  size = 'small',
}: ScheduleEditorProps) {
  // 行 key 仅用于表格渲染与定位，落库时剔除
  const [rows, setRows] = useState<HourRow[]>(() =>
    [...weeklyHours]
      .sort((a, b) => a.weekday - b.weekday)
      .map((h) => ({ ...h, key: newKey() })),
  );
  const [closureReason, setClosureReason] = useState('');
  const [closureDate, setClosureDate] = useState('');

  // 外部时段整体变化（如切换设施类型带入默认时段、进入编辑态重置）时同步内部行
  useEffect(() => {
    setRows(
      [...weeklyHours]
        .sort((a, b) => a.weekday - b.weekday)
        .map((h) => ({ ...h, key: newKey() })),
    );
    // 仅按外部值的内容同步，避免本地编辑引发回环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(weeklyHours.map((h) => `${h.weekday}-${h.open}-${h.close}`).join('|'))]);

  const emitHours = (next: HourRow[]) =>
    onChange({
      weeklyHours: next.map((r) => ({ weekday: r.weekday, open: r.open, close: r.close })),
      closedDates,
    });

  const updateRow = (key: string, patch: Partial<WeeklyHour>) => {
    const next = rows.map((r) => (r.key === key ? { ...r, ...patch } : r));
    setRows(next);
    emitHours(next);
  };

  const addRow = () => {
    const usedDays = new Set(rows.map((h) => h.weekday));
    const weekday = WEEKDAY_ORDER.find((d) => !usedDays.has(d)) ?? 1;
    const next = [...rows, { key: newKey(), weekday, open: '09:00', close: '17:00' }].sort(
      (a, b) => a.weekday - b.weekday,
    );
    setRows(next);
    emitHours(next);
  };

  const removeRow = (key: string) => {
    const next = rows.filter((r) => r.key !== key);
    setRows(next);
    emitHours(next);
  };

  const hourColumns: ColumnsType<HourRow> = [
    {
      title: '星期',
      width: 110,
      render: (_, row) => (
        <Select
          aria-label={`星期-${row.key}`}
          value={row.weekday}
          style={{ width: 90 }}
          options={WEEKDAY_ORDER.map((d) => ({ value: d, label: WEEKDAY_LABELS[d] }))}
          onChange={(v) => updateRow(row.key, { weekday: v })}
        />
      ),
    },
    {
      title: '开放',
      width: 120,
      render: (_, row) => (
        <TimePicker
          aria-label={`开放时刻-${row.key}`}
          minuteStep={15}
          format="HH:mm"
          allowClear={false}
          value={dayjs(row.open, 'HH:mm')}
          onChange={(d) => updateRow(row.key, { open: hhmmOf(d) })}
        />
      ),
    },
    {
      title: '关闭',
      width: 120,
      render: (_, row) => (
        <TimePicker
          aria-label={`关闭时刻-${row.key}`}
          minuteStep={15}
          format="HH:mm"
          allowClear={false}
          value={dayjs(row.close, 'HH:mm')}
          onChange={(d) => updateRow(row.key, { close: hhmmOf(d) })}
        />
      ),
    },
    {
      title: '说明',
      render: (_, row) =>
        isOvernight(row) ? (
          <Typography.Text type="warning">跨夜，关门按次日 {row.close} 计算</Typography.Text>
        ) : (
          <Typography.Text type="secondary">当日闭馆</Typography.Text>
        ),
    },
    {
      title: '',
      width: 48,
      render: (_, row) => (
        <Popconfirm title="删除该时段？" onConfirm={() => removeRow(row.key)}>
          <Button size="small" danger icon={<DeleteOutlined />} aria-label={`删除时段-${row.key}`} />
        </Popconfirm>
      ),
    },
  ];

  const addClosure = () => {
    if (!closureDate) return;
    if (closedDates.some((c) => c.date === closureDate)) return;
    onChange({
      weeklyHours: rows.map((r) => ({ weekday: r.weekday, open: r.open, close: r.close })),
      closedDates: [...closedDates, { date: closureDate, reason: closureReason.trim() }].sort((a, b) =>
        a.date < b.date ? -1 : 1,
      ),
    });
    setClosureReason('');
    setClosureDate('');
  };

  const removeClosure = (date: string) =>
    onChange({
      weeklyHours: rows.map((r) => ({ weekday: r.weekday, open: r.open, close: r.close })),
      closedDates: closedDates.filter((c) => c.date !== date),
    });

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div>
        <Space style={{ marginBottom: 8 }} wrap>
          <Typography.Text strong>每周开放时段</Typography.Text>
          <Typography.Text type="secondary" className="gb-muted">
            关闭时刻早于（或等于）开放时刻视为跨夜，按次日计算
          </Typography.Text>
          <Button size="small" icon={<PlusOutlined />} onClick={addRow} data-testid="add-weekly-hour">
            新增时段
          </Button>
        </Space>
        {rows.length ? (
          <Table<HourRow> rowKey="key" size={size} pagination={false} dataSource={rows} columns={hourColumns} />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="未登记时段，按全天开放处理（适用于坡道、盲道等道路设施）"
          />
        )}
      </div>

      <div>
        <Typography.Text strong>例外闭馆日</Typography.Text>
        <Typography.Text type="secondary" className="gb-muted" style={{ marginInlineStart: 8 }}>
          闭馆日覆盖当周开放计划
        </Typography.Text>
        <Form layout="inline" style={{ marginTop: 8, rowGap: 8 }}>
          <Form.Item label="日期">
            <DatePicker
              format="YYYY-MM-DD"
              value={closureDate ? dayjs(closureDate) : null}
              onChange={(d) => setClosureDate(d ? d.format('YYYY-MM-DD') : '')}
              data-testid="add-closure-date"
            />
          </Form.Item>
          <Form.Item label="原因">
            <Input
              placeholder="如 年度维保 / 节假日"
              value={closureReason}
              onChange={(e) => setClosureReason(e.target.value)}
              style={{ width: 200 }}
            />
          </Form.Item>
          <Form.Item>
            <Button icon={<PlusOutlined />} onClick={addClosure} data-testid="add-closure-btn">
              添加闭馆日
            </Button>
          </Form.Item>
        </Form>
        <Space size={[8, 8]} wrap style={{ marginTop: 8 }} data-testid="closure-list">
          {closedDates.length ? (
            closedDates.map((c) => (
              <span
                key={c.date}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: '#fff1f0',
                  border: '1px solid #ffa39e',
                }}
              >
                <Typography.Text style={{ color: '#cf1322' }}>{c.date}</Typography.Text>
                {c.reason ? <Typography.Text type="secondary">{c.reason}</Typography.Text> : null}
                <Popconfirm title="移除该闭馆日？" onConfirm={() => removeClosure(c.date)}>
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={`移除闭馆-${c.date}`} />
                </Popconfirm>
              </span>
            ))
          ) : (
            <Typography.Text type="secondary">暂无例外闭馆日</Typography.Text>
          )}
        </Space>
      </div>
    </Space>
  );
}
