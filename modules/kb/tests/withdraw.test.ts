// 撤回传播与保留：卡片离开 notes/ 进 archive/、索引同步、换月换目录不留旧文件、
// archive/ 里的文件按最后一次改动的时间保留 7 天。
//
// 不连库：读取层给「谁不再公开」的结论，这里只管文件与索引的搬运。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const DATA = await mkdtemp(path.join(os.tmpdir(), "kb-withdraw-"));
process.env.AIHOT_DATA_DIR = DATA;

import type { Note } from "../backend/layout.ts";
const { archiveDir, inboxDir, kbRoot, noteFile, renderNote, writeNote } = await import("../backend/layout.ts");
const { loadIndex, listNotes, readNote, saveIndex } = await import("../backend/read.ts");
const { ARCHIVE_DAYS, inboxCount, kbRetention, resetInbox, syncNote, withdrawByIds } = await import("../backend/prune.ts");

after(async () => {
  await rm(DATA, { recursive: true, force: true });
});

function card(id: string, title: string, at = "2026-10-09T00:00:00.000Z"): Note {
  return {
    frontmatter: { id, title, created_at: at, updated_at: at, tags: ["radar", "event"], source_refs: ["https://example.com/1"], status: "active", ai_access: "allow" },
    body: `# ${title}\n\n## 摘要\n\n${title}的摘要。`,
  };
}

/** 把一张卡片写进磁盘 + 清单（像导出的最后一步那样）。 */
async function put(note: Note, relPath: string): Promise<void> {
  const text = renderNote(note);
  await writeNote(relPath, text);
  const index = (await loadIndex()) ?? { schemaVersion: 1 as const, exportedAt: nowIso(), window: { itemRetentionDays: 90, reportsLookback: 8 }, counts: {}, notes: [] };
  index.notes = [...index.notes.filter((n) => n.id !== note.frontmatter.id), {
    id: note.frontmatter.id,
    kind: "event",
    path: relPath,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
    title: note.frontmatter.title,
    tags: note.frontmatter.tags,
    status: note.frontmatter.status,
    created_at: note.frontmatter.created_at,
    updated_at: note.frontmatter.updated_at,
    source_refs: 1,
  }];
  index.counts = { event: index.notes.length };
  await saveIndex(index);
}

const nowIso = () => new Date().toISOString();

/** archive/ 下所有文件（相对 kbRoot）。 */
async function archived(): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else out.push(path.relative(kbRoot(), file).split(path.sep).join("/"));
    }
  };
  await walk(archiveDir());
  return out.sort();
}

before(async () => {
  await put(card("kb-event-alpha", "事件甲"), "notes/events/2026-10/alpha.md");
  await put(card("kb-event-beta", "事件乙"), "notes/events/2026-10/beta.md");
  await put(card("kb-event-gamma", "事件丙"), "notes/events/2026-11/gamma.md");
});

test("撤回：卡片离开 notes/ 进 archive/，内容原样保留，索引同步", async () => {
  const before = await readFile(noteFile("notes/events/2026-10/alpha.md"), "utf8");
  const result = await withdrawByIds(["kb-event-alpha"]);
  assert.deepEqual(result.archived, ["kb-event-alpha"]);
  assert.equal(await readNote("kb-event-alpha"), null, "索引里不再有它");
  assert.deepEqual((await listNotes()).map((n) => n.id), ["kb-event-beta", "kb-event-gamma"], "剩下的两张按 id 排（内容时间相同）");
  assert.equal(await readFile(noteFile("notes/events/2026-10/alpha.md"), "utf8").catch(() => null), null, "notes/ 下的文件没了");

  const files = await archived();
  assert.equal(files.length, 1);
  assert.match(files[0]!, /^archive\/\d{4}-\d{2}\/[\dT:.Z-]+-alpha\.md$/);
  assert.equal(await readFile(noteFile(files[0]!), "utf8"), before, "归档的是原文，不是空文件");
  assert.equal((await loadIndex())!.notes.length, 2, "清单跟着更新");
});

