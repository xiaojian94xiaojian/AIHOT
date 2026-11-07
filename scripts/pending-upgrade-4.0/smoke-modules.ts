// 端到端读取冒烟：用恢复出来的模块代码读真实备份数据，确认四个功能都真的能跑起来。
// 和 tests/setup.ts 一样：这两个密钥在真实部署里由环境给出。
process.env.SESSION_SECRET ??= "smoke-session-secret-0123456789";
process.env.IMG_PROXY_SIGN_SECRET ??= "smoke-img-secret-0123456789";

import { closeDb } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import { leaderboardServerModule } from "@aihot/leaderboard/server";
import { monitorServerModule } from "@aihot/monitor/server";
import { chronicleServerModule } from "@aihot/chronicle/server";
import { loadBoard, loadModel, loadSource, loadSources, loadRulesData } from "@aihot/leaderboard/backend/read";
import { codexResetPage, codexResetsSnapshot, codexResetVersion } from "@aihot/monitor/backend/read";
import { loadSiteCodexResetPage } from "@aihot/monitor/backend/site-page";
import { codexAnswer } from "@aihot/monitor/backend/answer";

installModules([leaderboardServerModule, monitorServerModule, chronicleServerModule]);

const ok = (label: string, detail: string) => console.log(`OK    ${label.padEnd(30)} ${detail}`);
const need = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

try {
  // ---- leaderboard ----
  const board = await loadBoard("overall");
  need(board?.entries?.length, "overall board is empty");
  const top = board!.entries[0]!;
  ok("loadBoard(overall)", `${board!.entries.length} rows, top=${top.model.name}, sources=${board!.board.sourceCount}, operators=${board!.board.operatorCount}`);
  need(top.model.brand && top.model.brand.src, "top model has no brand mark");
  ok("brand mark", `${top.model.brand!.src} (${top.model.brand!.monogram})`);
  need(top.price, "top model has no price");
  ok("price + fx", `${top.price!.currency} in=${top.price!.input} cny=${top.price!.inputCny?.toFixed(2)}`);

  const coding = await loadBoard("coding");
  ok("loadBoard(coding)", `${coding!.entries.length} rows, ${coding!.board.name}`);

  const detail = await loadModel(top.model.slug);
  need(detail, "model detail missing");
  ok("loadModel", `${top.model.slug}: evidence=${detail!.evidence.length}, categories=${detail!.categories.length}, metrics=${detail!.metricCount}`);

  const sources = await loadSources();
  need(sources.groups.length, "no source groups");
  need(sources.totalCount, "no sources counted");
  ok("loadSources", `${sources.groups.length} groups, ${sources.rankedCount}/${sources.totalCount} ranked`);
  const firstSource = sources.groups[0]!.sources[0]!;
  const sourceDetail = await loadSource(firstSource.key);
  need(sourceDetail, "source detail missing");
  ok("loadSource", `${firstSource.key}: rows=${sourceDetail!.rows.length}, collected=${sourceDetail!.collected.length ?? 0}, upstreamAt=${sourceDetail!.upstreamAt ?? "null"}`);

  const rules = await loadRulesData();
  ok("loadRulesData", `methodology=${rules.run.methodologyVersion}, budgets=${Object.keys(rules.budgets).length}, anchors=${rules.anchors.length}`);

  // ---- monitor ----
  const snap = await codexResetsSnapshot();
  ok("codexResetsSnapshot", `events=${snap.events.length}, count=${snap.count}, today=${snap.today}, monitor=${snap.monitor?.status ?? "null"}`);

  const page = await codexResetPage();
  ok("codexResetPage", `events=${page.events.length}, calendar=${page.calendar.length}, monitor=${page.monitor?.status ?? "null"}`);

  const site = await loadSiteCodexResetPage();
  ok("loadSiteCodexResetPage", `selectedDate=${site.selectedDate}, events=${site.events.length}`);

  const version = await codexResetVersion();
  ok("codexResetVersion", `version=${version.version}`);

  const md = await codexAnswer();
  need(md.includes("Codex 额度重置"), "codex answer lost its heading");
  ok("codexAnswer", `${md.split("\n").length} lines`);

  // ---- the module sockets are installed and wired ----
  const lbAlerts = await leaderboardServerModule.alerts!(Date.now());
  ok("leaderboard alerts", `${lbAlerts.length} findings`);
  const moFindings = await monitorServerModule.alerts!(Date.now());
  ok("monitor alerts", `${moFindings.length} findings`);
  ok("monitor admin count", `pending=${await monitorServerModule.admin!.counts!.monitor!()}`);
  ok("leaderboard admin count", `unmarked=${await leaderboardServerModule.admin!.counts!.leaderboard!()}`);
  const runs = await leaderboardServerModule.admin!.runs!() as { sources: unknown[] } | null;
  ok("leaderboard admin runs", runs ? `sources=${runs.sources.length}` : "null (no fetch state stored yet)");
  const lbAnswer = await leaderboardServerModule.agent!.abilities![0]!.answer();
  need(lbAnswer.includes("模型榜"), "leaderboard agent answer lost its heading");
  ok("leaderboard agent answer", `${lbAnswer.split("\n").length} lines`);
  const mcp = await monitorServerModule.agent!.abilities![0]!.mcp.run({});
  need(mcp.text.length > 0 && mcp.structured, "monitor MCP tool returned nothing");
  ok("monitor MCP tool", `text=${mcp.text.split("\n").length} lines, structured=${Object.keys(mcp.structured).length} keys`);

  console.log("\nALL SMOKE CHECKS PASSED");
} catch (error) {
  console.error("FAILED:", error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
