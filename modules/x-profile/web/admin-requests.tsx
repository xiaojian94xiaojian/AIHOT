// 账号收录申请的后台页：待审列表 + 通过/驳回。通过走后台建源的同一路径（hot_signal，120 分钟），
// 采集在一个调度周期内补上第一批快照；驳回要写一句原因，申请人重新提交时能看到状态。
import { useState } from "react";
import { Link, type MetaFunction } from "react-router";
import { SITE } from "@aihot/site";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { bj } from "@aihot/web/features/admin/format";
import { AdminPage, Badge, Button, Card, Empty, FilterChips, ReasonDialog } from "@aihot/web/features/admin/ui";
import type { XAccountRequest, XAccountRequestList } from "../types.ts";

/** 模块页不在 app 目录里，typegen 不为它生成 +types，loader 的形状在这里写。 */
type Data = XAccountRequestList & { status: string };

export async function loader({ request }: { request: Request }): Promise<Data> {
  const status = new URL(request.url).searchParams.get("status") ?? "pending";
  const list = await adminGet<XAccountRequestList>(request, `/api/admin/x-people/requests?status=${encodeURIComponent(status)}`);
  return { ...list, status };
}

export const meta: MetaFunction = () => [{ title: `账号收录 · ${SITE.name} 后台` }];

const STATUS: Record<string, { label: string; tone: "ok" | "bad" | "muted" | "accent" }> = {
  pending: { label: "待审", tone: "accent" },
  approved: { label: "已收录", tone: "ok" },
  rejected: { label: "已驳回", tone: "muted" },
};

export default function AdminRequests({ loaderData }: { loaderData: Data }) {
  const { run, pending } = useAdminAction();
  const [rejecting, setRejecting] = useState<XAccountRequest | null>(null);

  const review = (r: XAccountRequest, action: "approve" | "reject", reason: string | null) =>
    run("POST", `/api/admin/x-people/requests/${encodeURIComponent(r.handle)}`, { action, reason }, {
      label: `${action}-${r.handle}`,
      success: action === "approve" ? `已收录 @${r.handle}，采集会在几分钟内补上` : `已驳回 @${r.handle}`,
    });

  return (
    <AdminPage
      title="账号收录"
      subtitle={<>读者自己提交的 X 账号收录申请。通过后建成 hot_signal 源（120 分钟一读），画像与涨粉榜随之出现。</>}
    >
      <FilterChips
        param="status"
        options={[
          { value: "", label: "待审" },
          { value: "approved", label: "已收录" },
          { value: "rejected", label: "已驳回" },
        ]}
      />
      <Card className="mt-4" pad={false}>
        {loaderData.items.length === 0 ? (
          <Empty>这里还没有{STATUS[loaderData.status]?.label ?? ""}的申请。</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {loaderData.items.map((r) => (
              <li key={r.handle} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link to={`/x-people/${r.handle}`} className="font-mono text-[13.5px] font-semibold text-ink hover:text-accent">
                      @{r.handle}
                    </Link>
                    <Badge tone={STATUS[r.status]?.tone ?? "muted"}>{STATUS[r.status]?.label ?? r.status}</Badge>
                  </div>
                  {r.note && <div className="mt-1 text-[13px] text-ink-2">{r.note}</div>}
                  <div className="mt-1 text-[12px] text-ink-4">
                    {bj(r.createdAt)} 提交
                    {r.contact ? ` · 联系：${r.contact}` : ""}
                    {r.reviewedAt ? ` · ${bj(r.reviewedAt)} ${r.reviewedBy ?? ""} 处理` : ""}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </div>
                </div>
                {r.status === "pending" && (
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" busy={pending === `approve-${r.handle}`} onClick={() => review(r, "approve", null)}>
                      通过并收录
                    </Button>
                    <Button size="sm" tone="ghost" onClick={() => setRejecting(r)}>
                      驳回
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ReasonDialog
        open={rejecting !== null}
        title={`驳回 @${rejecting?.handle ?? ""} 的收录申请`}
        description="原因只写给后台看；申请人再提交时只会看到「已驳回」。"
        confirmLabel="驳回"
        busy={pending === `reject-${rejecting?.handle ?? ""}`}
        onClose={() => setRejecting(null)}
        onSubmit={async (reason) => {
          if (!rejecting) return false;
          const done = await review(rejecting, "reject", reason);
          if (done !== null) setRejecting(null);
          return done !== null;
        }}
      />
    </AdminPage>
  );
}
