'use client';

/**
 * The agent bridge.
 *
 * `document.modelContext` and `window.__WEBMCP__` are JavaScript objects living
 * in the page's main world. An agent that drives a tab through screenshots and
 * the accessibility tree - which is what ChatGPT does today - never evaluates
 * JavaScript there, and an extension content script runs in an isolated world
 * where those objects do not exist at all. Such an agent reads "21 WebMCP tools
 * live" in the header, finds no way to call any of them, and correctly reports
 * that the tools are not exposed to its session.
 *
 * This panel is the missing transport. It puts the directive, the tool
 * catalogue, an invocation form and the result into the DOM, where every agent
 * can read and type. It calls the same `callTool` the JavaScript surfaces use,
 * so a call made here is a real WebMCP call: same validation, same journal,
 * same human approval on `commit_plan`.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FormEvent } from 'react';
import { Bot, ChevronDown, Play } from 'lucide-react';

export const AGENT_DIRECTIVE =
  'FireNow is tool-driven. To act on this page, call its WebMCP tools - do not '
  + 'click, drag or type on the map. Read the situation with get_situation first, '
  + 'open a draft with propose_plan, add the actions with the stage_* tools, then '
  + 'call commit_plan, which asks the human operator for the single approval that '
  + 'applies the whole plan.';

export type InitialToolCall = { name: string; args: string };

type ToolDescriptor = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: { properties?: Record<string, { type?: string; enum?: unknown[] }>; required?: string[] };
};

type BridgeWindow = Window & {
  __WEBMCP__?: {
    mode: 'native' | 'polyfill';
    listTools: () => ToolDescriptor[];
    callTool: (name: string, input: unknown) => Promise<unknown>;
    onToolsChanged: (listener: (tools: ToolDescriptor[]) => void) => () => void;
  };
};

/* Committing resources is never one navigation away: a link from anywhere on
   the web could otherwise open the review dialog behind the operator's back. */
const URL_CALL_DENYLIST = new Set(['commit_plan']);

/* ------------------------------------------------------------------------ *
 * The registry read as an external store.
 *
 * Tools appear a beat after hydration, and can be retired at sign-out, so the
 * panel subscribes rather than snapshotting once. `useSyncExternalStore` needs
 * a snapshot that keeps its identity while nothing changes, hence the cache.
 * ------------------------------------------------------------------------ */

const NO_TOOLS: ToolDescriptor[] = [];
let cachedTools: ToolDescriptor[] = NO_TOOLS;
let cachedNames = '';

const readTools = (): ToolDescriptor[] => {
  const bridge = (window as BridgeWindow).__WEBMCP__;
  const next = bridge ? bridge.listTools() : NO_TOOLS;
  const names = next.map((tool) => tool.name).join(',');
  if (names !== cachedNames) {
    cachedNames = names;
    cachedTools = next;
  }
  return cachedTools;
};

const serverTools = () => NO_TOOLS;

const subscribeToTools = (onChange: () => void) => {
  const bridge = (window as BridgeWindow).__WEBMCP__;
  if (bridge) return bridge.onToolsChanged(onChange);
  document.addEventListener('webmcp:toolschanged', onChange);
  return () => document.removeEventListener('webmcp:toolschanged', onChange);
};

const signature = (tool: ToolDescriptor) => {
  const properties = tool.inputSchema?.properties;
  if (!properties) return '{}';
  const required = new Set(tool.inputSchema?.required || []);
  const fields = Object.entries(properties).map(([field, spec]) => {
    const type = spec && typeof spec === 'object' && typeof spec.type === 'string' ? spec.type : 'any';
    return `${field}${required.has(field) ? '' : '?'}: ${type}`;
  });
  return `{ ${fields.join(', ')} }`;
};

/* A starting point the agent can edit rather than infer from the schema. */
const templateFor = (tool: ToolDescriptor | undefined) => {
  const properties = tool?.inputSchema?.properties;
  const required = tool?.inputSchema?.required || [];
  if (!properties || required.length === 0) return '{}';
  const body = required.map((field) => {
    const spec = properties[field];
    const type = spec && typeof spec === 'object' ? spec.type : undefined;
    if (Array.isArray(spec?.enum) && spec.enum.length > 0) return `"${field}": ${JSON.stringify(spec.enum[0])}`;
    if (type === 'number' || type === 'integer') return `"${field}": 0`;
    if (type === 'boolean') return `"${field}": true`;
    if (type === 'array') return `"${field}": []`;
    if (type === 'object') return `"${field}": {}`;
    return `"${field}": ""`;
  });
  return `{ ${body.join(', ')} }`;
};

const report = (tool: string, error: string) => JSON.stringify({ ok: false, tool, error }, null, 2);

