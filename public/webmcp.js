/**
 * FireNow WebMCP bridge.
 *
 * `document.modelContext` exists today only behind experimental flags. Without
 * it the page exposes no tools at all, and any agent - ChatGPT, Claude in
 * Chrome, an MCP extension - sees nothing but a mute map.
 *
 * This file never replaces a native implementation: it detects one and steps
 * aside, building a fallback context only when there is none. Either way it
 * publishes a single entry point, `window.__WEBMCP__`, so an agent able to run
 * JavaScript in the tab can list the page's tools and call them.
 *
 * Loaded at the top of the document, before React hydrates.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var MANIFEST_ID = 'webmcp-manifest';

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
        return Promise.reject(new TypeError('Un outil WebMCP doit porter un nom.'));
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
      if (!tool) return Promise.reject(new Error('Outil WebMCP inconnu : ' + name));
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
    node.textContent = JSON.stringify({ webmcp: VERSION, mode: mode, origin: location.origin, tools: tools });
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
    get context() { return context; },
    isAvailable: function () { return listTools().length > 0; },
    listTools: listTools,
    callTool: function (name, input) {
      if (typeof context.callTool === 'function') return context.callTool(name, input);
      return Promise.reject(new Error('Le contexte natif n’expose pas d’appel direct depuis la page.'));
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
   * postMessage channel, for an extension content script.
   * Same origin only: a third-party frame cannot drive the map.
   * ------------------------------------------------------------------ */

  window.addEventListener('message', function (event) {
    if (event.source !== window || event.origin !== location.origin) return;
    var data = event.data;
    if (!data || data.channel !== 'webmcp' || typeof data.type !== 'string') return;

    var reply = function (payload) {
      window.postMessage(Object.assign({ channel: 'webmcp', id: data.id }, payload), location.origin);
    };

    if (data.type === 'list-tools') {
      reply({ type: 'tools', tools: listTools(), mode: mode });
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
