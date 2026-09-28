# sologsb-1127 城市无障碍设施核验地图（gbaccessmap）

面向无障碍督导员与轮椅使用者代表，把坡道、盲道、无障碍电梯的点位、核验数据与通行路线集中到一张图上。

## 一键启动（Docker）

```bash
cp .env.example .env
docker compose up -d --build
```

访问地址：<http://localhost:21827>

停止服务（镜像保留）：

```bash
docker compose down
```

## 技术栈

| 分层 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript |
| UI | Ant Design 5 + @ant-design/icons |
| 构建 | Vite 6（`tsc -b && vite build`，构建含类型检查） |
| 状态管理 | Zustand 5（业务数据 store + UI 偏好 persist 到 localStorage） |
| 路由 | React Router 6（BrowserRouter，nginx `try_files` 兜底） |
| 地图 | 高德地图 JS API（key 走 `VITE_AMAP_KEY`，留空时自动降级为本地 SVG 网格视图） |
| 本地存储 | IndexedDB（Dexie 4，库名 `gbaccessmap-db`）+ localStorage（表单草稿、UI 偏好） |
| 托管 | nginx:alpine（多阶段构建） |

## 核心功能

| 路由 | 说明 | 消费模型 |
| --- | --- | --- |
| `/` | 核验总览：按行政区与设施类型汇总点位数、合格率、待整改数，点击统计块下钻清单 | AccessPoint / Inspection / RectifyPlan |
| `/points/new` | 点位登记：地图打点或手填经纬度，可同时录入首次核验实测值 | AccessPoint / Inspection |
| `/points/:id` | 点位详情：地图定位与属性、核验历史、就地新增核验、整改跟踪 | 四个模型 |
| `/routes` | 通行路线编制：选择出发时刻，选点自动串联路段，按里程估算各点位到达时刻，时段外点位不能编入路线；逐段填障碍数/台阶数/路缘高差，输出全线判定 | RouteSegment / AccessPoint |
| `/map` | 设施地图：按设施类型着色渲染点位，实时显示当前开放/即将关闭/已关闭，点选弹出核验摘要 | AccessPoint / Inspection |
| `/rectify` | 整改清单：按状态与期限分组、逾期置顶，登记复检结果 | RectifyPlan / AccessPoint |

## 数据模型（`src/types/` 独立文件）

| 模型 | 文件 | 关键字段 |
| --- | --- | --- |
| AccessPoint | `src/types/point.ts` | 点位编号、名称、设施类型、经纬度、行政区、所在道路或建筑、建成年代、养护单位、每周开放时段 `weeklyHours`、例外闭馆日 `closureDays` |
| Inspection | `src/types/inspection.ts` | 核验日期、核验人、坡度 %、净宽 cm、扶手、盲道连续性、占用情况、结论、问题描述 |
| RouteSegment | `src/types/route.ts` | 路线名称、起点/终点点位、长度、障碍数、台阶数、路缘高差、是否可轮椅通行 |
| RectifyPlan | `src/types/rectify.ts` | 点位 id、整改要求、责任单位、整改期限、复检日期、状态 |

## 数据存储

- **IndexedDB（Dexie，库名 `gbaccessmap-db`）**：业务数据。含版本号与升级迁移：
  - `v1` 建 `points` / `inspections` 表；
  - `v2` 增加 `routes` 表与 `pointId` 相关索引；
  - `v3` 增加 `rectifies` 表，并为历史「不合格」核验补建整改条目；
  - `v4` 点位增加 `weeklyHours`（每周固定开放时段）与 `closureDays`（例外闭馆日），老点位按设施类型补默认时段。
- **localStorage**：点位登记表单草稿（`gbaccessmap-draft:point-new`）与 UI 偏好（`gbaccessmap-ui`）。
- 首次打开时自动写入一批示例数据，便于直接体验。
- 容器无状态：不使用数据库服务、不挂载命名卷，清空浏览器存储即可重置数据。

## 高德地图 key

`VITE_AMAP_KEY` 留空（默认）时：`useAmapLoader()` 检测到 key 为空会**立即**返回降级标记，**不会**请求 `webapi.amap.com`；页面渲染可点选、可查看详情的本地 SVG 网格视图（`MapPanel`）。配置了 key 时脚本加载失败或超时同样自动降级，因此构建与运行都不依赖该 key。

## 目录结构

```
sologsb-1127/
├── docker-compose.yml          # 顶层 name: gbaccessmap，无 version: 字段
├── .env / .env.example         # COMPOSE_PROJECT_NAME / FRONTEND_PORT / VITE_AMAP_KEY
├── README.md
└── frontend/
    ├── Dockerfile              # node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf              # try_files + gzip
    ├── index.html
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig*.json
    ├── public/favicon.svg
    └── src/
        ├── types/{point,inspection,route,rectify}.ts
        ├── db/index.ts                     # Dexie 封装 + 版本迁移 + 示例数据
        ├── stores/{pointStore,routeStore,uiStore}.ts
        ├── components/common/{MapPanel,StatusBadge,OpenStatusTag,HoursEditor,FacilityIcon,MeasureInput,EmptyState}.tsx
        ├── hooks/{useAmapLoader,useInspectionFilter,useLocalDraft,useNow}.ts
        ├── pages/{Overview,PointNew,PointDetail,Routes,MapView,Rectify}.tsx
        ├── layouts/AppLayout.tsx
        ├── router/index.tsx
        └── utils/{routeCheck,hours,routeTime,geo,format}.ts
```

## 判定阈值（`src/utils/routeCheck.ts`）

- 坡度：≤ 5% 合格，> 5% 限期整改，> 8% 不合格；
- 净宽：≥ 120cm 合格，< 120cm 限期整改，< 90cm 不合格；
- 路缘高差：≤ 3cm 可轮椅通行，> 6cm 判定不可通行；存在台阶需绕行或增设坡道。

## 开放时段与闭馆规则（`src/utils/hours.ts`）

无障碍电梯、无障碍卫生间、低位服务台等室内设施按固定时段开放，坡道、盲道等室外设施默认全天开放。

- `weeklyHours`：每周时段，同一天可多条；`end <= start` 视为**跨夜**，按到达日次日判定（如每天 22:00–次日 01:00）。
- `closureDays`：例外闭馆日，命中当天**覆盖周计划**；从闭馆日开始的跨夜时段，其延续到次日凌晨的部分也一并作废。
- 点位状态三档：**当前开放 / 即将关闭（30 分钟内）/ 已关闭**；已关闭时给出最近可开放时间（31 天窗口）。
- 路线规划：选择出发时刻后，按轮椅平均速度 1 m/s（3.6 km/h）与路线里程逐段估算到达时刻；到达时不开放的点位不能编入路线，保存时二次校验。
- 已保存路线：按当前选定的出发时刻重算，受影响段整行标黄并列出「到达时刻 + 最近可开放时间」。
- 地图与总览通过 `useNow()`（30 秒心跳、页面隐藏暂停）实时重算；点位时段在点位登记页配置、在详情页随时编辑，保存后立即全量重算。核验历史与整改记录逻辑不变。
