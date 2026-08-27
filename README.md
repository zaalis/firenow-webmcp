# FireOps

FireOps est un simulateur agent-native d’aide à la décision et d’entraînement pour les feux de forêt. La carte reste utilisable par un humain, tandis que ChatGPT peut lire la situation, construire un plan complet dans une couche fantôme, comparer plusieurs stratégies et soumettre le lot à une validation humaine unique.

> **Bêta d’entraînement.** FireOps n’est pas un système de commandement opérationnel certifié et ne remplace jamais le COS, les données terrain ni les procédures locales.

## Pourquoi WebMCP

FireOps n’appelle aucun modèle. La page enregistre 20 outils métier avec document.modelContext, avec repli vers navigator.modelContext pour les versions antérieures. Un agent compatible utilise la session déjà ouverte dans la page :

- 6 outils de lecture marqués readOnlyHint;
- 5 outils provisoires qui dessinent uniquement dans un plan fantôme;
- 2 outils d’engagement et d’annulation;
- 7 outils de simulation et de navigation.

commit_plan est le seul point d’arrêt du flux normal : il appelle requestUserInteraction() lorsqu’il est fourni par le client, ouvre la revue du plan et attend le choix humain. Les outils sont désenregistrés au démontage de la page et donc à la déconnexion.

Le panneau **Agent simulé** rejoue le scénario complet sans dépendre du flag WebMCP. Il est destiné à la vidéo, aux tests et aux navigateurs non compatibles.

## Fonctionnalités du MVP

- scénario Landiras I, juillet 2022;
- MapLibre GL avec modes 2D, relief 3D et globe;
- front actif, projection T+3h, unités engagées et propositions fantômes;
- drag & drop manuel des moyens;
- comparaison chiffrée de stratégies;
- revue de plan, validation groupée et pile d’annulation;
- moteur local dans un Web Worker : termes de propagation Rothermel, front elliptique orienté par le vent et facteur de suppression;
- score de calibration Sørensen visible;
- authentification email/mot de passe avec Argon2id (64 MiB, 3 passes, parallélisme 4), session opaque en cookie HttpOnly, CSRF double-submit, limitation par IP et compte, et vérification Pwned Passwords par k-anonymat;
- interface de repli 100 % manuelle si WebMCP est absent.

## Démarrage local

Prérequis : Node.js 22.13 ou plus récent.

    npm install
    npm run dev -- --port 5173

Ouvrir http://localhost:5173, créer un compte de test, puis utiliser **Agent simulé**. Les routes d’authentification sont servies par le même Worker local afin que les cookies restent same-origin.

## Validation

    npm run lint
    npm run build
    npm audit --omit=dev

État de la dernière passe locale :

- lint : réussi;
- build de production : réussi;
- audit des dépendances de production : 0 vulnérabilité connue;
- création de compte, reconnexion et déconnexion : réussies;
- WebMCP réel : nécessite le navigateur intégré ChatGPT ou Chrome avec WebMCP activé.

## Architecture

    app/
      fireops-client.tsx        carte, état, revue et outils WebMCP
      login-client.tsx          authentification humaine
      api/auth/*                CSRF, inscription, connexion, déconnexion
    db/
      auth.ts                   Argon2id, sessions, rate limiting
      schema.ts                 schéma D1
    public/
      simulation.worker.js      moteur de propagation local
    docs/
      demo-script-fr.md         narration vidéo de moins de 3 min
      submission-fr.md          texte de soumission

## Références

- [OpenAI — Site tools / WebMCP](https://learn.chatgpt.com/docs/webmcp)
- [WebMCP specification](https://webmachinelearning.github.io/webmcp/)
- Rothermel, R. C. (1972), *A mathematical model for predicting fire spread in wildland fuels*
- Scott & Burgan (2005), *Standard fire behavior fuel models*
- Alexander, M. E. (1985), travaux sur la géométrie elliptique du front

## Limites connues

- la calibration historique affichée est une donnée de démonstration et non un résultat scientifique reproduit dans ce dépôt;
- les périmètres Landiras et les couches PMTiles officielles restent à intégrer;
- le moteur implémente le noyau de propagation et une agrégation elliptique, pas encore l’automate cellulaire complet à 8 voisins;
- les ordres d’évacuation ne sont jamais transmis à un système externe;
- tests WebMCP réels, test mobile terrain et validation métier pompier non réalisés;
- le bundle MapLibre dépasse encore l’avertissement de 500 kB et doit être découpé avant une exploitation longue durée.

## Licence

MIT — voir [LICENSE](LICENSE).
