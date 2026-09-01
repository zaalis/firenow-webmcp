/**
 * FireNow WebMCP bridge.
 *
 * `document.modelContext` exists today only behind experimental flags. Without
 * it the page exposes no tools at all, and any agent - ChatGPT, Claude in
 * Chrome, an MCP extension - sees nothing but a mute map.
 *
 * This file never replaces a native implementation: it detects one and steps
 * aside, building a fallback context only when there is none.
 *
 * It then publishes the tools on four surfaces, because the agents that open
 * this page do not all have the same reach:
 *
 *   1. `document.modelContext` / `navigator.modelContext` - a native client;
 *   2. `window.__WEBMCP__` - an agent evaluating JavaScript in the main world;
 *   3. `postMessage` and DOM events - an extension content script, which runs
 *      in an isolated world and can therefore see neither 1 nor 2;
 *   4. the DOM itself - the manifest below, plus the agent bridge the page
 *      renders, for an agent that can only read the page and type into it.
 *
 * Surfaces 3 and 4 are the reason this file exists in its current shape: an
 * agent that drives a tab through the accessibility tree - which is what
 * ChatGPT does today - reaches none of the JavaScript surfaces at all.
 *
 * Loaded at the top of the document, before React hydrates.
 */
(function () {
  'use strict';

  var VERSION = '1.1.0';
  var MANIFEST_ID = 'webmcp-manifest';

  /* Repeated verbatim on every surface: the manifest, the <meta> tag in the
     document head, and the agent bridge in the page. An agent that reads any
     one of them learns the same rule. */
  var DIRECTIVE = 'FireNow is tool-driven. To act on this page, call its WebMCP '
    + 'tools - do not click, drag or type on the map. Read the situation with '
    + 'get_situation first, open a draft with propose_plan, add the actions with '
    + 'the stage_* tools, then call commit_plan, which asks the human operator '
    + 'for the single approval that applies the whole plan. If your client has '
    + 'no WebMCP support, use the "Agent bridge" panel in the page: pick the '
    + 'tool, type its JSON arguments, submit, and read the result back from the '
    + 'page. Every route runs the same tool implementation.';

  function reportError(error) {
    if (typeof console !== 'undefined' && console.debug) console.debug('[webmcp]', error);
  }

  var nativeContext =
    (document && document.modelContext) ||
    (navigator && navigator.modelContext) ||
    null;

  /* ------------------------------------------------------------------ *
   * Fallback context, shaped like `WebMCP.ModelContext`.
   * ------------------------------------------------------------------ */

  class PolyfilledModelContext extends EventTarget {
    constructor() {
      super();
      this._tools = new Map();
      this.ontoolchange = null;
    }

    _emitToolChange() {
      const event = new Event('toolchange');
      if (typeof this.ontoolchange === 'function') {
        try { this.ontoolchange(event); } catch (error) { reportError(error); }
      }
      this.dispatchEvent(event);
      syncManifest();
      document.dispatchEvent(new CustomEvent('webmcp:toolschanged', {
        detail: { count: this._tools.size, names: Array.from(this._tools.keys()) },
      }));
    }

    registerTool(tool, options) {
      if (!tool || typeof tool.name !== 'string' || !tool.name) {
        return Promise.reject(new TypeError('A WebMCP tool must carry a name.'));
      }
      if (typeof tool.execute !== 'function') {
        return Promise.reject(new TypeError('Tool "' + tool.name + '" has no execute function.'));
      }
      this._tools.set(tool.name, tool);
      const signal = options && options.signal;
      if (signal) {
        if (signal.aborted) {
          this._tools.delete(tool.name);
        } else {
          signal.addEventListener('abort', () => {
            if (this._tools.get(tool.name) === tool) {
              this._tools.delete(tool.name);
              this._emitToolChange();
            }
          }, { once: true });
        }
      }
      this._emitToolChange();
      return Promise.resolve();
    }

    /* Outside the specification, but expected by several existing MCP clients. */
    unregisterTool(name) {
      if (this._tools.delete(name)) this._emitToolChange();
      return Promise.resolve();
    }

    /* Historical explainer shape: replaces the whole list. */
    provideContext(contextInit) {
      this._tools.clear();
      const tools = (contextInit && contextInit.tools) || [];
      for (const tool of tools) {
        if (tool && tool.name && typeof tool.execute === 'function') this._tools.set(tool.name, tool);
      }
      this._emitToolChange();
      return Promise.resolve();
    }

    getTools() {
      return Promise.resolve(Array.from(this._tools.values()).map(describeTool));
    }

    callTool(name, input, options) {
      const tool = this._tools.get(name);
      if (!tool) {
        var known = Array.from(this._tools.keys());
        return Promise.reject(new Error(
          'Unknown WebMCP tool "' + name + '". '
          + (known.length ? 'Available tools: ' + known.join(', ') + '.'
                          : 'No tool is registered on this page yet: sign in and open the console first.'),
        ));
      }
      const callOptions = {
        signal: (options && options.signal) || new AbortController().signal,
        /* `commit_plan` uses this to suspend the agent during human review. */
        requestUserInteraction: (handler) => Promise.resolve(handler()),
      };
      return Promise.resolve().then(() => tool.execute(input || {}, callOptions));
    }
  }

  function describeTool(tool) {
    return {
      name: tool.name,
      title: tool.title || tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      origin: location.origin,
    };
  }

  var context = nativeContext;
  var mode = 'native';

  if (!context || typeof context.registerTool !== 'function') {
    context = new PolyfilledModelContext();
    mode = 'polyfill';
    var descriptor = { configurable: true, enumerable: false, get: function () { return context; } };
    try { Object.defineProperty(Document.prototype, 'modelContext', descriptor); } catch (error) { reportError(error); }
    try { Object.defineProperty(Navigator.prototype, 'modelContext', descriptor); } catch (error) { reportError(error); }
    /* If defining on the prototype failed, fall back to the instance. */
    if (!document.modelContext) {
      try { Object.defineProperty(document, 'modelContext', descriptor); } catch (error) { reportError(error); }
    }
    if (!navigator.modelContext) {
      try { Object.defineProperty(navigator, 'modelContext', descriptor); } catch (error) { reportError(error); }
    }
  }

  /* ------------------------------------------------------------------ *
   * A manifest readable from the DOM, for agents that read the page.
   * ------------------------------------------------------------------ */

  function listToolsSync() {
    if (context._tools instanceof Map) return Array.from(context._tools.values()).map(describeTool);
    return [];
  }

  function writeManifest(tools) {
    var node = document.getElementById(MANIFEST_ID);
    if (!node) {
      if (!document.head) return;
      node = document.createElement('script');
      node.type = 'application/json';
      node.id = MANIFEST_ID;
      document.head.appendChild(node);
    }
    node.textContent = JSON.stringify({
      webmcp: VERSION,
      mode: mode,
      origin: location.origin,
      instructions: DIRECTIVE,
      /* Named here so an agent that only reads the DOM knows where to type. */
      fallbackTransport: {
        domForm: '#agent-bridge',
        urlTemplate: location.origin + '/?tool=TOOL_NAME&args=URL_ENCODED_JSON',
      },
      tools: tools,
    });
    /* The attributes stay on the manifest: writing on <html> would break React
       hydration, which owns that element. */
    node.setAttribute('data-webmcp', mode);
    node.setAttribute('data-webmcp-tools', String(tools.length));
  }

  function syncManifest() {
    writeManifest(listToolsSync());
  }

  /* ------------------------------------------------------------------ *
   * Single entry point for an agent running JavaScript in the tab.
   * ------------------------------------------------------------------ */

  function listTools() {
    if (mode === 'polyfill') return listToolsSync();
    var manifest = document.getElementById(MANIFEST_ID);
    if (manifest) {
      try { return JSON.parse(manifest.textContent).tools; } catch (error) { reportError(error); }
    }
    return [];
  }

  var bridge = {
    version: VERSION,
    mode: mode,
    directive: DIRECTIVE,
    get context() { return context; },
    isAvailable: function () { return listTools().length > 0; },
    listTools: listTools,
    callTool: function (name, input) {
      if (typeof context.callTool === 'function') return context.callTool(name, input);
      return Promise.reject(new Error('The native context exposes no direct call from the page.'));
    },
    onToolsChanged: function (listener) {
      var handler = function () { listener(listTools()); };
      document.addEventListener('webmcp:toolschanged', handler);
      if (context.addEventListener) context.addEventListener('toolchange', handler);
      return function () {
        document.removeEventListener('webmcp:toolschanged', handler);
        if (context.removeEventListener) context.removeEventListener('toolchange', handler);
      };
    },
  };

  Object.defineProperty(window, '__WEBMCP__', { value: bridge, writable: false, configurable: true });

  /* A native context does not keep the manifest current, so hook it up. */
  if (mode === 'native' && typeof context.addEventListener === 'function') {
    context.addEventListener('toolchange', function () {
      if (typeof context.getTools !== 'function') return;
      context.getTools().then(writeManifest, reportError);
    });
  }

  /* ------------------------------------------------------------------ *
   * Channels for a content script.
   *
   * A Chrome extension content script runs in an isolated world: it shares the
   * DOM with the page but not a single JavaScript object, so neither
   * `document.modelContext` nor `window.__WEBMCP__` is reachable from it. Both
   * channels below cross that boundary, and both stay same-origin, so a
   * third-party frame cannot drive the map.
   *
   * Neither channel widens what an agent may do: read and staging tools change
   * nothing that is committed, and `commit_plan` still opens the review and
   * waits for a human click.
   * ------------------------------------------------------------------ */

  function dispatchResult(id, payload) {
    document.dispatchEvent(new CustomEvent('webmcp:result', {
      detail: Object.assign({ id: id }, payload),
    }));
  }

  document.addEventListener('webmcp:call', function (event) {
    var data = (event && event.detail) || {};
    if (data.type === 'list-tools' || !data.name) {
      dispatchResult(data.id, { type: 'tools', tools: listTools(), mode: mode, instructions: DIRECTIVE });
      return;
    }
    bridge.callTool(data.name, data.input).then(
      function (result) { dispatchResult(data.id, { type: 'result', result: result }); },
      function (error) { dispatchResult(data.id, { type: 'error', error: String((error && error.message) || error) }); },
    );
  });

  window.addEventListener('message', function (event) {
    if (event.source !== window || event.origin !== location.origin) return;
    var data = event.data;
    if (!data || data.channel !== 'webmcp' || typeof data.type !== 'string') return;

    var reply = function (payload) {
      window.postMessage(Object.assign({ channel: 'webmcp', id: data.id }, payload), location.origin);
    };

    if (data.type === 'list-tools') {
      reply({ type: 'tools', tools: listTools(), mode: mode, instructions: DIRECTIVE });
      return;
    }
    if (data.type === 'call-tool') {
      bridge.callTool(data.name, data.input).then(
        function (result) { reply({ type: 'result', result: result }); },
        function (error) { reply({ type: 'error', error: String((error && error.message) || error) }); },
      );
    }
  });

  syncManifest();
  if (!document.head) {
    document.addEventListener('DOMContentLoaded', syncManifest, { once: true });
  }
  window.dispatchEvent(new CustomEvent('webmcp:ready', { detail: { mode: mode, version: VERSION } }));
}());
