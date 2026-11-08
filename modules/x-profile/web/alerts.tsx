// 飞书提醒：把「每天一张卡」和「回复机会」推到你自己的飞书群。
// 不需要登录：绑一个飞书自定义机器人的 webhook 就行，消息里带退订链接。
import { useState } from "react";
import { Link } from "react-router";
import { pageMeta } from "@aihot/web/lib/seo";

export const handle = { tab: "x-tools", name: "飞书提醒" } as const;

export function meta() {
  return pageMeta({
    title: "飞书提醒：每天一张卡推到手边",
    description: "绑定飞书自定义机器人，每天早上收到一张「今天写这条」，有值得回的帖时再单独推一条。",
    path: "/x-people/alerts",
  });
}

type State = { status: "idle" | "loading" | "ok" | "error"; message?: string };

export default function AlertsPage() {
  const [webhook, setWebhook] = useState("");
  const [handleValue, setHandleValue] = useState("");
  const [kinds, setKinds] = useState<string[]>(["card"]);
  const [state, setState] = useState<State>({ status: "idle" });

  const toggle = (kind: string) =>
    setKinds((current) => (current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind]));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (state.status === "loading") return;
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/site/x-people/alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ webhook: webhook.trim(), handle: handleValue.trim() || null, kinds }),
      });
      const data = (await res.json().catch(() => ({}))) as { detail?: string };
      if (res.ok) {
        setState({ status: "ok", message: "绑定成功，去飞书看看刚才那条测试消息。" });
        setWebhook("");
      } else {
        setState({ status: "error", message: data.detail ?? "没绑上，检查一下地址再试。" });
      }
    } catch {
      setState({ status: "error", message: "网络不通，稍后再试。" });
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-4 lg:px-6">
      <nav className="mt-1 text-[12px] text-ink-3">
        <Link to="/x-people/today" className="hover:text-ink">今天发什么</Link>
        <span className="mx-1.5 text-ink-4">/</span>
        <span className="text-ink-2">飞书提醒</span>
      </nav>

      <header className="mt-2">
        <h1 className="text-[24px] font-black tracking-[-0.02em] text-ink lg:text-[28px]">飞书提醒</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
          每天早上给你发一张「今天写这条」；有值得接一句的帖时，单独推一条。绑定不需要账号，退订在每条消息底部。
        </p>
      </header>

      <section className="mt-4 rounded-card border border-line bg-surface p-4">
        <h2 className="text-[13px] font-semibold text-ink">三步绑定</h2>
        <ol className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-ink-2">
          <li><span className="text-ink-4">1　</span>在飞书群里点「设置 → 群机器人 → 添加机器人 → 自定义机器人」</li>
          <li><span className="text-ink-4">2　</span>复制它给的 webhook 地址（形如 <code className="rounded-control bg-bg-sunk px-1 py-0.5 text-[11.5px]">https://open.feishu.cn/open-apis/bot/v2/hook/…</code>）</li>
          <li><span className="text-ink-4">3　</span>粘贴到下面，点「绑定并测试」——会立刻发一条测试消息</li>
        </ol>
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-4">
          一个人用就建一个只有自己的群；几个人共用就填群版（不填账号），收到的是公共内容。
        </p>
      </section>

      <form onSubmit={submit} className="mt-4 space-y-3 rounded-card border border-line bg-surface p-4">
        <label className="block">
          <span className="text-[12.5px] text-ink-2">飞书 webhook</span>
          <input
            required
            value={webhook}
            onChange={(event) => setWebhook(event.target.value)}
            placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…"
            className="mt-1 w-full rounded-control border border-line bg-bg-sunk px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-4"
          />
        </label>

        <label className="block">
          <span className="text-[12.5px] text-ink-2">你的 X 账号<span className="ml-1 text-ink-4">（选填；填了卡片会带你的诊断）</span></span>
          <input
            value={handleValue}
            onChange={(event) => setHandleValue(event.target.value)}
            placeholder="@handle，群版留空"
            className="mt-1 w-full rounded-control border border-line bg-bg-sunk px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-4"
          />
        </label>

        <fieldset className="space-y-1.5">
          <legend className="text-[12.5px] text-ink-2">要哪些提醒</legend>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <input type="checkbox" checked={kinds.includes("card")} onChange={() => toggle("card")} />
            每天早上 8 点一张卡
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <input type="checkbox" checked={kinds.includes("reply")} onChange={() => toggle("reply")} />
            回复机会（3 小时内起量、回复还少的帖，每人每天最多 5 条）
          </label>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={state.status === "loading"}
            className="rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-medium text-bg disabled:opacity-60"
          >
            {state.status === "loading" ? "发送测试…" : "绑定并测试"}
          </button>
          {state.status === "ok" && <span className="text-[12.5px] text-accent">{state.message}</span>}
          {state.status === "error" && <span className="text-[12.5px] text-red-600">{state.message}</span>}
        </div>
        <p className="text-[11px] leading-relaxed text-ink-4">
          webhook 会加密存在我们这里，只能用来给你发消息；想停就点消息里的退订，或者再绑一次覆盖。
        </p>
      </form>
    </div>
  );
}
