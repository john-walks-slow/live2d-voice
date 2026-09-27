# live2d-voice

One command to a standalone Live2D voice companion — 一条命令跑起独立的 Live2D 语音陪伴。

基于 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/dsh) 与 [dsh-live2d-voice](https://github.com/john-walks-slow/dsh-live2d-voice) 插件：浏览器里的 Live2D 角色 + 实时语音对话（ASR 听懂你 / LLM 思考 / TTS 开口说话），零配置起步，数据全在本机。

```
npx live2d-voice
```

## 环境要求

- **Node.js ≥ 22**（[下载](https://nodejs.org/)）
- 麦克风（语音输入）、扬声器（语音输出）
- 网络：LLM 走 DeepSeek 官方 API

## 快速开始

```bash
npx live2d-voice
```

首次运行会自动完成：

1. 生成数据目录 `~/.live2d-voice`（配置 + 模型 + 会话记录，全在本机）
2. 安装最小化 dsh web 运行时（约 1–2 分钟）
3. 启动服务并自动打开浏览器会话选择页

### 配置 API key（聊天必需）

1. 到 [platform.deepseek.com](https://platform.deepseek.com/) 创建 API key
2. 编辑 `~/.live2d-voice/.env`，取消注释并填入：

```bash
LIVE2D_VOICE_API_KEY=sk-xxxxxxxxxxxxxxxx
```

3. 重新运行 `npx live2d-voice`

> 也可以用环境变量 `LIVE2D_VOICE_API_KEY` 直接传入。

### 放入 Live2D 模型

把模型文件夹（含 `.model3.json`）放进 `~/.live2d-voice/models/`：

```
~/.live2d-voice/models/
└── hiyori/
    ├── hiyori.model3.json
    ├── hiyori.physics3.json
    └── textures/
```

在页面右上角 ⚙ 配置里选择模型即可。模型可从 [Live2D 官方示例](https://www.live2d.com/en/learn/sample/) 下载。

### 语音服务（TTS / ASR）

语音合成与识别的 key 在应用内 ⚙ 配置页设置（Fish Audio TTS / 火山引擎 ASR），详见 [dsh-live2d-voice README](https://github.com/john-walks-slow/dsh-live2d-voice#readme)。不配置也能用文字聊天。

## 命令行参数

```
npx live2d-voice                 # 默认 http://127.0.0.1:43110
npx live2d-voice --port 8080     # 指定端口
npx live2d-voice --host 0.0.0.0  # 监听所有网卡（局域网访问，注意安全）
npx live2d-voice --home PATH     # 指定数据目录（默认 ~/.live2d-voice）
npx live2d-voice --reinstall     # 强制重装依赖（升级插件时用）
npx live2d-voice --version
npx live2d-voice --help
```

环境变量：`DSH_HOME`（同 `--home`）、`LIVE2D_VOICE_API_KEY`（API key）。

## 数据与升级

- 所有数据在 `~/.live2d-voice`：`.env`（key）、`models/`（模型）、`settings.yaml`（模型服务）、`live2d-voice.json`（插件配置）、会话记录
- 服务默认只监听 `127.0.0.1`（本机访问）；URL 里附带的 token 供后续版本鉴权使用，别把链接分享出去
- 升级插件：`npx live2d-voice --reinstall`
- 完全重置：停止后删除 `~/.live2d-voice` 再运行

## 常见问题

**浏览器没自动打开** — 复制终端里打印的 `http://localhost:<port>/live2d-voice?token=…` 手动打开。

**端口被占用** — 默认端口占用时会自动尝试后续端口（43110–43129），也可用 `--port` 指定。

**启动失败** — 终端会打印 dsh 的最近日志；完整日志在数据目录下。

**局域网访问** — `--host 0.0.0.0` 后用 `http://<本机IP>:<端口>/live2d-voice?token=…` 访问；URL 带 token，注意泄露风险。

## License

MIT
