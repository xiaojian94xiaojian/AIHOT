// 采集成本看板（后台）：每天一行 SocialData 的账，用来判断频率分档、热点提速这类改动有没有真省钱。
import { type MetaFunction } from "react-router";
import { SITE } from "@aihot/site";
import { adminGet } from "@aihot/web/lib/admin.server";
import { AdminPage, Card, DataTable, Stat } from "@aihot/web/features/admin/ui";
import type { XCollectStat } from "../types.ts";

type Data = { days: XCollectStat[] };

export async function loader({ request }: { request: Request }): Promise<Data> {
  return adminGet<Data>(request, "/api/admin/x-collect");
}

export const meta: MetaFunction = () => [{ title: `采集成本 · ${SITE.name} 后台` }];

const money = (usd: number) => `$${usd.toFixed(3)}`;
const rate = (stat: XCollectStat) => (stat.calls === 0 ? 0 : (stat.emptyCalls / stat.calls) * 100);

export default function AdminCollect({ loaderData }: { loaderData: Data }) {
  const days = loaderData.days;
  const week = days.slice(0, 7);
  const sum = (pick: (stat: XCollectStat) => number) => week.reduce((total, stat) => total + pick(stat), 0);
  const usd = sum((stat) => stat.usd);
  const calls = sum((stat) => stat.calls);
  const empty = sum((stat) => stat.emptyCalls);
  const objects = sum((stat) => stat.objects);

  return (
    <AdminPage
      title="采集成本"
      subtitle={
        <>
          SocialData 按返回的对象计费：空抓不花钱，但占并发和延迟。每天 05:10 记前一天的一行；
          今天那行是实时的（标「今天」）。预算上限在设置里，超出会熔断。
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="近 7 天花费" value={money(usd)} hint={usd > 1.4 ? "接近日预算 ×7" : "在预算内"} tone={usd > 1.4 ? "warn" : undefined} />
        <Stat label="近 7 天调用" value={calls.toLocaleString("en-US")} hint={`平均每天 ${Math.round(calls / Math.max(1, week.length))} 次`} />
        <Stat label="空抓占比" value={calls ? `${((empty / calls) * 100).toFixed(1)}%` : "—"} hint={`${empty.toLocaleString("en-US")} 次没返回帖子`} />
        <Stat label="返回对象" value={objects.toLocaleString("en-US")} hint="计费就按这个数" />
      </div>

      <Card title="每天明细" className="mt-3">
        <DataTable
          rows={days}
          rowKey={(row) => row.day}
          columns={[
            {
              key: "day",
              label: "日期",
              render: (row) => (
                <span className="num">
                  {row.day}
                  {row.live && <span className="ml-1.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10.5px] text-accent">今天</span>}
                </span>
              ),
            },
            { key: "calls", label: "调用", align: "right", render: (row) => row.calls.toLocaleString("en-US") },
            { key: "empty", label: "空抓", align: "right", render: (row) => row.emptyCalls.toLocaleString("en-US") },
            {
              key: "rate",
              label: "空抓率",
              align: "right",
              render: (row) => (
                <span className={rate(row) > 60 ? "text-amber" : "text-ink-2"}>{rate(row).toFixed(1)}%</span>
              ),
            },
            { key: "objects", label: "对象", align: "right", render: (row) => row.objects.toLocaleString("en-US") },
            {
              key: "usd",
              label: "花费",
              align: "right",
              render: (row) => (
                <span className={row.usd > 1.6 ? "text-bad" : "text-ink"}>{money(row.usd)}</span>
              ),
            },
            { key: "sources", label: "覆盖源", align: "right", render: (row) => `${row.sources} / ${row.enabledSources}` },
          ]}
        />
      </Card>

      <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
        怎么读：<b className="text-ink-2">调用涨、对象不涨</b> = 抓得太勤或分片太碎；
        <b className="text-ink-2">空抓率高</b> = 那批源本来就不活跃，该降档或淘汰；
        <b className="text-ink-2">花费贴近 $2</b> = 预算会熔断，先降档再加源。
      </p>
    </AdminPage>
  );
}
