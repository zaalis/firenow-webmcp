import {
  ArrowRight, Bot, Check, Eye, ExternalLink, Layers3, Radar,
  ShieldCheck, TriangleAlert, Wind,
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
    title: 'Propose',
    tools: '7 staging tools',
    text: 'It can open an operational batch, then build it with units, tasks, control lines, tactical burns and evacuation zones. The live exercise changes only when the agent calls commit_plan.',
    examples: ['deploy_units', 'propose_plan', 'stage_deploy_units', 'stage_firebreak'],
  },
  {
    number: '03',
    icon: ShieldCheck,
    title: 'Commit',
    tools: '1 automatic action',
    text: 'commit_plan automatically applies the prepared batch. Every applied action stays reversible.',
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

const EVOLUTION = [
  { title: 'Training, not prediction', text: 'The model is useful for comparing options and understanding fire behaviour. It is not calibrated to certify a real incident outcome.' },
  { title: 'Coverage is still uneven', text: 'Terrain, road and exposure detail is strongest in the areas currently represented by the project. Other exercise areas use a lighter landscape model.' },
  { title: 'One shared operational picture', text: 'The next step is a clearer handover between roles: field observations, planning assumptions and command decisions should stay attached to the same incident view.' },
  { title: 'Coordination that stays accountable', text: 'Future collaboration can add team notes, role-based reviews and a traceable decision history while keeping the incident commander in control.' },
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
          <a href="#webmcp">How it works</a>
          <a href="#engine">The engine</a>
          <a href="#validation">Limits &amp; next steps</a>
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
              <a className="landing-secondary" href="#webmcp">See how it works</a>
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
              <p className="landing-eyebrow"><Layers3 size={13} aria-hidden="true" />HOW IT WORKS</p>
              <h2>One workspace for the team and the plan</h2>
              <p className="section-lede">
                FireNow brings the incident picture, a local simulation and proposed actions into one
                working space. An agent can help read the situation and prepare a plan; the operator
                reviews every decision that changes the exercise.
              </p>
              <ul className="checklist">
                <li><Check size={14} aria-hidden="true" />Read weather, terrain, resources and projected fire behaviour before planning</li>
                <li><Check size={14} aria-hidden="true" />Build and compare draft actions without interrupting the live exercise</li>
                <li><Check size={14} aria-hidden="true" />Keep field judgement, local procedure and the final decision with the operator</li>
                <li><Check size={14} aria-hidden="true" />Record the plan and the actions taken so the exercise can be reviewed afterwards</li>
              </ul>
            </div>
            <aside className="workflow-card glass-panel" data-reveal aria-label="Operational workflow">
              <p>OPERATIONAL FLOW</p>
              <ol>
                <li><b>1</b><span>Establish the current situation.</span></li>
                <li><b>2</b><span>Prepare a proportionate response.</span></li>
                <li><b>3</b><span>Review the whole plan together.</span></li>
                <li><b>4</b><span>Apply only what the operator approves.</span></li>
              </ol>
            </aside>
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
            <p className="landing-eyebrow"><TriangleAlert size={13} aria-hidden="true" />CURRENT LIMITS &amp; NEXT STEPS</p>
            <h2>Useful for training today, designed to improve with the team</h2>
            <p className="section-lede">
              FireNow is deliberately clear about what it can and cannot represent. It supports a
              structured exercise and informed discussion; it does not replace operational intelligence,
              local command procedures or professional judgement.
            </p>
          </header>
          <div className="gaps" data-reveal>
            {EVOLUTION.map((item) => (
              <article key={item.title} className="gap-card glass-panel evolution-card">
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
          <p className="validation-note" data-reveal>
            The practical direction is collaboration, not automation for its own sake: richer field
            observations, clearer shift handovers and shared plan reviews can make an exercise more
            useful without making unsupported claims about real-world prediction.
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