test("撤回不存在的卡片：什么也不做，不报错", async () => {
  assert.deepEqual(await withdrawByIds(["kb-event-不存在"]), { archived: [] });
  assert.deepEqual(await withdrawByIds([]), { archived: [] });
  assert.equal((await loadIndex())!.notes.length, 2);
});

test("换月：旧目录的文件进 archive/，新目录写一份，索引只留新路径", async () => {
  const index = (await loadIndex())!;
  const gamma = index.notes.find((n) => n.id === "kb-event-gamma")!;
  const fresh = card("kb-event-gamma", "事件丙");
  const text = renderNote(fresh);
  const moved = await syncNote({ relPath: "notes/events/2026-12/gamma.md", text, prior: gamma, frontmatter: fresh.frontmatter, kind: "event", now: new Date() });
  assert.equal(moved, "moved");
  assert.equal(await readFile(noteFile(gamma.path), "utf8").catch(() => null), null, "旧位置的文件进了 archive/");
  assert.ok((await archived()).some((f) => f.endsWith("-gamma.md")), "旧文件保留在 archive/，不是直接删掉");

  // 索引的更新是导出作业的事（syncNote 只管文件），这里照导出的做法把这一行改到新路径。
  gamma.path = "notes/events/2026-12/gamma.md";
  gamma.sha256 = createHash("sha256").update(text, "utf8").digest("hex");
  await saveIndex(index);
  assert.ok(await readNote("kb-event-gamma"), "新位置可读");
  assert.equal((await loadIndex())!.notes.find((n) => n.id === "kb-event-gamma")!.path, "notes/events/2026-12/gamma.md");
});

test("保留：archive/ 里超过 7 天的真删，新近的留着，inbox 一起清", async () => {
  const files = await archived();
  assert.ok(files.length >= 2, "前面已经移进来两张");
  const at = (rel: string, days: number) => utimes(noteFile(rel), new Date(Date.now() - days * 86_400_000), new Date(Date.now() - days * 86_400_000));
  for (const rel of files) await at(rel, ARCHIVE_DAYS + 1);
  await mkdir(inboxDir(), { recursive: true });
  await writeFile(path.join(inboxDir(), "半成品.tmp"), "x", "utf8");

  const result = await kbRetention();
  assert.equal(result.deletedItems, 0, "没有精选卡，一条都不删");
  assert.equal(result.deletedArchived, files.length, "全超过 7 天，全部真删");
  assert.equal(result.clearedInbox, 1, "inbox 兜底清空");
  assert.deepEqual(await archived(), []);
  assert.equal(await inboxCount(), 0);

  // 新近归档的留着。
  await withdrawByIds(["kb-event-beta"]);
  const fresh = await archived();
  assert.equal(fresh.length, 1);
  assert.equal((await kbRetention()).deletedArchived, 0, "刚归档的不动");
  assert.deepEqual(await archived(), fresh);
});

test("保留：没有清单时也不报错，只清 archive 与 inbox", async () => {
  // 拷贝一份再删，后面的用例还要把它放回去（清单没了不代表卡片没了）。
  const index = await readFile(path.join(kbRoot(), "kb-index.json"), "utf8");
  await rm(path.join(kbRoot(), "kb-index.json"), { force: true });
  const result = await kbRetention();
  assert.deepEqual(result, { deletedItems: 0, deletedArchived: 0, clearedInbox: 0 });
  assert.equal(await loadIndex(), null, "没有清单就当还没导出过，不报错");
  assert.equal((await listNotes()).length, 0);
  await writeFile(path.join(kbRoot(), "kb-index.json"), index, "utf8");
});

test("resetInbox 只清 inbox，不碰其它目录", async () => {
  await mkdir(inboxDir(), { recursive: true });
  await writeFile(path.join(inboxDir(), "a.tmp"), "x", "utf8");
  await writeFile(path.join(inboxDir(), "b.tmp"), "x", "utf8");
  assert.equal(await resetInbox(), 2);
  assert.deepEqual(await readdir(noteFile("notes/reports/daily")).catch(() => null), null, "没有的目录没有被建出来");
  assert.equal((await listNotes()).length, 1, "剩下的是 gamma 那张");
});
