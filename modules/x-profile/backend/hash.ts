// IP / webhook 的指纹：带密钥的 HMAC，不能用裸 SHA-256 —— IPv4 只有 2^32，秒级可枚举。
// 密钥复用 SESSION_SECRET；没有配置时退回无盐哈希（只影响本地开发，生产一定配了）。
import { createHash, createHmac } from "node:crypto";
import { credential } from "@aihot/backend/config";

/** 加密门槛：webhook 落库前要求 SESSION_SECRET 至少这么长（hashIp 只要有 secret 就走 HMAC）。 */
export const SECRET_MIN = 16;

export function hashIp(value: string, purpose: string): string {
  const secret = credential("auth", "SESSION_SECRET");
  const data = `${purpose}|${value}`;
  // 只要有 secret 就走 HMAC：8 位下限由启动检查保证，这里不再设第二道门槛。
  return secret
    ? createHmac("sha256", secret).update(data).digest("hex")
    : createHash("sha256").update(data).digest("hex");
}

/** webhook 的指纹：订阅身份认它，不认账号。 */
export const webhookHashOf = (webhook: string) => hashIp(webhook, "feishu-webhook");
