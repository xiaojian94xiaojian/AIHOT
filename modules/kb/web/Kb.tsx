// 后台的知识库页面：状态、列表（按类型/标签筛选）、关键词搜索、单篇 Markdown 预览、手动导出。
//
// 数据全部走本模块的后台接口（/api/modules/kb/*，只给管理员）；页面不读盘、更不调模型。
//
// 一个模块页面拿不到 react-router 的类型生成（typegen 只写 apps/web/app 里的文件），
// 所以这里的形状自己写清楚，照 modules/monitor/web/admin.tsx 的做法。
import { Form, Link, useSearchParams, type MetaFunction } from "react-router";
import { SITE } from "@aihot/site";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { ago, bj } from "@aihot/web/features/admin/format";
import { AdminPage, Badge, Button, Card, Empty, FilterChips, Input, Stat } from "@aihot/web/features/admin/ui";

/** 一篇笔记（/api/modules/kb/notes、/note 的形状：清单的一行 + frontmatter + 正文）。 */
type KbFrontmatter = { id: string; title: string; created_at: string; updated_at: string; tags: string[]; source_refs: string[]; status: string; ai_access: string };
type KbNote = {
  id: string;
  kind: "event" | "report" | "item";
  path: string;
  sha256: string;
  title: string;
  tags: string[];
  status: string;
  created_at: string;
  updated_at: string;
  source_refs: number;
  frontmatter: KbFrontmatter;
  body: string;
};

/** 知识库状态（/api/modules/kb/index）。 */
type KbStatus = {
  enabled: boolean;
  root: string;
  intervalMinutes: number;
  itemRetentionDays: number;
  reportsLookback: number;
  exportedAt: string | null;
  counts: Record<string, number>;
  total: number;
  inbox: number;
  consistent: boolean | null;
  missing: string[];
  changed: string[];
};

type SearchHit = { note: KbNote; score: number; matched: string[] };

type KbData = { status: KbStatus; notes: KbNote[]; hits: SearchHit[] | null; q: string; selected: KbNote | null };

const KIND_LABEL: Record<string, string> = { event: "事件", report: "报告", item: "精选" };
const KIND_TONE: Record<string, "accent" | "info" | "muted"> = { event: "accent", report: "info", item: "muted" };
const MATCH_LABEL: Record<string, string> = { title: "标题", tags: "标签", source_refs: "来源", headings: "章节", body: "正文" };

export async function loader({ request }: { request: Request }): Promise<KbData> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const kind = url.searchParams.get("kind") ?? "";
  const id = url.searchParams.get("id") ?? "";
  const list = `/api/modules/kb/notes?limit=100${kind ? `&kind=${encodeURIComponent(kind)}` : ""}`;
  const [status, notes, hits, selected] = await Promise.all([
    adminGet<KbStatus>(request, "/api/modules/kb/index"),
    adminGet<{ notes: KbNote[] }>(request, list).then((r) => r.notes),
    q ? adminGet<{ hits: SearchHit[] }>(request, `/api/modules/kb/search?limit=50&q=${encodeURIComponent(q)}${kind ? `&kind=${kind}` : ""}`).then((r) => r.hits) : Promise.resolve(null),
    id ? adminGet<KbNote>(request, `/api/modules/kb/note?id=${encodeURIComponent(id)}`).catch(() => null) : Promise.resolve(null),
  ]);
  return { status, notes, hits, q, selected };
}

export const meta: MetaFunction = () => [{ title: `知识库 · ${SITE.name} 后台` }];

function ExportButton({ enabled }: { enabled: boolean }) {
  const { run, busy, pending } = useAdminAction();
  const working = pending === "kb export";
  return (
    <Button
      tone="primary"
      size="sm"
      disabled={!enabled || busy}
      title={enabled ? "把当前的内容重新落成卡片" : "KB_EXPORT_ENABLED 不是 true，导出作业不会跑"}
      onClick={() => void run("POST", "/api/modules/kb/export", undefined, { label: "kb export", success: "已经排队，下一次导出会在几十秒内写盘" })}
    >
      {working ? "排队中…" : "立即导出"}
    </Button>
  );
}

function NoteCard({ note }: { note: KbNote }) {
  const [sp] = useSearchParams();
  const next = new URLSearchParams(sp);
  next.set("id", note.id);
  const refs = note.frontmatter.source_refs;
  return (
    <article className="rounded-panel bg-surface p-4 ring-1 ring-line">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-snug text-ink">{note.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-4">
            <span className="font-mono">{note.id}</span>
            <span>· 更新 {bj(note.updated_at, true)}（{ago(note.updated_at)}）</span>
            <span>· {refs.length} 个来源</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <Badge tone={KIND_TONE[note.kind] ?? "muted"}>{KIND_LABEL[note.kind] ?? note.kind}</Badge>
          {note.status !== "active" && <Badge tone="warn">{note.status}</Badge>}
          <Link to={`?${next}`} className="text-[12.5px] text-ink-3 hover:text-accent">预览</Link>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {note.tags.map((tag) => (
          <span key={tag} className="rounded-full bg-bg-sunk px-2 py-0.5 text-[11.5px] text-ink-3">{tag}</span>
        ))}
      </div>
      <p className="mt-2 line-clamp-3 whitespace-pre-line text-[13px] leading-relaxed text-ink-2">{note.body.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? ""}</p>
      <div className="mt-2 truncate font-mono text-[11.5px] text-ink-4">{refs[0] ?? "（没有来源链接）"}</div>
    </article>
  );
}

