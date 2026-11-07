// 后台运行页里本模块那块（apps/web/app/modules.ts 的 WebModule.admin.runs）：模型榜各评测来源的抓取状态。
// 数据是 server.ts 的 runsPart 交给插口的那份，形状与旧版 AdminRuns.leaderboard 一致；还没有抓过一次时它是 null。
import { bj, num } from "@aihot/web/features/admin/format";
import { Badge, Card, DataTable, Time } from "@aihot/web/features/admin/ui";

/** 一个评测来源的抓取状态（server.ts 的 SourceState）。 */
interface RunsSource {
  key: string;
  ok: boolean;
  at?: string;
  lastOkAt: string | null;
  changed?: boolean;
  rows?: number;
  newModels?: number;
  error?: string;
}

interface RunsData {
  at: string;
  sources: RunsSource[];
}

/** 把插口给的 data 收窄成本模块的形状；不是它（还没有抓取记录）就什么都不画。 */
function asRuns(data: unknown): RunsData | null {
  const d = data as Partial<RunsData> | null;
  return d && typeof d === "object" && typeof d.at === "string" && Array.isArray(d.sources) ? (d as RunsData) : null;
}

export default function LeaderboardRuns({ data }: { data: unknown }) {
  const d = asRuns(data);
  if (!d) return null;
  return (
    <Card
      className="mt-5"
      title="模型榜评测来源"
      right={<span>最近抓取 {bj(d.at)} · 成功 {d.sources.filter((x) => x.ok).length}/{d.sources.length}</span>}
      pad={false}
    >
      <div className="max-h-[360px] overflow-y-auto">
        <DataTable
          dense
          rows={d.sources}
          rowKey={(x) => x.key}
          columns={[
            { key: "k", label: "来源", render: (x) => <span className="font-mono text-[12.5px]">{x.key}</span> },
            { key: "s", label: "上次抓取", render: (x) => <Badge tone={x.ok ? "ok" : "bad"}>{x.ok ? (x.changed ? "有更新" : "无变化") : "失败"}</Badge> },
            { key: "ok", label: "上次成功", render: (x) => <Time at={x.lastOkAt} /> },
            { key: "n", label: "行数", align: "right", render: (x) => (x.rows == null ? "—" : num(x.rows)) },
            { key: "e", label: "错误", render: (x) => <span className="line-clamp-1 text-[12px] text-ink-3" title={x.error ?? ""}>{x.error}</span> },
          ]}
        />
      </div>
    </Card>
  );
}
