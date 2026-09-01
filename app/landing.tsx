import {
  ArrowRight, Bot, Check, Eye, ExternalLink, Flame, Layers3, Radar,
  ShieldCheck, Terminal, TriangleAlert, Wind,
} from 'lucide-react';
import LoginClient from './login-client';

const CHIFFRES = [
  { valeur: '21', libelle: 'outils WebMCP' },
  { valeur: '35', libelle: 'espèces réelles' },
  { valeur: '13', libelle: 'types d’engins' },
  { valeur: '5', libelle: 'scénarios' },
];

const ETAPES = [
  {
    numero: '01',
    icone: Eye,
    titre: 'Lire',
    outils: '6 outils en lecture seule',
    texte: 'L’agent lit la situation, la météo, le terrain, le parc et les scénarios. Ces outils portent l’annotation readOnlyHint : ils ne modifient rien.',
    exemples: ['get_situation', 'get_weather', 'query_terrain', 'get_fire_forecast'],
  },
  {
    numero: '02',
    icone: Layers3,
    titre: 'Préparer',
    outils: '6 outils provisoires',
    texte: 'Il construit un plan complet dans une couche fantôme : moyens prépositionnés, missions, lignes d’appui, brûlage tactique, zones d’évacuation. Rien n’est engagé, rien n’interrompt l’officier.',
    exemples: ['propose_plan', 'stage_deploy_units', 'stage_firebreak', 'stage_evacuation_zone'],
  },
  {
    numero: '03',
    icone: ShieldCheck,
    titre: 'Engager',
    outils: '1 point d’arrêt',
    texte: 'commit_plan est le seul appel qui suspend l’agent. La revue s’ouvre, l’officier voit le plan entier et tranche une fois. Le plan appliqué reste annulable.',
    exemples: ['commit_plan', 'revert_plan'],
  },
];

const MOTEUR = [
  { titre: 'Rothermel 1972, deux classes', texte: 'Combustible mort et vivant, amortissement d’humidité et puits de chaleur séparés. Aucun coefficient d’ajustement par espèce.' },
  { titre: '15 modèles de combustible', texte: 'Anderson 1982 et Scott & Burgan 2005, du tapis herbacé à la litière résineuse.' },
  { titre: 'Paysage ancré sur les coordonnées', texte: 'Un lieu garde sa végétation quel que soit le cadrage. Aucun feu historique n’est scripté.' },
  { titre: 'Intensité de Byram', texte: 'Seuils opérationnels à 2 000 et 4 000 kW/m, front décomposé en tête, flancs et arrière.' },
  { titre: 'Anthropisation du massif landais', texte: 'Maillage DFCI, routes, bâti, débroussaillement. Une coupure retarde le front ; elle n’est jamais une barrière absolue.' },
  { titre: 'Extinction dimensionnée', texte: '13 types d’engins avec cuve, débit de pompe et temps de remplissage constructeur. L’autonomie borne le débit réellement tenu.' },
];

const ECARTS = [
  { mesure: 'Saumos 2026', valeur: '− 92 %', detail: 'surface finale sous-estimée', ton: 'ecart' },
  { mesure: 'Saumos 2022', valeur: '+ 158 %', detail: 'surface finale surestimée', ton: 'ecart' },
  { mesure: 'Recouvrement de périmètre', valeur: '0,171', detail: 'indice de Jaccard contre Copernicus EMS', ton: 'ecart' },
  { mesure: 'Croissance nocturne', valeur: '19,4 %', detail: 'de la surface finale, contre 27 % avant correction', ton: 'progres' },
];

const SCENARIOS = [
  { nom: 'Landiras I', lieu: 'Gironde · juillet 2022', nature: 'Reconstitution', couvert: 'Landes de Gascogne · pin maritime' },
  { nom: 'Saumos', lieu: 'Gironde · juillet 2026', nature: 'Reconstitution', couvert: 'Landes de Gascogne · pin maritime' },
  { nom: 'Massif de l’Étoile', lieu: 'Provence · mistral', nature: 'Exercice', couvert: 'Provence calcaire · garrigue' },
  { nom: 'Bug Fire', lieu: 'Californie · août 2026', nature: 'Reconstitution', couvert: 'Chaparral cismontain' },
  { nom: 'Simulation vierge', lieu: 'Point de départ libre', nature: 'Entraînement', couvert: 'Défini par le cadrage' },
];

