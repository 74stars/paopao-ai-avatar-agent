# 泡泡桌面 Agent

一个 Windows 桌面常驻的智能生命入口。泡泡接收文字、按住说话、链接、图片和文件，把原始材料保存在本机，再自动整理进会生长的活书房。

## 三个窗口

- 桌面泡泡：透明、置顶、可拖动靠边，单击记录、双击打开书房。
- 快速投递口：`Ctrl+Shift+Space` 唤起，支持只记住或请泡泡思考。
- 活书房：日记、思想、人物、阅读、目标、日报和周报按真实书脊生长。

## 本地开发

```powershell
npm.cmd install
npm.cmd run dev
```

构建 Windows 安装包：

```powershell
npm.cmd run dist
```

## 数据与隐私

- SQLite 数据库保存在 Electron `userData` 目录。
- API 密钥使用 Windows `safeStorage` 加密。
- 剪贴板建议默认关闭，只询问是否收藏，绝不自动保存。
- Supabase 同步默认关闭；启用后只上传 AES-256-GCM 密文。
