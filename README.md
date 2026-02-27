# 🔱 Klaw — AI Gateway

Personal AI assistant gateway. Connect your AI to Telegram, WhatsApp, Discord, Slack, and more.

Built by [Ravindra Kumar](https://github.com/kulharir7). Fork of [OpenClaw](https://github.com/openclaw/openclaw).

---

## ⚡ Quick Start

### Prerequisites
- **Node.js** v22+ ([download](https://nodejs.org/))
- **pnpm** (`npm install -g pnpm`)

### Install

```bash
git clone https://github.com/kulharir7/klaw-gateway.git
cd klaw-gateway
pnpm install
```

### Build

```bash
npx tsdown          # Build server
pnpm ui:build       # Build web UI
```

### Run

```bash
# Start the gateway
node openclaw.mjs gateway run --port 19789

# Or if you linked globally (npm link):
klaw gateway run --port 19789
```

Gateway starts at: **http://127.0.0.1:19789**

### First Time Setup

```bash
node openclaw.mjs onboard
```

This will guide you through:
1. Choose AI provider (Anthropic, OpenAI, Google, Ollama, etc.)
2. Enter API key
3. Configure channels (Telegram, WhatsApp, etc.)

---

## 🔧 Configuration

Config file: `~/.klaw/klaw.json`

Set these environment variables to use Klaw's own config (separate from OpenClaw):

```bash
# Linux/macOS
export OPENCLAW_STATE_DIR=~/.klaw
export OPENCLAW_CONFIG_PATH=~/.klaw/klaw.json

# Windows PowerShell
$env:OPENCLAW_STATE_DIR = "$env:USERPROFILE\.klaw"
$env:OPENCLAW_CONFIG_PATH = "$env:USERPROFILE\.klaw\klaw.json"
```

---

## 📋 Commands

```bash
klaw gateway start          # Start gateway (background)
klaw gateway stop           # Stop gateway
klaw gateway status         # Check if running
klaw gateway run --port PORT  # Run in foreground

klaw config get             # View config
klaw config set KEY VALUE   # Set config value

klaw channels list          # List connected channels
klaw models list            # List available AI models

klaw onboard                # Setup wizard
klaw --help                 # All commands
```

> **Note:** If you haven't run `npm link`, use `node openclaw.mjs` instead of `klaw`.

---

## 📱 Channels

Connect your AI assistant to:

| Channel | Setup |
|---------|-------|
| **Telegram** | Create bot via [@BotFather](https://t.me/BotFather), add token to config |
| **WhatsApp** | Scan QR code (`klaw channels whatsapp pair`) |
| **Discord** | Create bot at [Discord Developer Portal](https://discord.com/developers) |
| **Slack** | Create Slack app, add bot token |
| **WebChat** | Built-in — open gateway URL in browser |

---

## 🤖 AI Providers

Supports 30+ providers:

- **Anthropic** (Claude) — recommended
- **OpenAI** (GPT-4, o1)
- **Google** (Gemini)
- **Ollama** (local models)
- **Mistral, Groq, DeepSeek, Cohere**, and more

Set in config:
```json
{
  "auth": {
    "profiles": {
      "anthropic:default": {
        "apiKey": "sk-ant-..."
      }
    }
  }
}
```

---

## 🛠️ Skills

Klaw supports skills — custom agent capabilities:

- **Computer Use** — AI controls your screen (click, type, scroll)
- **Web Agent** — AI browses the web
- **GitHub** — PR reviews, issue management
- **Weather, PDF editing**, and more

Skills live in `~/.klaw/workspace/skills/`.

---

## 🔄 Sync with OpenClaw

Stay up to date with upstream:

```bash
git fetch upstream
git merge upstream/main
npx tsdown
pnpm ui:build
```

---

## 📁 Project Structure

```
klaw-gateway/
├── src/            # TypeScript source (gateway, CLI, agents)
├── dist/           # Compiled output (after npx tsdown)
├── ui/             # Web UI (Vite + Lit)
├── electron/       # Desktop app (WIP)
├── openclaw.mjs    # Entry point
├── package.json
└── ~/.klaw/        # Config & workspace (created on first run)
    ├── klaw.json   # Main config
    ├── .env        # API keys
    └── workspace/  # Agent files, skills, memory
```

---

## 📄 License

MIT — see [LICENSE](LICENSE)

---

**🔱 Klaw** — Your AI, your rules.
