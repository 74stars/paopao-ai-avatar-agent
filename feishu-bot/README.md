# 泡泡飞书机器人 MVP 骨架

这是“泡泡数字超我”的第一版工程骨架。

它现在做三件事：

1. 接收飞书事件订阅里的消息。
2. 把原始输入写入本地 `data/raw-events.jsonl`。
3. 生成一个正向、行动导向的回复，并预留 RAG / Self Model / 主动提醒接口。

## 为什么不是只用自定义机器人

自定义机器人 Webhook 适合主动推送到群里，但不适合作为完整数字分身入口。

泡泡需要接收你的消息、理解、写入记忆、再回复你，所以应该用飞书开放平台应用：

- 事件订阅：接收消息
- 消息 API：主动回复/提醒
- 后续可接入日历、文档、文件

## 本地运行

```bash
cd outputs/paopao-feishu-bot
cp .env.example .env
npm start
```

默认监听：

```text
http://127.0.0.1:8787
```

飞书事件回调需要公网 HTTPS 地址。开发时可以用 Cloudflare Tunnel、ngrok 或部署到云函数/服务器。

## 你需要填的配置

见 `.env.example`。

最关键的是：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_VERIFICATION_TOKEN`
- `FEISHU_DEFAULT_RECEIVE_ID`
- `OPENAI_API_KEY`，后续接模型时需要

## 当前接口

```text
GET  /health
POST /feishu/events
POST /tasks/morning
POST /tasks/nightly
```

## 飞书端要配置

1. 创建飞书开放平台应用。
2. 开启机器人能力。
3. 配置事件订阅，请求地址填公网地址加 `/feishu/events`。
4. 订阅接收消息事件。
5. 给应用开通发送消息相关权限。
6. 发布或安装到你的飞书租户。

官方文档：

- 事件订阅：https://open.feishu.cn/document/server-docs/event-subscription-guide/overview
- 发送消息：https://open.feishu.cn/document/server-docs/im-v1/message/create

## 下一步

这个骨架后续要补：

- SQLite / Postgres
- embedding 和向量检索
- 图片/语音/链接解析
- 天气和地点接入
- 飞书日历接入
- 主动提醒调度器
- Self Model 自动迭代

