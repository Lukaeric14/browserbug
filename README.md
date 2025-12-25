# Browser Bug Reporter

A lightweight system for capturing browser logs on-demand and making them accessible to Claude Code for debugging.

## Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│ Chrome Extension│──────│  Railway API    │──────│   MCP Server    │
│                 │ POST │  (PostgreSQL)   │ GET  │                 │
│ Captures:       │      │                 │      │ Claude Code     │
│ - Console logs  │      │ Stores:         │      │ queries logs    │
│ - Network errors│      │ - bug_reports   │      │ for debugging   │
│ - Current URL   │      │                 │      │                 │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

## Quick Start

### 1. Deploy Server to Railway

1. Create a new project on [Railway](https://railway.app)
2. Add a PostgreSQL database
3. Deploy the `server/` directory
4. Set environment variables:
   ```
   BUG_REPORTS_API_KEY=<generate-a-secure-key>
   DATABASE_URL=<automatically set by Railway>
   ```

### 2. Install Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension/` directory
5. Click the extension icon, go to Settings
6. Enter your Railway API URL and API Key

### 3. Configure MCP Server for Claude Code

Add to your Claude Code config (`.claude.json` or settings):

```json
{
  "mcpServers": {
    "bug-reports": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/browserbug/mcp-server/index.js"],
      "env": {
        "BUG_REPORTS_API_URL": "https://your-app.up.railway.app",
        "BUG_REPORTS_API_KEY": "your-api-key"
      }
    }
  }
}
```

Install MCP dependencies:
```bash
cd mcp-server && npm install
```

## Usage

### Reporting a Bug

1. Encounter a bug in your browser
2. Click the Browser Bug Reporter extension icon
3. Optionally add a note describing what went wrong
4. Click "Report Bug"

### Debugging with Claude Code

Just tell Claude something like:
- "it didn't work"
- "there's a bug"
- "check the browser logs"

Claude will use the `get_bug_reports` tool to fetch recent errors.

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_bug_reports` | Fetch recent bug reports with console logs and network errors |
| `get_bug_report` | Get a specific bug report by ID |
| `clear_bug_reports` | Delete old bug reports |

## Project Structure

```
browserbug/
├── extension/           # Chrome Extension
│   ├── manifest.json
│   ├── popup.html/js
│   ├── content.js       # Captures console logs
│   ├── background.js
│   └── icons/
├── server/              # Railway API Server
│   ├── index.js
│   ├── routes/
│   │   └── bugReports.js
│   └── db/migrations/
├── mcp-server/          # MCP Server for Claude Code
│   ├── index.js
│   └── api-client.js
└── README.md
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/bug-reports` | Create a bug report |
| GET | `/api/bug-reports` | List bug reports |
| GET | `/api/bug-reports/:id` | Get a specific report |
| DELETE | `/api/bug-reports/:id` | Delete a report |
| DELETE | `/api/bug-reports?olderThanHours=24` | Clear old reports |

All endpoints require `X-API-Key` header.

## Environment Variables

### Server (Railway)
- BUG_REPORTS_API_KEY="d32dii23j8fuhducfi2uehr7f349023jd" - API key for authentication
- `DATABASE_URL` - PostgreSQL connection string (auto-set by Railway)
- `PORT` - Server port (auto-set by Railway)

### MCP Server
- `BUG_REPORTS_API_URL` - Your Railway server URL
- BUG_REPORTS_API_KEY="d32dii23j8fuhducfi2uehr7f349023jd" - Same API key as server

## Development

```bash
# Install dependencies
npm install

# Run server locally
cd server && npm run dev

# Test with local PostgreSQL
DATABASE_URL=postgres://localhost:5432/bugreports npm run dev
```