const CREDITS = [
  { titre: 'Crowning fire in forest', auteur: 'Karen Murphy, U.S. Fish and Wildlife Service', lien: 'https://commons.wikimedia.org/wiki/File:Crowning_fire_in_forest.jpg' },
  { titre: 'MAFFS operations, Boise', auteur: 'Master Sgt. David Buttner, U.S. Air Force', lien: 'https://commons.wikimedia.org/wiki/File:MAFFS_operations_Boise,_Idaho_120807-F-JB467-003.jpg' },
  { titre: 'Drip torch on a new fire line', auteur: 'National Park Service', lien: 'https://commons.wikimedia.org/wiki/File:A_wildland_firefighter_uses_a_drip_torch_to_light_a_new_fire_line_through_Munshower_field._(6c137b74-8be5-4908-b9d1-38e0888c2650).jpg' },
  { titre: 'Fires and smoke in British Columbia', auteur: 'Jeff Schmaltz, MODIS Rapid Response, NASA GSFC', lien: 'https://commons.wikimedia.org/wiki/File:Fires_and_smoke_in_British_Columbia_(MODIS_2015-07-27).jpg' },
];

const EXTRAIT = `document.modelContext.registerTool({
  name: 'stage_deploy_units',
  title: 'Prépositionner des moyens',
  description: 'Ajoute des moyens au plan provisoire. Rien n’est engagé.',
  inputSchema: { /* JSON Schema, validé comme entrée non fiable */ },
  annotations: { readOnlyHint: false },
  execute: (input) => stageUnits(input),
}, { signal: teardown.signal });`;

