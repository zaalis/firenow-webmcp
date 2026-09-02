'use client';

/**
 * Public tools for the front door.
 *
 * The console registers its 21 tools only once a session exists, so an agent
 * that opens the site before sign-in can still discover what the application
 * offers and why the operational tools are not available yet.
 */

import { useEffect } from 'react';
import { CONSOLE_TOOL_NAMES } from './tool-names';

type ToolDefinition = {
  name: string; title: string; description: string; inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: Record<string, unknown>) => unknown;
};
type ModelContextLike = {
  registerTool: (tool: ToolDefinition, options?: { signal?: AbortSignal }) => Promise<void> | void;
};

const emptySchema = { type: 'object', properties: {}, required: [], additionalProperties: false };

export default function LandingTools() {
  useEffect(() => {
    let stopped = false;
    const teardown = new AbortController();

    const register = () => {
      const context = document.modelContext as ModelContextLike | undefined;
      if (!context || typeof context.registerTool !== 'function' || stopped) return false;
      const tools: ToolDefinition[] = [
        {
          name: 'get_capabilities',
          title: 'Describe this application',
          description: 'Returns what FireNow is and which operational tools become available after a human signs in.',
          inputSchema: emptySchema,
          annotations: { readOnlyHint: true },
          execute: () => ({
            application: 'FireNow',
            purpose: 'Agent-native wildfire decision-support and training simulator.',
            signedIn: false,
            consoleTools: CONSOLE_TOOL_NAMES,
            consoleToolCount: CONSOLE_TOOL_NAMES.length,
            howToUnlock: 'The console tools register on document.modelContext once a human operator has signed in on this page. Ask the operator to sign in; never enter credentials on their behalf.',
            calibration: 'not_performed',
          }),
        },
        {
          name: 'open_console',
          title: 'Point to the console entrance',
          description: 'Scrolls the page to the access section and reports what is needed to open the console. It cannot sign anyone in.',
          inputSchema: emptySchema,
          annotations: { readOnlyHint: false },
          execute: () => {
            document.getElementById('access')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return {
              scrolledTo: '#access',
              signedIn: false,
              nextStep: 'A human operator signs in or creates an account. The agent must not enter credentials.',
              afterSignIn: `${CONSOLE_TOOL_NAMES.length} console tools register on document.modelContext.`,
            };
          },
        },
      ];
      for (const tool of tools) {
        try { void context.registerTool(tool, { signal: teardown.signal }); } catch { /* the console keeps working without them */ }
      }
      return true;
    };

    if (register()) return () => { stopped = true; teardown.abort(); };
    // The browser may expose its native site-tools API shortly after hydration.
    const detector = window.setInterval(() => { if (register()) window.clearInterval(detector); }, 250);
    const giveUp = window.setTimeout(() => window.clearInterval(detector), 5000);
    return () => {
      stopped = true;
      window.clearInterval(detector);
      window.clearTimeout(giveUp);
      teardown.abort();
    };
  }, []);

  return null;
}
