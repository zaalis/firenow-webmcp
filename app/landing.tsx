import {
  ArrowRight, Bot, Check, Eye, ExternalLink, Layers3, Radar,
  ShieldCheck, Terminal, TriangleAlert, Wind,
} from 'lucide-react';
import LandingMotion from './landing-motion';
import LandingTools from './landing-tools';
import LoginClient from './login-client';

const BrandMark = () => (
  <span className="brand-mark">
    <img src="/brand/mark.png" width={1024} height={1024} alt="" aria-hidden="true" />
  </span>
);

const FIGURES = [
  { value: '21', label: 'WebMCP tools' },
  { value: '35', label: 'real species' },
  { value: '13', label: 'unit types' },
  { value: '5', label: 'scenarios' },
];

const STEPS = [
  {
    number: '01',
    icon: Eye,
    title: 'Read',
    tools: '6 read-only tools',
    text: 'The agent reads the situation, the weather, the terrain, the fleet and the scenarios. These tools carry the readOnlyHint annotation: they change nothing.',
    examples: ['get_situation', 'get_weather', 'query_terrain', 'get_fire_forecast'],
  },
  {
    number: '02',
    icon: Layers3,
    title: 'Draft',
    tools: '6 staging tools',
    text: 'It builds a complete plan in a ghost layer: staged units, tasks, control lines, tactical burns, evacuation zones. Nothing is committed, and nothing interrupts the officer.',
    examples: ['propose_plan', 'stage_deploy_units', 'stage_firebreak', 'stage_evacuation_zone'],
  },
  {
    number: '03',
    icon: ShieldCheck,
    title: 'Commit',
    tools: '1 stopping point',
    text: 'commit_plan is the only call that suspends the agent. The review opens, the officer sees the whole plan and decides once. An applied plan stays reversible.',
    examples: ['commit_plan', 'revert_plan'],
  },
];

const ENGINE = [
  { title: 'Rothermel 1972, two classes', text: 'Dead and live fuel, with separate moisture damping and heat sinks. No per-species tuning coefficient.' },
  { title: '15 standard fuel models', text: 'Anderson 1982 and Scott & Burgan 2005, from grass mat to conifer litter.' },
  { title: 'Landscape anchored to coordinates', text: 'A place keeps its vegetation whatever the framing. No historical fire is scripted.' },
  { title: 'Byram fireline intensity', text: 'Operational thresholds at 2,000 and 4,000 kW/m, with the front split into head, flanks and rear.' },
  { title: 'Human landscape of the Landes', text: 'DFCI track grid, roads, buildings and clearing rules. A break delays the front; it is never an absolute barrier.' },
  { title: 'Suppression sized from real units', text: '13 unit types with manufacturer tank, pump rate and refill time. Sustainable duty bounds the flow actually held.' },
];

const GAPS = [
  { measure: 'Saumos 2026', value: '− 92 %', detail: 'final area under-predicted', tone: 'deviation' },
  { measure: 'Saumos 2022', value: '+ 158 %', detail: 'final area over-predicted', tone: 'deviation' },
  { measure: 'Perimeter overlap', value: '0.171', detail: 'Jaccard index against Copernicus EMS', tone: 'deviation' },
  { measure: 'Overnight growth', value: '19.4 %', detail: 'of final area, down from 27 % before the fix', tone: 'progress' },
];

const SCENARIOS = [
  { name: 'Landiras I', place: 'Gironde · July 2022', kind: 'Replay', cover: 'Landes de Gascogne · maritime pine' },
  { name: 'Saumos', place: 'Gironde · July 2026', kind: 'Replay', cover: 'Landes de Gascogne · maritime pine' },
  { name: 'Étoile massif', place: 'Provence · mistral', kind: 'Exercise', cover: 'Provence limestone · garrigue' },
  { name: 'Bug Fire', place: 'California · August 2026', kind: 'Replay', cover: 'Cismontane chaparral' },
  { name: 'Blank simulation', place: 'Free starting point', kind: 'Training', cover: 'Set by the framing' },
];