export default function AgentBridge({ initialCall = null }: { initialCall?: InitialToolCall | null }) {
  const tools = useSyncExternalStore(subscribeToTools, readTools, serverTools);
  /* The URL call is resolved on the server, so the panel opens already showing
     the call it is about to run: no hydration mismatch, and no flash. */
  const [open, setOpen] = useState(initialCall !== null);
  const [selected, setSelected] = useState(initialCall?.name || 'get_situation');
  const [argumentsText, setArgumentsText] = useState(initialCall?.args || '{}');
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const initialCallDone = useRef(false);

  const call = useCallback(async (name: string, input: unknown) => {
    const bridge = (window as BridgeWindow).__WEBMCP__;
    if (!bridge) {
      setResult(report(name, 'No model context in this tab. Reload the page; if it persists, a script blocker is stopping /webmcp.js.'));
      return;
    }
    setRunning(true);
    try {
      const value = await bridge.callTool(name, input);
      setResult(JSON.stringify({ ok: true, tool: name, result: value }, null, 2));
    } catch (error) {
      setResult(report(name, error instanceof Error ? error.message : String(error)));
    } finally {
      setRunning(false);
    }
  }, []);

  /* Invocation by navigation, for an agent whose only verb is "open this URL".
     Waits for the tools to register, then scrubs the query string so a reload
     does not replay the call. */
  useEffect(() => {
    if (!initialCall || initialCallDone.current || tools.length === 0) return;
    initialCallDone.current = true;
    window.history.replaceState(null, '', window.location.pathname);
    const runInitialCall = async () => {
      if (URL_CALL_DENYLIST.has(initialCall.name)) {
        setResult(report(initialCall.name, 'commit_plan cannot be called from a URL. Use the form below, so the operator sees the review open in front of them.'));
        return;
      }
      let input: unknown;
      try {
        input = JSON.parse(initialCall.args || '{}');
      } catch {
        setResult(report(initialCall.name, 'The "args" query parameter is not valid JSON.'));
        return;
      }
      await call(initialCall.name, input);
    };
    void runInitialCall();
  }, [call, initialCall, tools.length]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    let input: unknown;
    try {
      input = JSON.parse(argumentsText.trim() || '{}');
    } catch {
      setResult(report(selected, 'Arguments must be a JSON object, for example {"name": "West flank", "intention": "Hold the DFCI track"}.'));
      return;
    }
    void call(selected, input);
  };

  const selectTool = (name: string) => {
    setSelected(name);
    setArgumentsText(templateFor(tools.find((tool) => tool.name === name)));
  };

  return (
    <section id="agent-bridge" className={'agent-bridge glass-panel' + (open ? ' open' : '')} aria-label="Agent bridge: call the WebMCP tools of this page">
      {/* The label is explicit rather than computed from the contents: an agent
          reading the accessibility tree gets the instruction and the way to act
          on it in the button's own name, and no `title` shadows the tool list
          underneath it. */}
      <button className="bridge-bar" type="button" aria-expanded={open} aria-controls="agent-bridge-body"
        aria-label={`Agent bridge. Call the ${tools.length} WebMCP tools of this page instead of driving the map with the mouse. Opens the tool catalogue and the call form.`}
        onClick={() => setOpen((value) => !value)}>
        <span className="bridge-icon" aria-hidden="true"><Bot size={14} /></span>
        <span className="bridge-headline">
          <small>AGENT DIRECTIVE</small>
          <strong>Call the WebMCP tools of this page. Do not drive the map with the mouse.</strong>
        </span>
        <span className="bridge-tools">{tools.length} tools · {tools.map((tool) => tool.name).join(' · ')}</span>
        <span className="bridge-caret" aria-hidden="true"><ChevronDown size={13} /></span>
      </button>

      {open && <div className="bridge-body" id="agent-bridge-body">
        <p className="bridge-directive">{AGENT_DIRECTIVE}</p>
        <p className="bridge-directive faint">
          If your client speaks WebMCP, the tools are on <code>document.modelContext</code>. If it does not, this form is the
          supported route: it runs the same implementation, and the result comes back below as JSON. A call can also be made by
          navigating to <code>/?tool=NAME&amp;args=URL_ENCODED_JSON</code>.
        </p>

        <form className="bridge-form" onSubmit={submit}>
          <label className="bridge-field">
            <span>TOOL</span>
            <select id="agent-bridge-tool" value={selected} onChange={(event) => selectTool(event.target.value)}>
              {tools.map((tool) => <option key={tool.name} value={tool.name}>{tool.name}</option>)}
            </select>
          </label>
          <label className="bridge-field wide">
            <span>ARGUMENTS · JSON</span>
            <textarea id="agent-bridge-arguments" rows={2} spellCheck={false} value={argumentsText}
              onChange={(event) => setArgumentsText(event.target.value)}
              placeholder='{"name": "West flank", "intention": "Hold the DFCI track"}' />
          </label>
          <button className="primary-button bridge-run" type="submit" disabled={running || tools.length === 0}>
            <Play size={13} />{running ? 'Running…' : 'Run tool'}
          </button>
        </form>

        <div className="bridge-result">
          <span>RESULT</span>
          <pre id="agent-bridge-result" tabIndex={0} aria-live="polite">{result || 'No call yet. Pick a tool, type its JSON arguments, then run it.'}</pre>
        </div>

        <details className="bridge-catalogue">
          <summary><span>Tool catalogue</span><b>{tools.length}</b><ChevronDown size={13} /></summary>
          <ul>
            {tools.map((tool) => (
              <li key={tool.name}>
                <code>{tool.name}</code>
                <span className="bridge-signature">{signature(tool)}</span>
                <p>{tool.description}</p>
              </li>
            ))}
          </ul>
        </details>
      </div>}
    </section>
  );
}
