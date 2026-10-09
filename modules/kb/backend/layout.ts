// 知识库目录与笔记文件本身：路径规则、原子写、frontmatter 的渲染与解析。
//
// 目录契约借自 Nodus（E:\Nodus\vault\README.md）：顶层 inbox/ notes/ archive/，分类靠 frontmatter 不靠深层目录。
// 放在部署数据目录（AIHOT_DATA_DIR 那一卷）下，所以活过镜像重建；它是派生数据，可以从库里重新生成。
//
// 三条硬约束（KB-PLAN.md §4.1）：frontmatter 恰好 9 个字段、body 非空且首行 `# <title>`、
// 来源引用只放 source_refs。多了键将来 Nodus 导入就是 invalid_note，所以渲染和解析都按 9 个字段来。
import { open, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "@aihot/backend/config";

/** 卡片的类型：目录名、id 前缀、tags 的第二项都按它取。 */
export type NoteKind = "event" | "report" | "item";

export const NOTE_KINDS: readonly NoteKind[] = ["event", "report", "item"];

/** 报告卡按报告种类再分一层目录。 */
export type ReportCardKind = "daily" | "weekly" | "monthly";

/** 笔记的 frontmatter：严格这 9 个字段，顺序固定，一个都不能多。 */
export interface NoteFrontmatter {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  tags: string[];
  source_refs: string[];
  status: string;
  ai_access: string;
}

/** 一篇笔记：frontmatter、正文，和它落在磁盘上的位置。 */
export interface Note {
  frontmatter: NoteFrontmatter;
  body: string;
}

/** 知识库根目录。 */
export function kbRoot(): string {
  return path.join(config.dataDir, "kb");
}

/** 落盘中间态：临时文件进这里，同一个文件系统内 rename 到目标路径才是原子的。 */
export function inboxDir(): string {
  return path.join(kbRoot(), "inbox");
}

/** 撤回或过期卡片的落脚点；保留作业按 7 天清掉。 */
export function archiveDir(): string {
  return path.join(kbRoot(), "archive");
}

export function notesDir(): string {
  return path.join(kbRoot(), "notes");
}

/** 第二期：选题助手的工作稿。第一期只建目录，不写内容。 */
export function projectsDir(): string {
  return path.join(kbRoot(), "projects");
}

export function indexPath(): string {
  return path.join(kbRoot(), "kb-index.json");
}

/** 文件名按北京时间分月，便于人翻和以后的打包下载。 */
export function monthOf(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "01";
  return `${get("year")}-${get("month")}`;
}

/**
 * 卡片相对知识库根的路径。文件名用稳定 id（不是时间戳），所以重复导出就是覆盖同一个文件。
 * 路径一律用 `/` 分隔：跨平台一致，清单与接口里也是这个样子。
 */
export function notePath(kind: NoteKind, id: string, at: Date, reportKind?: ReportCardKind): string {
  const name = `${id}.md`;
  if (kind === "report") return posix(["notes", "reports", reportKind ?? "daily", name]);
  return posix(["notes", kind === "event" ? "events" : "items", monthOf(at), name]);
}

/** 用 `/` 拼相对路径（Windows 上 path.join 会给反斜杠，不进清单也不进接口）。 */
export function posix(parts: readonly string[]): string {
  return parts.join("/");
}

/** 卡片在磁盘上的绝对路径：相对路径按 `/` 拆开，各段交给 path.join 处理平台差异。 */
export function noteFile(relPath: string): string {
  return path.join(kbRoot(), ...relPath.split("/"));
}

/** 卡片 id 的前缀，和 Nodus 的 id 一样只用安全字符。 */
export function cardId(kind: NoteKind, value: string): string {
  return `kb-${kind}-${value}`;
}

/** 报告卡的 id 里带上报告种类，日报和周报同日同 key 时不会撞。 */
export function reportCardId(kind: ReportCardKind, key: string): string {
  return `kb-report-${kind}-${key}`;
}

/**
 * frontmatter 的字符串值：去掉换行（它会截断字段），两边不留空白。
 * 标题里的引号、冒号、`#` 都不需要转义 —— 值整体加双引号，规则就是 JSON 的字符串。
 */
export function scalar(value: string): string {
  return JSON.stringify(String(value).replace(/[\r\n]+/g, " ").trim());
}

/** frontmatter 里的字符串数组，同样一行一个键。 */
export function arrayValue(values: readonly string[]): string {
  return JSON.stringify(values.map((v) => String(v).replace(/[\r\n]+/g, " ").trim()));
}
/** 渲染一篇笔记：`---` 之间的 9 个字段，空行，然后是正文。 */
export function renderNote(note: Note): string {
  const f = note.frontmatter;
  const head = [
    "---",
    `id: ${scalar(f.id)}`,
    `title: ${scalar(f.title)}`,
    `created_at: ${f.created_at}`,
    `updated_at: ${f.updated_at}`,
    `tags: ${arrayValue(f.tags)}`,
    `source_refs: ${arrayValue(f.source_refs)}`,
    `status: ${scalar(f.status)}`,
    `ai_access: ${scalar(f.ai_access)}`,
    "---",
  ];
  return `${head.join("\n")}\n\n${note.body.replace(/\s+$/, "")}\n`;
}

/** frontmatter 的键，顺序就是渲染的顺序；解析时按它认字段。 */
const KEYS = ["id", "title", "created_at", "updated_at", "tags", "source_refs", "status", "ai_access"] as const;
const REQUIRED: NoteFrontmatter = { id: "", title: "", created_at: "", updated_at: "", tags: [], source_refs: [], status: "", ai_access: "" };
/** 时间戳这类标量我们不写引号；解析时按原样的字符串收下。 */
const PLAIN = Symbol("plain");

/**
 * 一个值：JSON 的字符串/字符串数组，或者没加引号的普通标量（时间戳）。
 * 其它形状（数字、对象、混元素的数组）算坏字段。
 */
function decode(raw: string): string | string[] | typeof PLAIN {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "string") return value;
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value as string[];
    return PLAIN;
  } catch {
    return PLAIN;
  }
}

