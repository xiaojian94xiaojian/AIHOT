// 本机启动 api，指向临时测试库（docker aihot-testdb），只为验证恢复出来的模块路由。
process.env.DATABASE_URL = "postgres://aihot:aihot@127.0.0.1:55432/aihot_test";
process.env.PORT = "3001";
process.env.SITE_URL = "http://127.0.0.1:3000";
process.env.SESSION_SECRET ??= "smoke-session-secret-0123456789";
process.env.IMG_PROXY_SIGN_SECRET ??= "smoke-img-secret-0123456789";
process.env.LOG_LEVEL = "warn";
process.env.COLLECT_ENABLED = "false";
process.env.MODEL_CALLS_ENABLED = "false";
process.env.FEISHU_CONTENT_PUSH_ENABLED = "false";
process.env.FEISHU_INTERNAL_ENABLED = "false";
process.env.INDEXNOW_SUBMIT_ENABLED = "false";
await import("../../apps/api/src/main.ts");
