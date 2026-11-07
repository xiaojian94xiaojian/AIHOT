// 博主的两层分类：语言区按帖子语言占比判断；账号类型按 handle 维护一张表（站内可随时改）。
// 类型只影响浏览与分组，不参与任何采集或分析逻辑。
import type { PersonKind, Region } from "../types.ts";

/** 语言区：中文、英文、其他（双语/其他语言）。 */
export function regionOf(zhPct: number, enPct: number): Region {
  if (zhPct >= 50) return "zh";
  if (enPct >= 50) return "en";
  return "other";
}

const OFFICIAL = new Set([
  "openai", "anthropicai", "deepseek_ai", "googleaidevs", "googledeepmind", "nvidiaai", "nvidiartxspark",
  "metaai", "mistralai", "alibaba_qwen", "qwen", "minimax_ai", "moonshot_ai", "kimi_moonshot", "zai_org",
  "xai", "grok", "perplexity_ai", "huggingface", "llamaindex", "databricks", "cloudflaredev", "github",
  "microsoft", "replit", "fireworksai_hq", "modelscope2022", "arena", "openrouter", "artificialanlys",
  "cursor_ai", "langchain", "vercel", "supabase", "cloudflare", "awscloud", "googlecloud", "azure",
  "alibaba", "baidu", "bytedance", "tencent", "suno", "runwayml", "elevenlabs", "heygen", "luma_ai",
]);

const FOUNDER = new Set([
  "sama", "elonmusk", "alexandr_wang", "aravsrinivas", "rauchg", "levelsio", "thdxr", "bindureddy",
  "theo", "mitsuhiko", "swyx", "saranormous", "a16z", "yuchen", "demishassabis", "darioamodei",
  "clemdelangue", "satyanadella", "sundarpichai", "jeffdean", "jensenhuang", "arturn", "thsottiaux",
]);

const RESEARCHER = new Set([
  "karpathy", "ylecun", "drfeifei", "andrewyng", "fchollet", "hardmaru", "natolambert", "omarsar0",
  "emollick", "yuchenj_uw", "dongxi_nlp", "garymarcus", "timkellogg", "roydanroy", "sarahookr",
  "seb_ruder", "rasbt", "jimfan", "michael_truell", "noambrown", "shane_gu", "yuxi",
]);

const MEDIA = new Set([
  "testingcatalog", "therundownai", "semianalysis_", "edzitron", "koltregaskes", "andrewcurran_",
  "aidotengineer", "aiDotEngineer", "thexpin", "altryne", "daveshapi", "scobleizer", "intuitmachine",
  "teortaxesTex", "scaling01", "kimmonismus", "cb_doge", "dair_ai", "ai_news", "ainews", "theverge",
  "techcrunch", "wired", "arstechnica", "bloomberg", "ithome", "36kr", "huxiu", "qbitai", "jiqizhixin",
  "thedecoder", "theinformation", "venturebeat", "marktechpost", "thegradient", "semianalysis",
]);

const BUILDER = new Set([
  "rohanpaul_ai", "cellinlab", "imwsl90", "financeyf5", "maxforai", "shao__meng", "datachaz",
  "gosailglobal", "lxfater", "dotey", "berryxia", "dingyi", "gorden_sun", "vista8", "pandatalk8",
  "geekbb", "op7418", "tualatrix", "jesselaunz", "huangyun_122", "xiaohu", "indie_maker_fox",
  "vikingmute", "oran_ge", "canghe", "cuimao", "aigclink", "yangyi", "indigox", "minchoi", "dr_cintas",
  "haider1", "davidondrej1", "linusekenstam", "svpino", "hiteshdotcom", "danielmiessler", "reach_vb",
  "poteto", "dexhorthy", "jxnlco", "mark_k", "simonw", "hwchase17", "danshipper", "alexalbert__",
  "goodside", "minimaxir", "sytaylor", "rileybrown", "gregisenberg", "nathanlands",
]);

const LOOKUP = new Map<string, PersonKind>([
  ...[...OFFICIAL].map((h) => [h.toLowerCase(), "official"] as const),
  ...[...FOUNDER].map((h) => [h.toLowerCase(), "founder"] as const),
  ...[...RESEARCHER].map((h) => [h.toLowerCase(), "researcher"] as const),
  ...[...MEDIA].map((h) => [h.toLowerCase(), "media"] as const),
  ...[...BUILDER].map((h) => [h.toLowerCase(), "builder"] as const),
]);

export function personKind(handle: string): PersonKind {
  return LOOKUP.get(handle.toLowerCase()) ?? "other";
}
