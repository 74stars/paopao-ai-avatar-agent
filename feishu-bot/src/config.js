export function env(name, fallback = "") {
  return process.env[name] || fallback;
}

export const config = {
  port: Number(env("PORT", "8787")),
  feishu: {
    appId: env("FEISHU_APP_ID"),
    appSecret: env("FEISHU_APP_SECRET"),
    verificationToken: env("FEISHU_VERIFICATION_TOKEN"),
    defaultReceiveIdType: env("FEISHU_DEFAULT_RECEIVE_ID_TYPE", "open_id"),
    defaultReceiveId: env("FEISHU_DEFAULT_RECEIVE_ID"),
    customBotWebhook: env("FEISHU_CUSTOM_BOT_WEBHOOK"),
    customBotSecret: env("FEISHU_CUSTOM_BOT_SECRET"),
  },
  model: {
    apiKey: env("OPENAI_API_KEY"),
    chatModel: env("OPENAI_MODEL", "gpt-4.1-mini"),
    embeddingModel: env("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
  },
};