const CREDITS = [
  { title: 'Crowning fire in forest', author: 'Karen Murphy, U.S. Fish and Wildlife Service', href: 'https://commons.wikimedia.org/wiki/File:Crowning_fire_in_forest.jpg' },
  { title: 'MAFFS operations, Boise', author: 'Master Sgt. David Buttner, U.S. Air Force', href: 'https://commons.wikimedia.org/wiki/File:MAFFS_operations_Boise,_Idaho_120807-F-JB467-003.jpg' },
  { title: 'Drip torch on a new fire line', author: 'National Park Service', href: 'https://commons.wikimedia.org/wiki/File:A_wildland_firefighter_uses_a_drip_torch_to_light_a_new_fire_line_through_Munshower_field._(6c137b74-8be5-4908-b9d1-38e0888c2650).jpg' },
  { title: 'Fires and smoke in British Columbia', author: 'Jeff Schmaltz, MODIS Rapid Response, NASA GSFC', href: 'https://commons.wikimedia.org/wiki/File:Fires_and_smoke_in_British_Columbia_(MODIS_2015-07-27).jpg' },
];

const SNIPPET = `document.modelContext.registerTool({
  name: 'stage_deploy_units',
  title: 'Stage units',
  description: 'Places units in the draft plan. Nothing is committed.',
  inputSchema: { /* JSON Schema, validated as untrusted input */ },
  annotations: { readOnlyHint: false },
  execute: (input) => stageUnits(input),
}, { signal: teardown.signal });`;

