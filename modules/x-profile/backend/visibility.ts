// 公开页的可见性口径：撤回的帖子（publications.visibility = 'withdrawn'）不再出现在画像、代表帖、
// 今日选题、方法论和周报里。查询里的 articles 别名统一用 a。
import { sql } from "@aihot/backend/db";

export const notWithdrawn = sql`NOT EXISTS (
  SELECT 1 FROM publications withdrawn_pub
  WHERE withdrawn_pub.article_id = a.id AND withdrawn_pub.visibility = 'withdrawn')`;