/**
 * 解析一篇笔记。frontmatter 必须恰好是那 9 个字段：多了少了都算坏文件，返回 null。
 * 读盘的地方据此跳过坏文件，而不是把半截内容当成笔记。
 */
export function parseNote(text: string): Note | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return null;
  const frontmatter: Record<string, string | string[]> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const at = line.indexOf(":");
    if (at < 1) return null;
    const key = line.slice(0, at).trim();
    if (!(KEYS as readonly string[]).includes(key) || key in frontmatter) return null;
    const raw = line.slice(at + 1).trim();
    const value = decode(raw);
    // tags 与 source_refs 必须是数组；标量没加引号时按原样收下（我们自己写的时间戳就是这样）。
    if (key === "tags" || key === "source_refs") {
      if (!Array.isArray(value)) return null;
      frontmatter[key] = value;
      continue;
    }
    frontmatter[key] = value === PLAIN ? raw : (value as string);
  }
  if (Object.keys(frontmatter).length !== KEYS.length) return null;
  const body = (match[2] ?? "").trim();
  if (!body) return null;
  return { frontmatter: { ...REQUIRED, ...(frontmatter as unknown as NoteFrontmatter) }, body };
}

/** 正文里 `## ` 章节的标题，搜索时按它们加权（Nodus 的确定性打分里的一处）。 */
export function headingsOf(body: string): string[] {
  return [...body.matchAll(/^#{2,4}\s+(.+)$/gm)].map((m) => m[1]!.trim()).filter(Boolean);
}

/**
 * 写一篇笔记：先写进 inbox 的临时文件并 fsync，再 rename 到目标路径。
 * 同一个文件系统的 rename 是原子的，所以读的人只会看到完整文件，不会看到半成品；
 * 覆盖已有文件在 Windows 上也一样（同目录内的改名就地替换）。
 */
export async function writeNote(relPath: string, text: string): Promise<void> {
  const target = noteFile(relPath);
  const dir = path.dirname(target);
  await mkdir(dir, { recursive: true });
  await mkdir(inboxDir(), { recursive: true });
  const tmp = path.join(inboxDir(), `${path.basename(target)}.${process.pid}.${Date.now().toString(36)}.tmp`);
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/** 读一篇笔记；不存在、读不动或者不合契约都返回 null。 */
export async function readNoteFile(relPath: string): Promise<Note | null> {
  const text = await readFile(noteFile(relPath), "utf8").catch(() => null);
  return text === null ? null : parseNote(text);
}

/** 纯粹的写文件（kb-index.json 这类清单）：同样先写临时文件再改名。 */
export async function writeDataFile(relPath: string, text: string): Promise<void> {
  const target = noteFile(relPath);
  await mkdir(path.dirname(target), { recursive: true });
  await mkdir(inboxDir(), { recursive: true });
  const tmp = path.join(inboxDir(), `${path.basename(target)}.${process.pid}.${Date.now().toString(36)}.tmp`);
  await writeFile(tmp, text, "utf8");
  try {
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/**
 * 把一张卡片移进 archive/（撤回传播与过期清理都用它）。保留原来的路径形状，
 * 前面加一个按北京时间排的时间戳，所以同名卡片被移进来两次也不会互相覆盖。
 */
export async function archiveNote(relPath: string, at: Date): Promise<string | null> {
  const from = noteFile(relPath);
  const dest = posix(["archive", monthOf(at), `${at.toISOString().replace(/[:.]/g, "-")}-${path.basename(relPath)}`]);
  const to = noteFile(dest);
  await mkdir(path.dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch {
    return null;
  }
  return dest;
}
