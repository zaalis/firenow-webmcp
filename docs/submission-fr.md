# FireOps — texte de soumission

## Résumé

FireOps transforme un agent en officier d’état-major dans un simulateur de feux de forêt. L’humain conserve la carte et l’autorité ; l’agent peut lire la situation, construire un plan complet en fantôme, comparer plusieurs stratégies dans un moteur local, puis demander une seule validation humaine pour engager le lot.

## Ce qui rend l’intégration WebMCP profonde

FireOps expose vingt et un outils pensés par intention métier plutôt que comme des wrappers CRUD. La séparation lecture / provisoire / engagement résout le problème des actions agentiques nombreuses : l’agent peut préparer cinquante véhicules sans interrompre l’officier, car aucune ressource n’est engagée avant `commit_plan`. Ce dernier utilise `requestUserInteraction()` et reste suspendu pendant la revue visuelle du plan.

La page n’appelle aucun LLM. L’agent opère dans la page authentifiée, partage son cookie de session, et les outils disparaissent à la déconnexion. Les paramètres reçus de l’agent sont validés comme des entrées non fiables.

Comme `document.modelContext` n’existe pas encore dans un navigateur courant, la page fournit son propre contexte de modèle quand le navigateur n’en a pas — sans jamais remplacer une implémentation native. Les outils sont donc réellement appelables aujourd’hui, dans Chrome, depuis un agent qui exécute du JavaScript dans l’onglet (`window.__WEBMCP__.callTool`), depuis un content script d’extension par `postMessage` de même origine, ou depuis un client WebMCP natif le jour où il existe.

## Le moteur, et ce qu’il ne prétend pas être

Automate cellulaire 128 × 128 dans un Web Worker : Rothermel à deux classes sans coefficient d’ajustement par espèce, modèles de combustible standard d’Anderson et de Scott & Burgan, registre de 35 espèces réelles sur 5 régions écologiques, intensité de Byram, ellipse d’Alexander, sautes de braises, maillage DFCI du massif landais, et enjeux humains.

Le paysage est engendré depuis les coordonnées géographiques : il existe indépendamment de tout incendie et ne connaît aucun scénario. Aucun feu historique n’est scripté.

**Le moteur n’est pas calibré, et le dépôt le dit.** Le harnais `validate-fires.mjs` mesure le recouvrement de périmètre contre les données Copernicus EMS. Au 28 août 2026, Saumos 2026 est sous-estimé de 92 % et Saumos 2022 surestimé de 158 %, pour un Jaccard de 0,171. Ces écarts sont publiés dans `validation-data/results-before-after.md` plutôt que masqués par un facteur d’ajustement.

## Impact

L’objectif n’est pas de prédire un incendie, mais de permettre de tester rapidement des options, d’en comparer les conséquences et d’entraîner un raisonnement sous contrainte : intensité de front, mode d’attaque possible, suffisance des moyens, enjeux menacés. Sur ces questions le modèle est exploitable à l’échelle de quelques heures. Sur plusieurs jours, il ne l’est pas encore, et l’interface l’affiche.

## Technologie

WebMCP impératif, React/Vite via Vinext, MapLibre GL sur fond raster Esri, Web Worker, Cloudflare D1, Lucide.

## Statut

Bêta d’entraînement. Cinq scénarios : Landiras I (2022), Saumos (2026), massif de l’Étoile (exercice), Bug Fire (Californie 2026) et simulation vierge. Restent à faire : couverture territoriale réelle hors Gironde, relief à 30 m, périmètres vectoriels pour 2026, et validation métier par des sapeurs-pompiers.
