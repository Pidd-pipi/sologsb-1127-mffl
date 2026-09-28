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
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, NodeIndexOutlined, SaveOutlined, ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import StatusBadge from '../components/common/StatusBadge';
import OpenStatusTag from '../components/common/OpenStatusTag';
import EmptyState from '../components/common/EmptyState';
import { usePointStore } from '../stores/pointStore';
import { useRouteStore, type DraftSegment } from '../stores/routeStore';
import type { AccessPoint } from '../types/point';
import type { RouteSegment } from '../types/route';
import { buildVerdict, judgeSegment, CURB_FAIL, CURB_PASS } from '../utils/routeCheck';
import { segmentLength } from '../utils/geo';
import { getOpenInfo, formatNextOpen } from '../utils/schedule';
import {
  analyzeSavedRoute,
  formatClock,
  planChainArrivals,
  travelMinutes,
} from '../utils/routeTiming';

export default function Routes() {
  const { message } = App.useApp();
  const points = usePointStore((s) => s.points);
  const {
    segments,
    draftName,
    chain,
    departAt,
    draftSegments,
    verdict,
    setDraftName,
    setDepartAt,
    setChain,
    buildChainSegments,
    updateDraftSegment,
    removeDraftSegment,
    computeVerdict,
    saveRoute,
    resetDraft,
  } = useRouteStore();
  const [saving, setSaving] = useState(false);

  const pointMap = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);
  const nameOf = (id: string) => points.find((p) => p.id === id)?.name ?? id;
  const pointOf = (id: string): AccessPoint | undefined => pointMap.get(id);

  const departDate = useMemo(() => (departAt ? new Date(departAt) : new Date()), [departAt]);

  /** 链上相邻两点的里程：优先用已串联路段里的实测值，否则用经纬度估算 */
  const chainLengths = useMemo(() => {
    const out: number[] = [];
    for (let i = 1; i < chain.length; i += 1) {
      const seg = draftSegments.find(
        (s) => s.order === i && s.fromPointId === chain[i - 1] && s.toPointId === chain[i],
      );
      if (seg) {
        out.push(seg.length);
      } else {
        const a = pointMap.get(chain[i - 1]);
        const b = pointMap.get(chain[i]);
        out.push(a && b ? segmentLength({ lng: a.lng, lat: a.lat }, { lng: b.lng, lat: b.lat }) : 0);
      }
    }
    return out;
  }, [chain, draftSegments, pointMap]);

  /** 出发时刻 + 里程 → 各点位到达时刻与开放状态，调整后立即重算 */
  const arrivals = useMemo(
    () => planChainArrivals(chain, chainLengths, departDate, pointMap),
    [chain, chainLengths, departDate, pointMap],
  );
  const arrivalByPoint = useMemo(() => new Map(arrivals.map((a) => [a.pointId, a])), [arrivals]);
  const blocked = arrivals.filter((a) => !a.enterable);

  /** 链上最后一点的到达时刻，用于评估候选点追加后的到达状态 */
  const cursorAtEnd = arrivals.length ? arrivals[arrivals.length - 1].arriveAt : departDate;

  const selectOptions = useMemo(
    () =>
      points.map((p) => {
        const picked = chain.includes(p.id);
        let suffix = '';
        if (!picked) {
          const from = pointMap.get(chain[chain.length - 1] ?? '');
          const len = from
            ? segmentLength({ lng: from.lng, lat: from.lat }, { lng: p.lng, lat: p.lat })
            : 0;
          const arrive = new Date(cursorAtEnd.getTime() + travelMinutes(len) * 60000);
          const info = getOpenInfo(p, arrive);
          if (info.state === 'closed') {
            suffix = `（到达时已闭馆，${formatNextOpen(info.nextOpen, arrive)} 开放，不可入链）`;
          }
        }
        return {
          value: p.id,
          label: `${p.code} ${p.name}${suffix}`,
          disabled: suffix !== '',
        };
      }),
    [points, chain, pointMap, cursorAtEnd],
  );

  const draftVerdict = verdict ?? null;

  const handleBuild = () => {
    if (chain.length < 2) {
      message.warning('请至少选择起点与终点两个点位');
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
      message.warning(`存在到达时已闭馆的点位（${blocked.map((b) => nameOf(b.pointId)).join('、')}），请调整出发时间或点位`);
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
    { title: '段序', dataIndex: 'order', width: 60 },
    { title: '起点', dataIndex: 'fromPointId', render: (v: string) => nameOf(v) },
    { title: '终点', dataIndex: 'toPointId', render: (v: string) => nameOf(v) },
    {
      title: '到达终点时刻',
      width: 150,
      render: (_, row) => {
        const a = arrivalByPoint.get(row.toPointId);
        if (!a) return '—';
        return (
          <Space size={4} direction="vertical" style={{ gap: 2 }}>
            <Typography.Text>{formatClock(departDate, a.arriveAt)}</Typography.Text>
            <OpenStatusTag point={pointOf(row.toPointId) as AccessPoint} at={a.arriveAt} />
          </Space>
        );
      },
    },
    {
      title: '长度(m)',
      dataIndex: 'length',
      width: 110,
      render: (v: number, row) => (
        <InputNumber
          aria-label={`长度-${row.order}`}
          min={1}
          max={100000}
          value={v}
          onChange={(nv) => updateDraftSegment(row.key, { length: Number(nv ?? 0) })}
          style={{ width: 100 }}
        />
      ),
    },
    {
      title: '沿途障碍数',
      dataIndex: 'obstacleCount',
      width: 120,
      render: (v: number, row) => (
        <InputNumber
          aria-label={`障碍数-${row.order}`}
          min={0}
          max={50}
          value={v}
          onChange={(nv) => updateDraftSegment(row.key, { obstacleCount: Number(nv ?? 0) })}
          style={{ width: 100 }}
        />
      ),
    },
    {
      title: '台阶数',
      dataIndex: 'stepCount',
      width: 110,
      render: (v: number, row) => (
        <InputNumber
          aria-label={`台阶数-${row.order}`}
          min={0}
          max={50}
          value={v}
          onChange={(nv) => updateDraftSegment(row.key, { stepCount: Number(nv ?? 0) })}
          style={{ width: 100 }}
        />
      ),
    },
    {
      title: '路缘高差(cm)',
      dataIndex: 'curbHeight',
      width: 130,
      render: (v: number, row) => (
        <InputNumber
          aria-label={`路缘高差-${row.order}`}
          min={0}
          max={60}
          step={0.5}
          value={v}
          onChange={(nv) => updateDraftSegment(row.key, { curbHeight: Number(nv ?? 0) })}
          style={{ width: 110 }}
        />
      ),
    },
    {
      title: '段判定',
      width: 110,
      render: (_, row) => (
        <StatusBadge value={judgeSegment(row).passable ? '可通行' : '不可通行'} kind="route" />
      ),
    },
    {
      title: '操作',
      width: 80,
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

  const savedRoutes = useMemo(() => {
    const byName = new Map<string, RouteSegment[]>();
    for (const s of segments) {
      const list = byName.get(s.routeName) ?? [];
      list.push(s);
      byName.set(s.routeName, list);
    }
    return Array.from(byName.entries()).map(([routeName, list]) => {
      const ordered = [...list].sort((a, b) => a.order - b.order);
      return {
        routeName,
        segments: ordered,
        verdict: buildVerdict(routeName, ordered),
        timing: analyzeSavedRoute(routeName, ordered, pointMap),
      };
    });
  }, [segments, pointMap]);

  const affectedPointIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of savedRoutes) for (const a of r.timing.affected) set.add(`${r.routeName}::${a.pointId}`);
    return set;
  }, [savedRoutes]);

  const savedColumns: ColumnsType<RouteSegment> = [
    { title: '路线名称', dataIndex: 'routeName', width: 200 },
    { title: '段序', dataIndex: 'order', width: 70 },
    { title: '起点', dataIndex: 'fromPointId', render: (v: string) => nameOf(v) },
    { title: '终点', dataIndex: 'toPointId', render: (v: string) => nameOf(v) },
    { title: '长度(m)', dataIndex: 'length', width: 100 },
    { title: '障碍数', dataIndex: 'obstacleCount', width: 90 },
    { title: '台阶数', dataIndex: 'stepCount', width: 90 },
    { title: '路缘高差(cm)', dataIndex: 'curbHeight', width: 120 },
    {
      title: '可轮椅通行',
      dataIndex: 'wheelchairPassable',
      width: 120,
      render: (v: boolean) => <StatusBadge value={v ? '可通行' : '不可通行'} kind="route" />,
    },
  ];

  const affectedCount = savedRoutes.reduce((n, r) => n + r.timing.affected.length, 0);

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h1 className="gb-page-title">通行路线编制</h1>
          <Typography.Text type="secondary">
            选择出发时间与点位后自动串联路段；按路线里程（轮椅约 1.4 m/s）推算到达时刻，到达时已闭馆的点位不可入链。
          </Typography.Text>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={15}>
          <Card title="路线编制" size="small">
            <Form layout="vertical">
              <Row gutter={12}>
                <Col xs={24} md={8}>
                  <Form.Item label="路线名称">
                    <Input
                      id="routeName"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      placeholder="如 东单—王府井轮椅通道"
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={7}>
                  <Form.Item label="出发时间">
                    <DatePicker
                      id="departAt"
                      showTime={{ format: 'HH:mm', minuteStep: 15 }}
                      format="YYYY-MM-DD HH:mm"
                      value={dayjs(departDate)}
                      onChange={(d) => setDepartAt(d ? d.toDate().toISOString() : '')}
                      style={{ width: '100%' }}
                      data-testid="depart-at"
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={9}>
                  <Form.Item label="按顺序选择点位（起点 → 途经 → 终点）">
                    <Select
                      id="chain"
                      mode="multiple"
                      value={chain}
                      onChange={(v) => setChain(v)}
                      options={selectOptions}
                      placeholder="先选起点，再依次选择终点"
                      style={{ width: '100%' }}
                      maxTagCount={3}
                    />
                  </Form.Item>
                </Col>
              </Row>
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

            {chain.length ? (
              <Alert
                style={{ marginTop: 12 }}
                type={blocked.length ? 'error' : 'success'}
                showIcon
                data-testid="chain-open-alert"
                message={
                  blocked.length
                    ? `${blocked.length} 个点位到达时不在开放时段，不能入链保存`
                    : '链上点位到达时均可进入'
                }
                description={
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    {arrivals.map((a) => {
                      const p = pointOf(a.pointId);
                      return (
                        <Space key={a.pointId} size={8} wrap>
                          <Tag>{a.order}</Tag>
                          <Typography.Text>{p?.name ?? a.pointId}</Typography.Text>
                          <Typography.Text type="secondary" className="gb-muted">
                            {a.order === 1 ? '出发' : '到达'} {formatClock(departDate, a.arriveAt)}
                          </Typography.Text>
                          {p ? <OpenStatusTag point={p} at={a.arriveAt} /> : null}
                          {!a.enterable ? (
                            <Typography.Text type="danger" className="gb-muted">
                              最近开放：{formatNextOpen(a.info.nextOpen, a.arriveAt)}
                            </Typography.Text>
                          ) : null}
                        </Space>
                      );
                    })}
                  </Space>
                }
              />
            ) : null}

            <div style={{ marginTop: 16 }} data-testid="draft-segments">
              {draftSegments.length ? (
                <Table<DraftSegment>
                  rowKey="key"
                  size="small"
                  pagination={false}
                  dataSource={draftSegments}
                  columns={draftColumns}
                />
              ) : (
                <EmptyState
                  title="尚未串联路段"
                  description="选择至少两个点位后点击「自动串联路段」"
                  compact
                />
              )}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={9}>
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

          <Card
            title={
              <Space size={8}>
                <span>已编制路线开放核验</span>
                {affectedCount ? <Tag color="error">{affectedCount} 处受影响</Tag> : null}
              </Space>
            }
            size="small"
            style={{ marginTop: 16 }}
            data-testid="saved-route-timing"
          >
            {savedRoutes.length ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {savedRoutes.map((r) => (
                  <div
                    key={r.routeName}
                    style={{
                      border: '1px solid #f0f0f0',
                      borderRadius: 8,
                      padding: 10,
                      background: r.timing.affected.length ? '#fff2f0' : '#f6ffed',
                    }}
                    data-testid={`saved-route-${r.routeName}`}
                  >
                    <Space size={8} wrap style={{ marginBottom: 6 }}>
                      <StatusBadge value={r.verdict.passable ? '可通行' : '不可通行'} kind="route" />
                      <Typography.Text strong>{r.routeName}</Typography.Text>
                      <Tag>{r.verdict.totalLength} m</Tag>
                      {r.timing.departAt ? (
                        <Tooltip title="规划出发时间">
                          <Tag color="blue">
                            {dayjs(r.timing.departAt).format('MM-DD HH:mm')} 出发
                          </Tag>
                        </Tooltip>
                      ) : (
                        <Tag>未记录出发时间</Tag>
                      )}
                    </Space>
                    {r.timing.departAt && r.timing.arrivals.length ? (
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        {r.timing.arrivals.map((a) => {
                          const p = pointOf(a.pointId);
                          return (
                            <Space key={a.pointId} size={8} wrap>
                              <Tag>{a.order}</Tag>
                              <Typography.Text
                                type={a.enterable ? undefined : 'danger'}
                                strong={!a.enterable}
                              >
                                {p?.name ?? a.pointId}
                              </Typography.Text>
                              <Typography.Text type="secondary" className="gb-muted">
                                {a.order === 1 ? '出发' : '到达'} {formatClock(r.timing.departAt!, a.arriveAt)}
                              </Typography.Text>
                              {p ? <OpenStatusTag point={p} at={a.arriveAt} /> : null}
                              {!a.enterable ? (
                                <Tag color="error">
                                  受影响 · 最近 {formatNextOpen(a.info.nextOpen, a.arriveAt)} 开放
                                </Tag>
                              ) : null}
                            </Space>
                          );
                        })}
                      </Space>
                    ) : (
                      <Typography.Text type="secondary" className="gb-muted">
                        该路线保存于开放时段功能上线前，重新编辑并保存后可核验到达开放状态。
                      </Typography.Text>
                    )}
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
            rowClassName={(row) =>
              affectedPointIds.has(`${row.routeName}::${row.toPointId}`)
                ? 'gb-row-affected'
                : ''
            }
          />
        ) : (
          <EmptyState title="暂无路段记录" description="编制并保存后在此查看" compact />
        )}
      </Card>
    </div>
  );
}
