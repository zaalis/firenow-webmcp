# FireOps

FireOps est un simulateur agent-native d’aide à la décision et d’entraînement pour les feux de forêt. La carte reste pilotable par un humain, tandis qu’un agent compatible WebMCP peut lire la situation, construire un plan complet dans une couche fantôme, comparer plusieurs stratégies et soumettre le lot à une validation humaine unique.

> **Bêta d’entraînement.** FireOps n’est pas un système de commandement opérationnel certifié. Il ne remplace ni le COS, ni les données terrain, ni les procédures locales. Le moteur n’est pas calibré : voir [Validation](#validation-du-moteur) pour les écarts mesurés.

## Pourquoi WebMCP

FireOps n’appelle aucun modèle de langage. La page enregistre **21 outils métier** avec `document.modelContext`, avec repli sur `navigator.modelContext`. Un agent compatible utilise la session déjà ouverte dans la page :

- des outils de lecture marqués `readOnlyHint` ;
- des outils provisoires qui ne dessinent que dans un plan fantôme ;
- des outils d’engagement et d’annulation ;
- des outils de simulation et de navigation.

`commit_plan` est le seul point d’arrêt du flux normal : il appelle `requestUserInteraction()` lorsque le client le fournit, ouvre la revue du plan et attend le choix humain. Les outils sont désenregistrés au démontage de la page, donc à la déconnexion. Les paramètres reçus de l’agent sont validés comme des entrées non fiables.

Le journal **WebMCP** rend visibles les appels réellement exécutés par l’agent, avec l’outil appelé, son résultat et son horodatage. Il n’existe pas d’agent simulé dans la page.

## Le moteur

Automate cellulaire 128 × 128, propagation par file de priorité, sous-pas de 15 minutes, exécuté dans un Web Worker.

- **Rothermel (1972) à deux classes** — combustible mort et vivant, avec amortissement d’humidité et puits de chaleur séparés. Aucun coefficient d’ajustement par espèce : les vitesses sont comparées aux fourchettes publiées, pas calées sur un incendie.
- **Modèles de combustible standard** (Anderson 1982, Scott & Burgan 2005) : 15 modèles, du tapis herbacé à la litière résineuse.
- **Registre de 35 espèces réelles** réparties sur 5 régions écologiques — Landes de Gascogne, Provence calcaire, Grand Bassin, chaparral cismontain, Sierra Nevada. Chaque espèce déclare sa part de surface par région.
- **Paysage ancré sur les coordonnées** : un lieu garde sa végétation quel que soit le cadrage ou l’emprise de la fenêtre.
- **Intensité de Byram**, seuils opérationnels à 2 000 et 4 000 kW/m, décomposition du front en tête, flancs et arrière.
- **Ellipse d’Alexander (1985)** pour le rapport longueur/largeur.
- **Sautes de braises** dépendant de la longueur de flamme et du vent, avec un régime de panache orageux.
- **Anthropisation du massif landais** : maillage DFCI, routes, bâti et débroussaillement réglementaire. Une coupure retarde le front tant que la flamme est plus courte qu’elle n’est large ; elle n’est jamais une barrière absolue.
- **Enjeux humains** : habitants menacés et atteints, surface bâtie parcourue, voies coupées. Hors d’un massif décrit, aucun chiffre n’est produit.
- **Extinction** : 13 types d’engins avec cuve, débit de pompe et temps de remplissage constructeur ; l’autonomie borne le débit réellement tenu ; les lignes d’appui construites sont cumulatives et persistantes.
- **Cycle diurne** et série météo horaire réelle (archive Open-Meteo) pour les runs multi-jours.

## Scénarios

Cinq entrées : Landiras I (Gironde, juillet 2022), Saumos (Gironde, juillet 2026), massif de l’Étoile (Provence, **exercice** et non feu historique), Bug Fire (Californie, août 2026), et simulation vierge.

## Validation du moteur

Le harnais `scripts/validate-fires.mjs` rejoue des feux de référence et calcule un recouvrement de périmètre (Jaccard) en plus de l’écart de surface. **Il ne modifie aucun coefficient.** Résultats détaillés dans [`validation-data/results-before-after.md`](validation-data/results-before-after.md).

État mesuré au 28 août 2026 :

- les trois critères structurels évoluent dans le bon sens — croissance nocturne ramenée de 27 % à 19,4 % de la surface finale, croissance devenue discontinue, moyens engagés qui évitent 51,6 % de surface dans le modèle ;
- **l’exactitude absolue n’est pas acquise** : Saumos 2026 est sous-estimé de 92 %, Saumos 2022 surestimé de 158 % avec un Jaccard de périmètre de 0,171 ;
- aucun multiplicateur de calage n’a été introduit pour masquer ces écarts.

Le bandeau « non calibré sur données historiques » reste affiché dans l’interface tant que ces écarts subsistent.

## Démarrage local

Prérequis : Node.js 22.13 ou plus récent.

    npm install
    npm run dev

Ouvrir http://localhost:3000, créer un compte de test, puis ouvrir cette page dans ChatGPT ou un navigateur compatible WebMCP. Les routes d’authentification sont servies par le même Worker local afin que les cookies restent same-origin.

## Vérification

    npm run lint
    npm run build
    node scripts/test-simulation.mjs
    node scripts/validate-fires.mjs

La suite `test-simulation.mjs` compte **48 assertions** : vitesses contre les fourchettes publiées, composition régionale, ancrage géographique du paysage, géométrie des contours, effet de la météo, réponse de l’extinction, autonomie, comportement du maillage DFCI et robustesse numérique.

## Architecture

    app/
      fireops-client.tsx        carte, état, revue et outils WebMCP
      login-client.tsx          authentification humaine
      globals.css               système visuel
      api/auth/*                CSRF, inscription, connexion, déconnexion
    db/
      auth.ts                   Argon2id, sessions, limitation de débit
      schema.ts                 schéma D1
    drizzle/                    migration SQL
    public/
      simulation.worker.js      moteur de propagation
      data/                     raster territorial Gironde pré-calculé
    scripts/
      test-simulation.mjs       suite de tests du moteur
      validate-fires.mjs        harnais de validation multi-feux
      build-gironde-landscape.mjs  génération du raster Gironde
      fetch-fire-weather.mjs    récupération des séries horaires
    validation-data/            périmètres de référence, météo, résultats
    design-system/fireops/      spécification visuelle
    docs/                       script de démonstration et texte de soumission

## Sources de données

- fond cartographique Esri Canvas (base et étiquettes), sans clé d’API ;
- BD Forêt et BD TOPO (IGN) sous Licence Ouverte, carroyage INSEE 200 m, altitude Open-Meteo pour le raster Gironde ;
- archive horaire Open-Meteo pour la météo des scénarios ;
- périmètre Copernicus EMS EMSR633 pour la validation Saumos 2022.

## Références

- [OpenAI — Site tools / WebMCP](https://learn.chatgpt.com/docs/webmcp)
- [WebMCP specification](https://webmachinelearning.github.io/webmcp/)
- Rothermel, R. C. (1972), *A mathematical model for predicting fire spread in wildland fuels*
- Anderson, H. E. (1982), *Aids to determining fuel models for estimating fire behavior*
- Scott, J. H. & Burgan, R. E. (2005), *Standard fire behavior fuel models*
- Alexander, M. E. (1985), géométrie elliptique du front
- Byram, G. M. (1959), intensité de front de flamme

## Limites connues

- **Le moteur n’est pas calibré.** Les écarts mesurés sont publiés ci-dessus plutôt que corrigés par un facteur d’ajustement.
- Le raster territorial réel ne couvre que la Gironde ; les autres régions utilisent une mosaïque procédurale ancrée sur les coordonnées, sans routes ni bâti réels.
- Le relief est échantillonné à 90 m ; le MNT à 30 m demande désormais une acceptation de licence authentifiée.
- Aucun périmètre vectoriel exploitable n’a été trouvé pour Saumos 2026 : le score de forme n’est disponible que pour 2022.
- Les ordres d’évacuation ne sont jamais transmis à un système externe.
- Tests WebMCP en conditions réelles, test mobile terrain et validation métier par des sapeurs-pompiers non réalisés.
- Le fond cartographique est servi jusqu’au niveau de zoom 16 ; au-delà la dernière tuile est étirée.
- Le bundle MapLibre dépasse l’avertissement de 500 kB et gagnerait à être découpé.

## Licence

MIT — voir [LICENSE](LICENSE).