export default function Landing() {
  return (
    <div className="landing-shell">
      <a className="skip-link" href="#content">Skip to content</a>

      <header className="landing-nav">
        <a className="landing-brand" href="#content">
          <BrandMark />
          <span><strong>FireNow</strong><small>Command console</small></span>
        </a>
        <nav aria-label="Page sections">
          <a href="#flow">The flow</a>
          <a href="#webmcp">WebMCP</a>
          <a href="#engine">The engine</a>
          <a href="#validation">Validation</a>
        </nav>
        <a className="nav-cta" href="#access">Open the console<ArrowRight size={14} aria-hidden="true" /></a>
      </header>

      <div className="nav-sentinel" aria-hidden="true" />

      <main id="content">
        <section className="landing-hero">
          <img
            className="hero-photo"
            src="/media/front-couronne.jpg"
            width={1920}
            height={1441}
            alt="A flame front climbing into the canopy of a conifer forest."
            fetchPriority="high"
          />
          <div className="hero-veil" aria-hidden="true" />
          <div className="hero-copy" data-hero>
            <p className="landing-eyebrow"><Bot size={13} aria-hidden="true" />AGENT-NATIVE SIMULATOR · WEBMCP</p>
            <h1>The agent drafts the plan.<br />The officer commits it.</h1>
            <p className="hero-lede">
              FireNow is a wildfire decision-support and training simulator. The map stays under human
              control. A WebMCP-capable agent reads the situation, builds a complete plan in a ghost
              layer, compares strategies against a local physics engine — and stops at a single human
              approval before anything is committed.
            </p>
            <div className="hero-actions">
              <a className="landing-primary" href="#access">Open the console<ArrowRight size={15} aria-hidden="true" /></a>
              <a className="landing-secondary" href="#webmcp">See the 21 tools</a>
            </div>
            <p className="hero-warning">
              <TriangleAlert size={14} aria-hidden="true" />
              Training beta. It replaces neither the incident commander, nor field data, nor local procedure.
            </p>
          </div>
          <dl className="hero-stats" data-reveal>
            {FIGURES.map((figure) => (
              <div key={figure.label}>
                <dt>{figure.label}</dt>
                <dd data-count={figure.value}>{figure.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="flow" className="landing-section">
          <header className="section-head" data-reveal>
            <p className="landing-eyebrow">WHAT THE AGENT DOES</p>
            <h2>Three separate surfaces, one decision</h2>
            <p className="section-lede">
              The problem with agents that act is the number of confirmations. FireNow solves it by
              separating what reads, what drafts and what commits. An agent can stage fifty vehicles
              without interrupting anyone.
            </p>
          </header>
          <ol className="steps" data-reveal>
            {STEPS.map((step) => {
              const Icon = step.icon;
              return (
                <li key={step.number} className="step-card glass-panel">
                  <div className="step-head">
                    <span className="step-icon"><Icon size={18} aria-hidden="true" /></span>
                    <span className="step-number">{step.number}</span>
                  </div>
                  <h3>{step.title}</h3>
                  <p className="step-tag">{step.tools}</p>
                  <p>{step.text}</p>
                  <ul className="step-tools">
                    {step.examples.map((tool) => <li key={tool}><code>{tool}</code></li>)}
                  </ul>
                </li>
              );
            })}
          </ol>
        </section>

        <section id="webmcp" className="landing-section landing-section-alt">
          <div className="split" data-reveal>
            <div>
              <p className="landing-eyebrow"><Terminal size={13} aria-hidden="true" />THE INTEGRATION</p>
              <h2>The page is the tool server</h2>
              <p className="section-lede">
                FireNow calls no language model. The page registers its 21 domain tools on
                <code> document.modelContext</code>, falling back to <code>navigator.modelContext</code>.
                ChatGPT discovers them natively in its built-in browser; every other browser gets the same
                context from the page&apos;s own bridge. Either way the agent works inside the session already
                open in the tab: no API key, no OAuth, no second backend. The tools disappear when the page
                unmounts, and therefore at sign-out.
              </p>
              <ul className="checklist">
                <li><Check size={14} aria-hidden="true" />Tools designed around intent, not as CRUD wrappers</li>
                <li><Check size={14} aria-hidden="true" />Every parameter validated as untrusted input</li>
                <li><Check size={14} aria-hidden="true" />A log of the calls actually executed, visible in the console</li>
                <li><Check size={14} aria-hidden="true" />Native registration for ChatGPT site tools, plus a bridge for browsers without the API</li>
              </ul>
              <p className="probe">
                <span>CHECK IT FROM ANY BROWSER</span>
                <code>await window.__WEBMCP__.callTool(&apos;get_situation&apos;, {})</code>
              </p>
            </div>
            <figure className="code-card glass-panel" data-reveal>
              <figcaption>app/firenow-client.tsx</figcaption>
              <pre><code>{SNIPPET}</code></pre>
            </figure>
          </div>
        </section>

        <section id="engine" className="landing-section">
          <div className="split split-media" data-reveal>
            <figure className="media-card">
              <img
                src="/media/largage-aerien.jpg"
                width={1920}
                height={1148}
                alt="An air tanker dropping retardant over forested terrain."
                loading="lazy"
              />
              <figcaption>13 unit types, each with manufacturer tank, pump rate and refill time.</figcaption>
            </figure>
            <div>
              <p className="landing-eyebrow"><Radar size={13} aria-hidden="true" />THE ENGINE</p>
              <h2>A 128 × 128 cellular automaton, in a Web Worker</h2>
              <p className="section-lede">
                Priority-queue spread, fifteen-minute sub-steps, a diurnal cycle and a real hourly
                weather series for multi-day runs. The computation never leaves the browser.
              </p>
              <dl className="moteur-list">
                {ENGINE.map((item) => (
                  <div key={item.title}>
                    <dt>{item.title}</dt>
                    <dd>{item.text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        <section id="validation" className="landing-section landing-section-alt">
          <header className="section-head" data-reveal>
            <p className="landing-eyebrow"><TriangleAlert size={13} aria-hidden="true" />WHAT THE MODEL CANNOT DO YET</p>
            <h2>The engine is not calibrated, and the repository says so</h2>
            <p className="section-lede">
              The <code>validate-fires.mjs</code> harness replays reference fires and measures perimeter
              overlap against Copernicus EMS data. It changes no coefficient. These are the deviations
              measured on 28 August 2026, published rather than hidden behind a tuning factor.
            </p>
          </header>
          <div className="gaps" data-reveal>
            {GAPS.map((gap) => (
              <article key={gap.measure} className={'gap-card glass-panel ' + gap.tone}>
                <p className="gap-measure">{gap.measure}</p>
                <p className="gap-value">{gap.value}</p>
                <p className="gap-detail">{gap.detail}</p>
              </article>
            ))}
          </div>
          <p className="validation-note" data-reveal>
            The two runs miss in opposite directions, so <code>ablate-calibration.mjs</code> varies one
            engine term at a time to find out which. The answer is a single rule: a perimeter cell is
            extinguished <em>for good</em> once it holds below 500 kW/m for 45 minutes. Switching that
            off alone brings Saumos 2026 to 43,701 ha against 42,000 observed, and inflates Saumos 2022
            sixteenfold. One fixed threshold, in absolute kW/m, is bounding both fires — too weakly for
            a mild one, far too strongly for a severe one — and it is irreversible, so a front that lies
            down overnight can never run again the next afternoon. The measurement is published; the
            fix is not written yet, and the &ldquo;not calibrated&rdquo; banner stays until it is. Over
            a few hours the model is still useful for comparing options: front intensity, feasible
            attack mode, whether committed flow is sufficient, who is exposed. Over several days it is
            not, and the interface says so.
          </p>
        </section>

        <section id="scenarios" className="landing-section">
          <div className="split split-media reverse" data-reveal>
            <div>
              <p className="landing-eyebrow"><Wind size={13} aria-hidden="true" />THE INPUTS</p>
              <h2>Five scenarios, three ecological regions</h2>
              <p className="section-lede">
                Each scenario keeps its own ignition, weather and units. Switching simulations pauses
                the previous one without losing anything.
              </p>
              <ul className="scenario-cards" data-reveal>
                {SCENARIOS.map((scenario) => (
                  <li key={scenario.name} className="glass-panel">
                    <p className="scenario-nature">{scenario.kind}</p>
                    <h3>{scenario.name}</h3>
                    <p className="scenario-lieu">{scenario.place}</p>
                    <p className="scenario-couvert">{scenario.cover}</p>
                  </li>
                ))}
              </ul>
            </div>
            <figure className="media-card">
              <img
                src="/media/ligne-appui.jpg"
                width={1920}
                height={1272}
                alt="A firefighter opening a control line with a drip torch across a field."
                loading="lazy"
              />
              <figcaption>Control lines built during a run are cumulative and persistent in the engine.</figcaption>
            </figure>
          </div>
        </section>

        <section id="access" className="landing-section landing-access">
          <img
            className="access-photo"
            src="/media/vue-satellite.jpg"
            width={1920}
            height={2444}
            alt="Satellite view of smoke plumes drifting over a forested massif."
            loading="lazy"
          />
          <div className="access-veil" aria-hidden="true" />
          <div className="access-inner" data-reveal>
            <div className="access-copy">
              <p className="landing-eyebrow">OPERATIONAL ACCESS</p>
              <h2>Open the console</h2>
              <p className="section-lede">
                Create an account, open the map, then let a WebMCP-capable agent work in the same tab.
                A new account opens the console on a five-step tour, which you can skip and replay at
                any time from the help menu.
              </p>
              <ul className="checklist">
                <li><Check size={14} aria-hidden="true" />Tactical map in 2D, 3D and globe</li>
                <li><Check size={14} aria-hidden="true" />Adjustable weather, or a real hourly series</li>
                <li><Check size={14} aria-hidden="true" />Three strategies compared by the engine</li>
                <li><Check size={14} aria-hidden="true" />A log of the agent&apos;s calls</li>
              </ul>
            </div>
            <LoginClient />
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="footer-top">
          <div className="landing-brand">
            <BrandMark />
            <span><strong>FireNow</strong><small>Training tool · not an incident command system</small></span>
          </div>
          <a className="footer-link" href="https://github.com/zaalis/firenow-webmcp" target="_blank" rel="noreferrer">
            Source code<ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
        <div className="footer-credits" data-reveal>
          <p className="footer-credits-head">Photographs — public domain</p>
          <ul>
            {CREDITS.map((credit) => (
              <li key={credit.href}>
                <a href={credit.href} target="_blank" rel="noreferrer">{credit.title}</a>
                <span>{credit.author}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="footer-legal">
          Rothermel 1972 model · not calibrated against historical fires · Esri basemap ·
          Open-Meteo weather archive · code under the MIT licence.
        </p>
      </footer>

      <LandingMotion />
      <LandingTools />
    </div>
  );
}