export default function Landing() {
  return (
    <div className="landing-shell">
      <a className="skip-link" href="#contenu">Aller au contenu</a>

      <header className="landing-nav">
        <a className="landing-brand" href="#contenu">
          <span className="brand-mark"><Flame size={17} aria-hidden="true" /></span>
          <span><strong>FireOps</strong><small>Centre de commandement</small></span>
        </a>
        <nav aria-label="Sections de la page">
          <a href="#deroule">Le déroulé</a>
          <a href="#webmcp">WebMCP</a>
          <a href="#moteur">Le moteur</a>
          <a href="#validation">Validation</a>
        </nav>
        <a className="nav-cta" href="#acces">Ouvrir la console<ArrowRight size={14} aria-hidden="true" /></a>
      </header>

      <main id="contenu">
        <section className="landing-hero">
          <img
            className="hero-photo"
            src="/media/front-couronne.jpg"
            width={1920}
            height={1441}
            alt="Front de flammes montant dans la canopée d’une forêt de conifères."
            fetchPriority="high"
          />
          <div className="hero-veil" aria-hidden="true" />
          <div className="hero-copy">
            <p className="landing-eyebrow"><Bot size={13} aria-hidden="true" />SIMULATEUR AGENT-NATIVE · WEBMCP</p>
            <h1>L’agent prépare le plan.<br />L’officier l’engage.</h1>
            <p className="hero-lede">
              FireOps est un simulateur d’aide à la décision et d’entraînement pour les feux de forêt.
              La carte reste pilotable à la main. Un agent compatible WebMCP lit la situation, construit
              un plan complet dans une couche fantôme, compare plusieurs stratégies — et s’arrête à une
              seule validation humaine avant d’engager quoi que ce soit.
            </p>
            <div className="hero-actions">
              <a className="landing-primary" href="#acces">Ouvrir la console<ArrowRight size={15} aria-hidden="true" /></a>
              <a className="landing-secondary" href="#webmcp">Voir les 21 outils</a>
            </div>
            <p className="hero-warning">
              <TriangleAlert size={14} aria-hidden="true" />
              Bêta d’entraînement. Ne remplace ni le COS, ni les données terrain, ni les procédures locales.
            </p>
          </div>
          <dl className="hero-stats">
            {CHIFFRES.map((chiffre) => (
              <div key={chiffre.libelle}>
                <dt>{chiffre.libelle}</dt>
                <dd>{chiffre.valeur}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="deroule" className="landing-section">
          <header className="section-head">
            <p className="landing-eyebrow">CE QUE FAIT L’AGENT</p>
            <h2>Trois surfaces séparées, une seule décision</h2>
            <p className="section-lede">
              Le problème des agents qui agissent, c’est le nombre de confirmations. FireOps le résout en
              séparant ce qui lit, ce qui prépare et ce qui engage. L’agent peut préparer cinquante
              véhicules sans interrompre personne.
            </p>
          </header>
          <ol className="etapes">
            {ETAPES.map((etape) => {
              const Icone = etape.icone;
              return (
                <li key={etape.numero} className="etape-card glass-panel">
                  <div className="etape-head">
                    <span className="etape-icon"><Icone size={18} aria-hidden="true" /></span>
                    <span className="etape-num">{etape.numero}</span>
                  </div>
                  <h3>{etape.titre}</h3>
                  <p className="etape-tag">{etape.outils}</p>
                  <p>{etape.texte}</p>
                  <ul className="etape-tools">
                    {etape.exemples.map((outil) => <li key={outil}><code>{outil}</code></li>)}
                  </ul>
                </li>
              );
            })}
          </ol>
        </section>

        <section id="webmcp" className="landing-section landing-section-alt">
          <div className="split">
            <div>
              <p className="landing-eyebrow"><Terminal size={13} aria-hidden="true" />L’INTÉGRATION</p>
              <h2>La page est le serveur d’outils</h2>
              <p className="section-lede">
                FireOps n’appelle aucun modèle de langage. La page enregistre ses 21 outils métier sur
                <code> document.modelContext</code>, avec repli sur <code>navigator.modelContext</code>.
                Un agent utilise la session déjà ouverte dans l’onglet : ni clé d’API, ni OAuth, ni
                second backend. Les outils disparaissent au démontage de la page, donc à la déconnexion.
              </p>
              <ul className="checklist">
                <li><Check size={14} aria-hidden="true" />Outils pensés par intention métier, pas comme des wrappers CRUD</li>
                <li><Check size={14} aria-hidden="true" />Paramètres validés comme des entrées non fiables</li>
                <li><Check size={14} aria-hidden="true" />Journal des appels réellement exécutés, visible dans la console</li>
                <li><Check size={14} aria-hidden="true" />Pont de compatibilité pour les navigateurs sans API native</li>
              </ul>
              <p className="probe">
                <span>VÉRIFIER DEPUIS N’IMPORTE QUEL NAVIGATEUR</span>
                <code>await window.__WEBMCP__.callTool(&apos;get_situation&apos;, {})</code>
              </p>
            </div>
            <figure className="code-card glass-panel">
              <figcaption>app/fireops-client.tsx</figcaption>
              <pre><code>{EXTRAIT}</code></pre>
            </figure>
          </div>
        </section>

        <section id="moteur" className="landing-section">
          <div className="split split-media">
            <figure className="media-card">
              <img
                src="/media/largage-aerien.jpg"
                width={1920}
                height={1148}
                alt="Avion bombardier d’eau larguant du retardant au-dessus d’un relief boisé."
                loading="lazy"
              />
              <figcaption>13 types d’engins, avec cuve, débit de pompe et temps de remplissage constructeur.</figcaption>
            </figure>
            <div>
              <p className="landing-eyebrow"><Radar size={13} aria-hidden="true" />LE MOTEUR</p>
              <h2>Automate cellulaire 128 × 128, dans un Web Worker</h2>
              <p className="section-lede">
                Propagation par file de priorité, sous-pas de quinze minutes, cycle diurne et série météo
                horaire réelle pour les runs multi-jours. Le calcul reste dans le navigateur.
              </p>
              <dl className="moteur-list">
                {MOTEUR.map((item) => (
                  <div key={item.titre}>
                    <dt>{item.titre}</dt>
                    <dd>{item.texte}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        <section id="validation" className="landing-section landing-section-alt">
          <header className="section-head">
            <p className="landing-eyebrow"><TriangleAlert size={13} aria-hidden="true" />CE QUE LE MODÈLE NE SAIT PAS FAIRE</p>
            <h2>Le moteur n’est pas calibré, et le dépôt le dit</h2>
            <p className="section-lede">
              Le harnais <code>validate-fires.mjs</code> rejoue des feux de référence et mesure le
              recouvrement de périmètre contre les données Copernicus EMS. Il ne modifie aucun
              coefficient. Voici les écarts au 28 août 2026, publiés plutôt que masqués par un facteur
              d’ajustement.
            </p>
          </header>
          <div className="ecarts">
            {ECARTS.map((ecart) => (
              <article key={ecart.mesure} className={'ecart-card glass-panel ' + ecart.ton}>
                <p className="ecart-mesure">{ecart.mesure}</p>
                <p className="ecart-valeur">{ecart.valeur}</p>
                <p className="ecart-detail">{ecart.detail}</p>
              </article>
            ))}
          </div>
          <p className="validation-note">
            Le bandeau « non calibré sur données historiques » reste affiché dans l’interface tant que ces
            écarts subsistent. À l’échelle de quelques heures, le modèle sert à comparer des options :
            intensité de front, mode d’attaque possible, suffisance des moyens, enjeux menacés. Sur
            plusieurs jours, il ne sert pas encore, et l’interface l’affiche.
          </p>
        </section>

        <section id="scenarios" className="landing-section">
          <div className="split split-media reverse">
            <div>
              <p className="landing-eyebrow"><Wind size={13} aria-hidden="true" />LES ENTRÉES</p>
              <h2>Cinq scénarios, trois régions écologiques</h2>
              <p className="section-lede">
                Chaque scénario garde son foyer, sa météo et ses moyens. Changer de simulation met la
                précédente en pause sans rien perdre.
              </p>
              <ul className="scenario-cards">
                {SCENARIOS.map((scenario) => (
                  <li key={scenario.nom} className="glass-panel">
                    <p className="scenario-nature">{scenario.nature}</p>
                    <h3>{scenario.nom}</h3>
                    <p className="scenario-lieu">{scenario.lieu}</p>
                    <p className="scenario-couvert">{scenario.couvert}</p>
                  </li>
                ))}
              </ul>
            </div>
            <figure className="media-card">
              <img
                src="/media/ligne-appui.jpg"
                width={1920}
                height={1272}
                alt="Sapeur-pompier ouvrant une ligne d’appui à la torche d’allumage dans un champ."
                loading="lazy"
              />
              <figcaption>Les lignes d’appui construites sont cumulatives et persistantes dans le moteur.</figcaption>
            </figure>
          </div>
        </section>

        <section id="acces" className="landing-section landing-access">
          <img
            className="access-photo"
            src="/media/vue-satellite.jpg"
            width={1920}
            height={2444}
            alt="Vue satellite de panaches de fumée s’étirant au-dessus d’un massif forestier."
            loading="lazy"
          />
          <div className="access-veil" aria-hidden="true" />
          <div className="access-inner">
            <div className="access-copy">
              <p className="landing-eyebrow">ACCÈS OPÉRATIONNEL</p>
              <h2>Ouvrir la console</h2>
              <p className="section-lede">
                Créez un accès, ouvrez la carte, puis laissez un agent compatible WebMCP travailler dans
                le même onglet. Un tutoriel de six étapes se lance à la première ouverture.
              </p>
              <ul className="checklist">
                <li><Check size={14} aria-hidden="true" />Carte tactique 2D, 3D et globe</li>
                <li><Check size={14} aria-hidden="true" />Météo réglable ou série horaire réelle</li>
                <li><Check size={14} aria-hidden="true" />Comparaison de trois stratégies par le moteur</li>
                <li><Check size={14} aria-hidden="true" />Journal des appels de l’agent</li>
              </ul>
            </div>
            <LoginClient />
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="footer-top">
          <div className="landing-brand">
            <span className="brand-mark"><Flame size={17} aria-hidden="true" /></span>
            <span><strong>FireOps</strong><small>Outil d’entraînement · ne remplace pas le COS</small></span>
          </div>
          <a className="footer-link" href="https://github.com/zaalis/fireops-webmcp" target="_blank" rel="noreferrer">
            Code source<ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
        <div className="footer-credits">
          <p className="footer-credits-head">Photographies — domaine public</p>
          <ul>
            {CREDITS.map((credit) => (
              <li key={credit.lien}>
                <a href={credit.lien} target="_blank" rel="noreferrer">{credit.titre}</a>
                <span>{credit.auteur}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="footer-legal">
          Modèle Rothermel 1972 · non calibré sur données historiques · fond de carte Esri ·
          archive météo Open-Meteo · code sous licence MIT.
        </p>
      </footer>
    </div>
  );
}
