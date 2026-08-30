# Script vidéo FireOps — 2 min 48

## 0:00–0:18 — Le contexte

**Écran :** globe, puis transition vers Landiras.

**Voix :** « 12 juillet 2022. Landiras, en Gironde. Un feu de forêt devient un problème de commandement bien avant de devenir une statistique. FireOps permet de revenir à H+2 et de tester une autre stratégie. »

## 0:18–0:42 — La simulation

**Écran :** vue 2D, front actif, couvert dominant, enjeux humains, bloc d’extinction, lecture accélérée.

**Voix :** « Le front est simulé localement dans le navigateur, hors du fil principal. Rothermel à deux classes, modèles de combustible standard, trente-cinq espèces réelles, maillage DFCI du massif. Et FireOps affiche ce qu’il ne sait pas : le bandeau indique que le moteur n’est pas calibré, et les écarts mesurés sont publiés dans le dépôt. »

## 0:42–1:00 — WebMCP, pas une API de chat

**Écran :** ouvrir « Voir les outils ».

**Voix :** « La page n’appelle jamais ChatGPT. Elle expose vingt et un outils WebMCP orientés métier. ChatGPT les découvre dans la page déjà authentifiée et partage exactement le même état que l’officier. Aucune clé API, aucun OAuth, aucun serveur MCP séparé. »

## 1:00–1:28 — La demande

**Écran :** envoyer dans ChatGPT : « Le vent passe au nord-ouest à 40 km/h. Propose-moi deux stratégies pour protéger le village. »

**Voix :** « L’agent lit la situation, change la météo du scénario, interroge le terrain et construit librement son plan. Ces écritures sont provisoires : les véhicules, la ligne d’appui et la zone d’évacuation apparaissent en fantôme. Rien n’est encore engagé. »

## 1:28–1:52 — L’outil signature

**Écran :** compare_plans, trois cartes de résultats.

**Voix :** « Compare plans exécute les stratégies dans le Worker et retourne un résultat vérifiable : surface brûlée, pourcentage contenu, moyens consommés et habitations menacées. Le bouclier village atteint 78 % de front contenu à T+6h, contre 41 % sans action. »

## 1:52–2:20 — Une seule validation

**Écran :** « Retenir Bouclier village », revue de plan.

**Voix :** « Voici l’unique interruption humaine : l’intention de l’agent, le diff lisible, l’aperçu cartographique et l’impact projeté. Vingt-trois moyens ont été préparés sans vingt-trois confirmations. Un seul clic applique le lot. »

**Action :** cliquer « Appliquer le plan ».

## 2:20–2:38 — Traçabilité

**Écran :** plan appliqué, bandeau Annuler, lancer la simulation.

**Voix :** « Toutes les actions sont journalisées et annulables. L’officier garde l’autorité ; l’agent gagne la vitesse d’un état-major. »

## 2:38–2:48 — Conclusion

**Écran :** cadrage FireOps, carte et panneau WebMCP.

**Voix :** « FireOps. Une carte pour décider, un agent pour explorer, un humain pour engager. »