function Preview({ note }: { note: KbNote }) {
  const [sp] = useSearchParams();
  const back = new URLSearchParams(sp);
  back.delete("id");
  return (
    <Card
      title="Markdown 预览"
      right={<Link to={`?${back}`} className="hover:text-accent">关闭</Link>}
      pad={false}
    >
      <div className="border-b border-line px-4 py-3">
        <div className="text-[15px] font-semibold text-ink">{note.title}</div>
        <div className="mt-1 font-mono text-[11.5px] text-ink-4">{note.path}</div>
        <div className="mt-1 text-[12px] text-ink-4">
          frontmatter {Object.keys(note.frontmatter).length} 个字段 · 正文 {note.body.length} 字 · sha256 {note.sha256.slice(0, 12)}
        </div>
      </div>
      <pre className="scrollbar-thin max-h-[70vh] overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-[11.5px] leading-relaxed text-ink-2">
        {`---\nid: ${note.id}\n---\n\n${note.body}`}
      </pre>
      <div className="border-t border-line px-4 py-3 text-[12.5px] text-ink-3">
        卡片在数据目录下的 <span className="font-mono">{note.path}</span>；要改内容就改来源或导出规则，不要手改文件 —— 下一次导出会覆盖它。
      </div>
    </Card>
  );
}

export default function Kb({ loaderData }: { loaderData: KbData }) {
  const { status, notes, hits, q, selected } = loaderData;
  const [sp] = useSearchParams();
  const kind = sp.get("kind") ?? "";
  return (
    <AdminPage
      title="知识库"
      subtitle={`把已经筛选、评判、写作好的内容落成 Markdown 卡片（事件 / 报告 / 精选），放在数据目录下；这里是读取出口，卡片不进公开前台。`}
      actions={<ExportButton enabled={status.enabled} />}
    >
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="事件卡" value={status.counts.event ?? 0} hint="热榜上的事件" />
        <Stat label="报告卡" value={status.counts.report ?? 0} hint={`最近 ${status.reportsLookback} 期`} />
        <Stat label="精选卡" value={status.counts.item ?? 0} hint={`保留 ${status.itemRetentionDays} 天`} />
        <Stat
          label="上次导出"
          value={status.exportedAt ? ago(status.exportedAt) : "从未"}
          hint={status.exportedAt ? bj(status.exportedAt, true) : "还没有导出过"}
          tone={status.consistent === false ? "warn" : status.enabled ? "ok" : undefined}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge tone={status.enabled ? "ok" : "warn"}>{status.enabled ? "导出已开启" : "导出已关闭（KB_EXPORT_ENABLED 不是 true）"}</Badge>
        <Badge tone="muted">每 {status.intervalMinutes} 分钟一次</Badge>
        <Badge tone={status.consistent === false ? "bad" : "muted"}>
          {status.consistent === null ? "还没有清单" : status.consistent ? "清单与文件一致" : `清单与文件不一致：缺 ${status.missing.length}、变了 ${status.changed.length}`}
        </Badge>
        <Badge tone={status.inbox ? "warn" : "muted"}>inbox {status.inbox}</Badge>
        <span className="font-mono text-[11.5px] text-ink-4">{status.root}</span>
      </div>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <FilterChips
          param="kind"
          options={[
            { value: "", label: "全部", count: status.total },
            { value: "event", label: "事件", count: status.counts.event ?? 0 },
            { value: "report", label: "报告", count: status.counts.report ?? 0 },
            { value: "item", label: "精选", count: status.counts.item ?? 0 },
          ]}
        />
        <Form method="get" className="flex w-full max-w-md gap-2">
          {kind && <input type="hidden" name="kind" value={kind} />}
          <Input name="q" defaultValue={q} placeholder="搜标题、标签、来源或正文" aria-label="搜索知识库" />
          <Button type="submit">搜索</Button>
        </Form>
      </div>

      <div className={`grid gap-4 ${selected ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : ""}`}>
        <div className="min-w-0 space-y-3">
          {hits ? (
            <>
              <div className="text-[12.5px] text-ink-3">“{q}” 命中 {hits.length} 条，按加权分数排列</div>
              {hits.map((hit) => (
                <div key={hit.note.id}>
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-4">
                    <span className="num font-semibold text-accent">{hit.score}</span>
                    <span>分</span>
                    {hit.matched.map((m) => (
                      <span key={m} className="rounded-full bg-bg-sunk px-1.5 py-0.5">{MATCH_LABEL[m] ?? m}</span>
                    ))}
                  </div>
                  <NoteCard note={hit.note} />
                </div>
              ))}
              {!hits.length && <Empty>没有命中：换关键词，或者去掉类型筛选再试。</Empty>}
            </>
          ) : notes.length ? (
            notes.map((note) => <NoteCard key={note.id} note={note} />)
          ) : (
            <Empty>
              {status.total ? "这个筛选下没有卡片。" : "知识库还是空的：把 KB_EXPORT_ENABLED 设成 true，重启 worker，然后点“立即导出”。"}
            </Empty>
          )}
        </div>
        {selected && <div className="min-w-0">{<Preview note={selected} />}</div>}
      </div>
    </AdminPage>
  );
}
