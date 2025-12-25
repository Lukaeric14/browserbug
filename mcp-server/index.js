import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { fetchBugReports, fetchBugReport, clearBugReports } from './api-client.js';

const server = new Server(
  {
    name: 'bug-reports',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_bug_reports',
        description: 'Get recent browser bug reports with console logs and network errors. Use this when the user says something like "it didn\'t work" or "there\'s a bug" to see what errors occurred in the browser.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Number of reports to fetch (default: 5)',
              default: 5,
            },
            projectId: {
              type: 'string',
              description: 'Filter by project ID (hostname). If not specified, returns all projects.',
            },
            since: {
              type: 'string',
              description: 'ISO timestamp to filter reports after (e.g., "2025-12-26T00:00:00Z")',
            },
          },
        },
      },
      {
        name: 'get_bug_report',
        description: 'Get a specific bug report by ID, including full details and screenshot if available.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'number',
              description: 'The bug report ID',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'clear_bug_reports',
        description: 'Delete bug reports older than specified hours.',
        inputSchema: {
          type: 'object',
          properties: {
            olderThanHours: {
              type: 'number',
              description: 'Delete reports older than this many hours (default: 24)',
              default: 24,
            },
          },
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_bug_reports': {
        const reports = await fetchBugReports({
          limit: args?.limit || 5,
          projectId: args?.projectId,
          since: args?.since,
        });

        if (reports.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No bug reports found. Make sure the Chrome extension is installed and has been used to report bugs.',
              },
            ],
          };
        }

        const formatted = reports.map((report, index) => {
          let text = `\n--- Bug Report #${report.id} ---\n`;
          text += `URL: ${report.url}\n`;
          text += `Time: ${report.createdAt}\n`;
          text += `Project: ${report.projectId}\n`;

          if (report.userNote) {
            text += `User Note: ${report.userNote}\n`;
          }

          if (report.consoleLogs && report.consoleLogs.length > 0) {
            text += `\nConsole Logs (${report.consoleLogs.length}):\n`;
            report.consoleLogs.forEach((log) => {
              text += `  [${log.level.toUpperCase()}] ${log.message}\n`;
              if (log.stack) {
                text += `    Stack: ${log.stack.split('\n').slice(0, 3).join('\n    ')}\n`;
              }
            });
          }

          if (report.networkErrors && report.networkErrors.length > 0) {
            text += `\nNetwork Errors (${report.networkErrors.length}):\n`;
            report.networkErrors.forEach((err) => {
              text += `  ${err.method} ${err.url} - ${err.status} ${err.statusText || err.error || ''}\n`;
            });
          }

          return text;
        });

        return {
          content: [
            {
              type: 'text',
              text: `Found ${reports.length} bug report(s):\n${formatted.join('\n')}`,
            },
          ],
        };
      }

      case 'get_bug_report': {
        if (!args?.id) {
          return {
            content: [{ type: 'text', text: 'Error: id is required' }],
            isError: true,
          };
        }

        const report = await fetchBugReport(args.id);

        if (!report) {
          return {
            content: [{ type: 'text', text: `Bug report #${args.id} not found` }],
            isError: true,
          };
        }

        let text = `Bug Report #${report.id}\n`;
        text += `URL: ${report.url}\n`;
        text += `Time: ${report.createdAt}\n`;
        text += `Project: ${report.projectId}\n`;

        if (report.userNote) {
          text += `User Note: ${report.userNote}\n`;
        }

        if (report.consoleLogs && report.consoleLogs.length > 0) {
          text += `\nConsole Logs (${report.consoleLogs.length}):\n`;
          report.consoleLogs.forEach((log) => {
            text += `[${log.level.toUpperCase()}] ${log.message}\n`;
            if (log.stack) {
              text += `Stack:\n${log.stack}\n`;
            }
          });
        }

        if (report.networkErrors && report.networkErrors.length > 0) {
          text += `\nNetwork Errors (${report.networkErrors.length}):\n`;
          report.networkErrors.forEach((err) => {
            text += `${err.method} ${err.url}\n`;
            text += `  Status: ${err.status} ${err.statusText || ''}\n`;
            if (err.error) text += `  Error: ${err.error}\n`;
            if (err.duration) text += `  Duration: ${err.duration}ms\n`;
          });
        }

        return {
          content: [{ type: 'text', text }],
        };
      }

      case 'clear_bug_reports': {
        const result = await clearBugReports(args?.olderThanHours || 24);

        return {
          content: [
            {
              type: 'text',
              text: `Deleted ${result.deletedCount} bug report(s) older than ${args?.olderThanHours || 24} hours.`,
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Bug Reports MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
