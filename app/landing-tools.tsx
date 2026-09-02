'use client';

/**
 * Public tools for the front door.
 *
 * The console registers its 21 tools only once a session exists, so an agent
 * that opened the site and was not signed in used to find `document.
 * modelContext` present and completely empty - the state that reads, from the
 * agent's side, as "this page announces tools it does not expose". These two
 * read-only tools make the front door answer for itself: what the application
 * is, which tools appear after sign-in, and why they are not here yet.
 */

import { useEffect } from 'react';
import { AGENT_DIRECTIVE } from './agent-bridge';
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
      const context = (document as Document & { modelContext?: ModelContextLike }).modelContext
        || (navigator as Navigator & { modelContext?: ModelContextLike }).modelContext;
      if (!context || typeof context.registerTool !== 'function' || stopped) return false;
      const tools: ToolDefinition[] = [
        {
          name: 'get_capabilities',
          title: 'Describe this application',
          description: 'Returns what FireNow is, the directive agents should follow on it, and the tools that become available once a human has signed in.',
          inputSchema: emptySchema,
          annotations: { readOnlyHint: true },
          execute: () => ({
            application: 'FireNow',
            purpose: 'Agent-native wildfire decision-support and training simulator.',
            directive: AGENT_DIRECTIVE,
            signedIn: false,
            consoleTools: CONSOLE_TOOL_NAMES,
            consoleToolCount: CONSOLE_TOOL_NAMES.length,
            howToUnlock: 'The console tools register on document.modelContext once a human operator has signed in on this page. Ask the operator to sign in; never enter credentials on their behalf.',
            fallbackTransport: 'When the console is open, the "Agent bridge" panel (#agent-bridge) runs the same tools from the DOM, for clients without WebMCP support.',
            calibration: 'not_performed',
          }),
        },
        {
          name: 'open_console',
          title: 'Point to the console entrance',
          description: 'Scrolls the page to the access section and reports what is needed to open the console. It cannot sign anyone in.',
          inputSchema: emptySchema,
          annotations: { readOnlyHint: true },
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
    /* /webmcp.js runs before hydration, but a slow script blocker or a native
       implementation arriving late would otherwise leave the door mute. */
    const detector = window.setInterval(() => { if (register()) window.clearInterval(detector); }, 250);
    return () => {
      stopped = true;
      window.clearInterval(detector);
      teardown.abort();
    };
  }, []);

  return null;
}
