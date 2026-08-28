# Validation multi-jours FireOps

Mesure du 28 août 2026. Le harnais ne modifie aucun coefficient. Le « avant »
est le run de référence fourni dans la mission ; le « après » emploie le cycle
diurne, la mort du périmètre, les lignes persistantes, le raster Gironde et la
série horaire Open-Meteo.

| Échéance Saumos 2026 | Réel (ha) | Avant (ha) | Après, moyens engagés (ha) | Écart après |
| --- | ---: | ---: | ---: | ---: |
| 22/07 | 1 400 | 183 | 31 | -97,8 % |
| 23/07 | 4 800 | 12 161 | 381 | -92,1 % |
| 24/07 | 19 000 | 32 837 | 1 404 | -92,6 % |
| 25/07 | 32 000 | 42 465 | 1 984 | -93,8 % |
| 26/07 | 42 000 | 49 240 | 3 220 | -92,3 % |

- Croissance nocturne avant : 13 245 ha, soit 27 % de la surface finale.
- Croissance nocturne après : 19,4 % de la surface finale avec moyens engagés.
- Croissance après par régime : 2 594 ha de jour contre 626 ha de nuit ; les
  incréments quotidiens (31, 350, 1 023, 580 puis 1 236 ha) ne suivent plus une
  croissance quadratique monotone.
- Effet des moyens après : 6 653 ha sans moyens contre 3 220 ha avec moyens,
  soit 51,6 % de surface évitée dans le modèle.
- Saumos 2022 / EMSR633 : 8 381 ha simulés contre 3 248 ha observés (+158,0 %),
  Jaccard de périmètre 0,171.
- Saumos 2026 : aucun périmètre vectoriel publiquement récupérable n'a été
  trouvé lors de cette mission ; le score de forme reste donc non disponible.

Conclusion : les trois critères structurels changent dans le bon sens (nuit,
croissance discontinue, effet des moyens), mais l'exactitude absolue n'est pas
acquise. Le modèle sous-estime très fortement Saumos 2026 et surestime encore
Saumos 2022 ; aucun multiplicateur de calage n'a été ajouté pour cacher cet écart.
