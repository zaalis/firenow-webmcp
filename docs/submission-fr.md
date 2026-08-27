# FireOps — texte de soumission

## Résumé

FireOps transforme ChatGPT en officier d’état-major dans un simulateur de feux de forêt. L’humain conserve la carte et l’autorité ; l’agent peut lire la situation, construire un plan complet en fantôme, comparer plusieurs stratégies dans un moteur local, puis demander une seule validation humaine pour engager le lot.

## Ce qui rend l’intégration WebMCP profonde

FireOps expose vingt outils par intention métier plutôt que des wrappers CRUD. La séparation lecture / provisoire / engagement résout le problème des actions agentiques nombreuses : l’agent peut préparer cinquante véhicules sans interrompre l’officier, car aucune ressource n’est engagée avant commit_plan. Ce dernier utilise requestUserInteraction() et reste suspendu pendant la revue visuelle du plan.

La page n’appelle aucun LLM. L’agent opère dans la page authentifiée, partage son cookie de session, et les outils disparaissent à la déconnexion. Les paramètres de l’agent sont validés comme des entrées non fiables.

## Impact

L’objectif n’est pas de prédire parfaitement un incendie, mais de permettre aux officiers de tester rapidement des options, de comparer leurs conséquences et d’entraîner leur raisonnement sous contrainte. FireOps montre sa confiance avec un score Sørensen au lieu de prétendre à une exactitude absolue.

## Technologie

WebMCP impératif, React/Vite via Vinext, MapLibre GL, Web Worker, Cloudflare D1, Argon2id, cookies opaques et Lucide.

## Statut

Bêta d’entraînement. Scénario principal : Landiras I, Gironde, juillet 2022. La validation scientifique complète sur cinq feux historiques et l’intégration des périmètres officiels restent à réaliser.
