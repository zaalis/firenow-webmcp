/**
 * Pont WebMCP de FireOps.
 *
 * L'API `document.modelContext` n'existe aujourd'hui que dans les canaux
 * experimentaux. Sans elle, la page n'expose aucun outil et tout agent —
 * ChatGPT, Claude in Chrome, une extension MCP — ne voit qu'une carte muette.
 *
 * Ce fichier ne remplace jamais une implementation native : il la detecte, s'y
 * range, et ne construit un contexte de repli que lorsqu'il n'y en a aucune.
 * Dans les deux cas il publie une entree unique, `window.__WEBMCP__`, qui
 * permet a un agent capable d'executer du JavaScript dans l'onglet de lister
 * les outils de la page et de les appeler.
 *
 * Charge en tete de document, avant l'hydratation React.
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
   * Contexte de repli conforme a la forme de `WebMCP.ModelContext`.
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
        return Promise.reject(new TypeError('L’outil « ' + tool.name + ' » n’a pas de fonction execute.'));
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

    /* Hors specification, mais attendu par plusieurs clients MCP existants. */
    unregisterTool(name) {
      if (this._tools.delete(name)) this._emitToolChange();
      return Promise.resolve();
    }

    /* Forme historique de l'explainer : remplace la liste complete. */
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
        /* `commit_plan` s'en sert pour suspendre l'agent pendant la revue humaine. */
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
    /* Si la definition sur le prototype a echoue, on retombe sur l'instance. */
    if (!document.modelContext) {
      try { Object.defineProperty(document, 'modelContext', descriptor); } catch (error) { reportError(error); }
    }
    if (!navigator.modelContext) {
      try { Object.defineProperty(navigator, 'modelContext', descriptor); } catch (error) { reportError(error); }
    }
  }

  /* ------------------------------------------------------------------ *
   * Manifeste lisible dans le DOM, pour les agents qui lisent la page.
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
    /* Les attributs restent sur le manifeste : ecrire sur <html> ferait echouer
       l'hydratation React, qui possede cet element. */
    node.setAttribute('data-webmcp', mode);
    node.setAttribute('data-webmcp-tools', String(tools.length));
  }

  function syncManifest() {
    writeManifest(listToolsSync());
  }

  /* ------------------------------------------------------------------ *
   * Entree unique pour un agent qui execute du JavaScript dans l'onglet.
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

  /* Un contexte natif ne tient pas le manifeste a jour : on l'y raccroche. */
  if (mode === 'native' && typeof context.addEventListener === 'function') {
    context.addEventListener('toolchange', function () {
      if (typeof context.getTools !== 'function') return;
      context.getTools().then(writeManifest, reportError);
    });
  }

  /* ------------------------------------------------------------------ *
   * Canal postMessage, pour un content script d'extension.
   * Meme origine uniquement : un cadre tiers ne peut pas piloter la carte.
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
