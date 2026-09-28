import { useMemo, useState } from 'react';
import {
  App,
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  TimePicker,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  NodeIndexOutlined,
  SaveOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import StatusBadge from '../components/common/StatusBadge';
import OpenStatusTag from '../components/common/OpenStatusTag';
import EmptyState from '../components/common/EmptyState';
import { usePointStore } from '../stores/pointStore';
import { useRouteStore, type DraftSegment } from '../stores/routeStore';
import type { RouteSegment } from '../types/route';
import { judgeSegment, CURB_FAIL, CURB_PASS } from '../utils/routeCheck';
import { geoLegs, chainTimings, analyzeRoute, type ChainPointTiming, type RouteImpact } from '../utils/routeTime';
import { formatArrival, formatNextOpen, isOpenAt, nextOpening, WHEELCHAIR_SPEED_MPS } from '../utils/hours';

/** 出发时刻默认取当天整点（向上取整到下一个整点） */
function defaultDeparture(): dayjs.Dayjs {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return dayjs(d);
}

export default function Routes() {
  const { message } = App.useApp();
  const points = usePointStore((s) => s.points);
  const {
    segments,
    draftName,
    chain,
    departureISO,
    draftSegments,
    verdict,
    setDraftName,
    setDepartureISO,
    setChain,
    buildChainSegments,
    updateDraftSegment,
    removeDraftSegment,
    computeVerdict,
    saveRoute,
    resetDraft,
  } = useRouteStore();
  const [saving, setSaving] = useState(false);

  const pointOptions = useMemo(
    () => points.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` })),
    [points],
  );
  const byId = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);
  const nameOf = (id: string) => byId.get(id)?.name ?? id;

  const departure = useMemo(() => (departureISO ? dayjs(departureISO) : defaultDeparture()), [departureISO]);

  const setDeparture = (d: dayjs.Dayjs | null) => setDepartureISO(d ? d.second(0).millisecond(0).toISOString() : '');

  /** 链上点位的到达时序（已串联用实测长度，未串联用大圆距离） */
  const timings: ChainPointTiming[] = useMemo(() => {
    // 串联后以路段为准（用户可能删除了个别段），串联前直接用选择链
    const effectiveChain = draftSegments.length
      ? (() => {
          const ordered = [...draftSegments].sort((a, b) => a.order - b.order);
          return ordered.length ? [ordered[0].fromPointId, ...ordered.map((s) => s.toPointId)] : [];
        })()
      : chain;
    if (effectiveChain.length < 1) return [];
    const legs = draftSegments.length
      ? [...draftSegments]
          .sort((a, b) => a.order - b.order)
          .map((s) => ({ fromPointId: s.fromPointId, toPointId: s.toPointId, length: s.length }))
      : geoLegs(points, effectiveChain);
    return chainTimings(points, effectiveChain, legs, departure.toDate());
  }, [chain, draftSegments, points, departure]);

  const blocked = timings.filter((t) => t.point && !t.open);
  const soonClosed = timings.filter((t) => t.open && t.status?.kind === 'closing');

  const draftVerdict = verdict ?? null;

  const handleChainChange = (ids: string[]) => {
    // 新增点位时按预计到达时刻预判，时段外的点位不能进链
    if (ids.length > chain.length) {
      const addedId = ids.find((id) => !chain.includes(id));
      if (addedId) {
        const point = byId.get(addedId);
        if (point) {
          const prevChain = [...chain, addedId];
          const legs = draftSegments.length
            ? draftSegments.map((s) => ({ fromPointId: s.fromPointId, toPointId: s.toPointId, length: s.length }))
            : geoLegs(points, prevChain);
          const timing = chainTimings(points, prevChain, legs, departure.toDate()).find(
            (t) => t.pointId === addedId,
          );
          if (timing && !isOpenAt(point, timing.arriveAt)) {
            message.warning(
              `${point.name} 预计 ${formatArrival(timing.arriveAt)} 到达时${
                timing.status?.closureReason ? `闭馆（${timing.status.closureReason}）` : '不在开放时段'
              }，最近可开放 ${formatNextOpen(nextOpening(point, timing.arriveAt))}，不能编入路线`,
            );
            return;
          }
        }
      }
    }
    setChain(ids);
  };

  const handleBuild = () => {
    if (chain.length < 2) {
      message.warning('请至少选择起点与终点两个点位');
      return;
    }
    if (blocked.length) {
      message.warning('链中存在到达时不开放的点位，请调整点位或出发时刻');
      return;
    }
    buildChainSegments(points);
    message.success(`已自动串联 ${chain.length - 1} 段路段`);
  };

  const handleSave = async () => {
    if (!draftSegments.length) {
      message.warning('请先串联路段');
      return;
    }
    if (blocked.length) {
      message.warning('存在到达时不开放的点位，无法保存');
      return;
    }
    setSaving(true);
    try {
      const n = await saveRoute();
      message.success(`已保存 ${n} 段路线`);
      resetDraft();
    } catch (e) {
      message.error(`路线保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const draftColumns: ColumnsType<DraftSegment> = [
    { title: '段序', dataIndex: 'order', width: 56 },
    { title: '起点', dataIndex: 'fromPointId', render: (v: string) => nameOf(v) },
    {
      title: '终点',
      dataIndex: 'toPointId',
      render: (v: string) => (
        <Space size={4}>
          {nameOf(v)}
          {timings.find((t) => t.pointId === v && !t.open) ? <Tag color="error">时段外</Tag> : null}
        </Space>
      ),
    },
    {
      title: '预计到达',
      width: 150,
      render: (_, row) => {
        const t = timings.find((x) => x.pointId === row.toPointId);
        if (!t) return '—';
        return (
          <Tooltip title={t.point && !t.open ? `最近可开放 ${formatNextOpen(nextOpening(t.point, t.arriveAt))}` : ''}>
            <Typography.Text type={t.open ? undefined : 'danger'} style={{ fontSize: 12 }}>
              <ClockCircleOutlined /> {formatArrival(t.arriveAt)}
            </Typography.Text>
          </Tooltip>
        );
      },
    },
    {
      title: '长度(m)',
      dataIndex: 'length',
      width: 100,
      render: (v: number, row) => (
        <InputNumber
          aria-label={`长度-${row.order}`}
          min={1}
          max={100000}
          value={v}
          onChange={(nv) => updateDraftSegment(row.key, { length: Number(nv ?? 0) })}
          style={{ width: 90 }}
        />
      ),
    },
    {
      title: '沿途障碍数',
      dataIndex: 'obstacleCount',
      width: 100,
      render: (v: number, row) => (
        <InputNumber
          aria-label={`障碍数-${row.order}`}
          min={0}
          max={50}
          value={v}
          onChange={(nv) => updateDraftSegment(row.key, { obstacleCount: Number(nv ?? 0) })}
          style={{ width: 80 }}
        />
      ),
    },
    {
      title: '台阶数',
      dataIndex: 'stepCount',
      width: 90,
      render: (v: number, row) => (
        <InputNumber
          aria-label={`台阶数-${row.order}`}
          min={0}
          max={50}
          value={v}
          onChange={(nv) => updateDraftSegment(row.key, { stepCount: Number(nv ?? 0) })}
          style={{ width: 70 }}
        />
      ),
    },
    {
      title: '路缘高差(cm)',
      dataIndex: 'curbHeight',
      width: 120,
      render: (v: number, row) => (
        <InputNumber
          aria-label={`路缘高差-${row.order}`}
          min={0}
          max={60}
          step={0.5}
          value={v}
          onChange={(nv) => updateDraftSegment(row.key, { curbHeight: Number(nv ?? 0) })}
          style={{ width: 90 }}
        />
      ),
    },
    {
      title: '段判定',
      width: 100,
      render: (_, row) => (
        <StatusBadge value={judgeSegment(row).passable ? '可通行' : '不可通行'} kind="route" />
      ),
    },
    {
      title: '操作',
      width: 64,
      render: (_, row) => (
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => removeDraftSegment(row.key)}
          data-testid={`remove-segment-${row.order}`}
        />
      ),
    },
  ];

  /** 已保存路线按出发时刻重算的影响分析 */
  const impacts: RouteImpact[] = useMemo(() => {
    const byName = new Map<string, RouteSegment[]>();
    for (const s of segments) {
      const list = byName.get(s.routeName) ?? [];
      list.push(s);
      byName.set(s.routeName, list);
    }
    return [...byName.entries()].map(([name, list]) => analyzeRoute(name, list, byId, departure.toDate()));
  }, [segments, byId, departure]);

  const impactBySegment = useMemo(() => {
    const map = new Map<string, (typeof impacts)[number]['segmentImpacts'][number]>();
    for (const imp of impacts) for (const si of imp.segmentImpacts) map.set(si.segment.id, si);
    return map;
  }, [impacts]);

  const savedColumns: ColumnsType<RouteSegment> = [
    { title: '路线名称', dataIndex: 'routeName', width: 180 },
    { title: '段序', dataIndex: 'order', width: 60 },
    { title: '起点', dataIndex: 'fromPointId', render: (v: string) => nameOf(v) },
    { title: '终点', dataIndex: 'toPointId', render: (v: string) => nameOf(v) },
    {
      title: '到达时刻',
      width: 160,
      render: (_, row) => {
        const si = impactBySegment.get(row.id);
        if (!si) return '—';
        return (
          <Tooltip
            title={
              si.toPoint && !si.toOpen
                ? `${si.toStatus?.closureReason ? `闭馆（${si.toStatus.closureReason}）；` : ''}最近可开放 ${formatNextOpen(
                    si.toStatus?.nextOpen ?? null,
                  )}`
                : ''
            }
          >
            <Typography.Text
              type={si.affected ? 'danger' : undefined}
              style={{ fontSize: 12 }}
              data-testid={`saved-arrival-${row.id}`}
            >
              <ClockCircleOutlined /> {formatArrival(si.arriveAt)}
            </Typography.Text>
          </Tooltip>
        );
      },
    },
    { title: '长度(m)', dataIndex: 'length', width: 90 },
    { title: '障碍数', dataIndex: 'obstacleCount', width: 80 },
    { title: '台阶数', dataIndex: 'stepCount', width: 80 },
    { title: '路缘高差(cm)', dataIndex: 'curbHeight', width: 110 },
    {
      title: '可轮椅通行',
      dataIndex: 'wheelchairPassable',
      width: 110,
      render: (v: boolean) => <StatusBadge value={v ? '可通行' : '不可通行'} kind="route" />,
    },
    {
      title: '开放情况',
      width: 110,
      render: (_, row) => {
        const si = impactBySegment.get(row.id);
        if (!si || !si.toPoint) return <Tag>点位缺失</Tag>;
        return (
          <span data-testid={`saved-open-${row.id}`}>
            {si.affected ? <Tag color="error">受影响</Tag> : <Tag color="success">可进入</Tag>}
          </span>
        );
      },
    },
  ];

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h1 className="gb-page-title">通行路线编制</h1>
          <Typography.Text type="secondary">
            选择出发时刻后按里程估算各点位到达时刻；时段外点位不能编入路线。跨夜时段按次日计算，闭馆日覆盖周计划。
          </Typography.Text>
        </div>
      </div>

      <Card size="small" style={{ marginBottom: 16 }} data-testid="departure-card">
        <Row gutter={12} align="middle">
          <Col xs={24} md={5}>
            <Typography.Text strong>规划出发时刻</Typography.Text>
          </Col>
          <Col xs={12} md={5}>
            <DatePicker
              value={departure}
              onChange={(d) =>
                setDeparture(
                  d ? d.hour(departure.hour()).minute(departure.minute()).second(0).millisecond(0) : null,
                )
              }
              allowClear={false}
              style={{ width: '100%' }}
              data-testid="departure-date"
            />
          </Col>
          <Col xs={12} md={5}>
            <TimePicker
              value={departure}
              minuteStep={10}
              format="HH:mm"
              allowClear={false}
              onChange={(d) =>
                setDeparture(
                  d
                    ? departure
                        .hour(d.hour())
                        .minute(d.minute())
                        .second(0)
                        .millisecond(0)
                    : null,
                )
              }
              style={{ width: '100%' }}
              data-testid="departure-time"
            />
          </Col>
          <Col xs={24} md={9}>
            <Space wrap>
              <Button size="small" onClick={() => setDeparture(dayjs())} data-testid="departure-now">
                现在出发
              </Button>
              <Typography.Text type="secondary" className="gb-muted">
                轮椅按 {WHEELCHAIR_SPEED_MPS} m/s（3.6 km/h）估算到达时刻
              </Typography.Text>
            </Space>
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="路线编制" size="small">
            <Form layout="vertical">
              <Row gutter={12}>
                <Col xs={24} md={10}>
                  <Form.Item label="路线名称">
                    <Input
                      id="routeName"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      placeholder="如 东单—王府井轮椅通道"
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={14}>
                  <Form.Item label="按顺序选择点位（起点 → 途经 → 终点）">
                    <Select
                      id="chain"
                      mode="multiple"
                      value={chain}
                      onChange={handleChainChange}
                      options={pointOptions}
                      placeholder="先选起点，再依次选择终点"
                      style={{ width: '100%' }}
                      maxTagCount={3}
                    />
                  </Form.Item>
                </Col>
              </Row>

              {timings.length > 0 ? (
                <div style={{ marginBottom: 12 }} data-testid="chain-timings">
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    {timings.map((t) => (
                      <Space key={t.pointId} size={8} wrap>
                        <Typography.Text type="secondary" style={{ fontSize: 12, minWidth: 44 }}>
                          第{t.order}点
                        </Typography.Text>
                        <Typography.Text style={{ fontSize: 13 }}>{t.point?.name ?? t.pointId}</Typography.Text>
                        <Tag style={{ fontSize: 12 }}>
                          {t.order === 1 ? '出发' : `累计 ${Math.round(t.travelM)}m`}
                        </Tag>
                        <Typography.Text style={{ fontSize: 12 }} type="secondary">
                          {formatArrival(t.arriveAt)} 到达
                        </Typography.Text>
                        {t.point ? <OpenStatusTag point={t.point} status={t.status ?? undefined} size="small" /> : null}
                      </Space>
                    ))}
                  </Space>
                  {blocked.length ? (
                    <Alert
                      style={{ marginTop: 8 }}
                      type="error"
                      showIcon
                      data-testid="chain-blocked"
                      message={`${blocked.length} 个点位到达时不开放，不能编入路线`}
                      description={
                        <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                          {blocked.map((t) => (
                            <li key={t.pointId}>
                              {t.point?.name}：{formatArrival(t.arriveAt)} 到达，
                              {t.status?.closureReason ? `闭馆（${t.status.closureReason}），` : ''}
                              最近可开放 {formatNextOpen(t.status?.nextOpen ?? null)}
                            </li>
                          ))}
                        </ul>
                      }
                    />
                  ) : soonClosed.length ? (
                    <Alert
                      style={{ marginTop: 8 }}
                      type="warning"
                      showIcon
                      message={`${soonClosed.length} 个点位到达时临近关闭，请留意时间`}
                    />
                  ) : null}
                </div>
              ) : null}

              <Space wrap>
                <Button
                  type="primary"
                  icon={<NodeIndexOutlined />}
                  onClick={handleBuild}
                  data-testid="build-route"
                >
                  自动串联路段
                </Button>
                <Button
                  icon={<ThunderboltOutlined />}
                  onClick={() => {
                    if (!draftSegments.length) {
                      message.warning('请先串联路段');
                      return;
                    }
                    computeVerdict();
                  }}
                  data-testid="compute-verdict"
                >
                  输出全线判定
                </Button>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={saving}
                  onClick={handleSave}
                  data-testid="save-route"
                >
                  保存路线
                </Button>
                <Button onClick={resetDraft} data-testid="reset-route">
                  清空编制
                </Button>
              </Space>
            </Form>

            <div style={{ marginTop: 16 }} data-testid="draft-segments">
              {draftSegments.length ? (
                <Table<DraftSegment>
                  rowKey="key"
                  size="small"
                  pagination={false}
                  dataSource={draftSegments}
                  columns={draftColumns}
                  rowClassName={(row) => {
                    const t = timings.find((x) => x.pointId === row.toPointId);
                    return t && !t.open ? 'gb-affected-row' : '';
                  }}
                  scroll={{ x: 980 }}
                />
              ) : (
                <EmptyState
                  title="尚未串联路段"
                  description="选择出发时刻与至少两个点位后点击「自动串联路段」"
                  compact
                />
              )}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title="全线判定" size="small" data-testid="verdict-card">
            {draftVerdict ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Space size={8} wrap>
                  <StatusBadge
                    value={draftVerdict.passable ? '可通行' : '不可通行'}
                    kind="route"
                    bordered
                  />
                  <Typography.Text strong data-testid="verdict-name">
                    {draftVerdict.routeName}
                  </Typography.Text>
                </Space>
                <Row gutter={12}>
                  <Col span={12}>
                    <Statistic title="全线长度" value={draftVerdict.totalLength} suffix="m" />
                  </Col>
                  <Col span={12}>
                    <Statistic title="沿途障碍" value={draftVerdict.totalObstacles} suffix="处" />
                  </Col>
                  <Col span={12}>
                    <Statistic title="台阶总数" value={draftVerdict.totalSteps} suffix="级" />
                  </Col>
                  <Col span={12}>
                    <Statistic title="最大路缘高差" value={draftVerdict.maxCurbHeight} suffix="cm" />
                  </Col>
                </Row>
                {draftVerdict.passable ? (
                  <Alert type="success" showIcon message="全线满足轮椅通行条件" />
                ) : (
                  <Alert
                    type="warning"
                    showIcon
                    message="存在不可通行路段"
                    description={
                      <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                        {draftVerdict.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    }
                  />
                )}
                <Typography.Text type="secondary" className="gb-muted">
                  判定阈值：路缘高差 ≤ {CURB_PASS}cm 可通行，&gt; {CURB_FAIL}cm 判定不可通行；存在台阶即需绕行。
                </Typography.Text>
              </Space>
            ) : (
              <EmptyState
                title="尚未输出判定"
                description="串联路段并填写实测值后点击「输出全线判定」"
                compact
              />
            )}
          </Card>

          <Card title="已编制路线 · 时段核验" size="small" style={{ marginTop: 16 }} data-testid="saved-route-check">
            <Typography.Text type="secondary" className="gb-muted" style={{ display: 'block', marginBottom: 8 }}>
              按上方出发时刻重算，调整出发时刻或点位时段后立即刷新。
            </Typography.Text>
            {impacts.length ? (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                {impacts.map((imp) => (
                  <div key={imp.routeName} data-testid={`impact-${imp.routeName}`}>
                    <Space size={8} wrap>
                      <Typography.Text strong>{imp.routeName}</Typography.Text>
                      <Tag>{imp.totalLength} m</Tag>
                      {imp.affected ? (
                        <Tag color="error">{imp.affectedCount} 段受影响</Tag>
                      ) : (
                        <Tag color="success">时段内可通行</Tag>
                      )}
                    </Space>
                    {imp.affected ? (
                      <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
                        {imp.segmentImpacts
                          .filter((si) => si.affected)
                          .map((si) => (
                            <li key={si.segment.id} style={{ fontSize: 12 }}>
                              第 {si.order} 段终点「{si.toPoint?.name}」：
                              {formatArrival(si.arriveAt)} 到达时
                              {si.toStatus?.closureReason
                                ? `闭馆（${si.toStatus.closureReason}）`
                                : '不在开放时段'}
                              ，最近可开放 {formatNextOpen(si.toStatus?.nextOpen ?? null)}
                            </li>
                          ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </Space>
            ) : (
              <EmptyState title="暂无已保存路线" compact />
            )}
          </Card>
        </Col>
      </Row>

      <Card title="已保存路段明细" size="small" style={{ marginTop: 16 }}>
        {segments.length ? (
          <Table<RouteSegment>
            rowKey="id"
            size="small"
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            dataSource={segments}
            columns={savedColumns}
            scroll={{ x: 1100 }}
            rowClassName={(row) => (impactBySegment.get(row.id)?.affected ? 'gb-affected-row' : '')}
          />
        ) : (
          <EmptyState title="暂无路段记录" description="编制并保存后在此查看" compact />
        )}
      </Card>
    </div>
  );
}
