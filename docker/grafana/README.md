# Tableau de bord Grafana

`dashboards/trackarr-overview.json` est un tableau de bord à **importer à la
main**. Rien ne le monte : aucun `docker-compose*.yml` et aucun gabarit Helm du
dépôt ne référence ce répertoire, et il n'existe pas de service `grafana` à
provisionner. Écrit ici parce qu'un fichier de configuration sans consommateur
se lit comme un provisionnement qui aurait cessé de fonctionner.

## L'importer

1. Dans Grafana : **Dashboards → New → Import**.
2. Coller le contenu de `dashboards/trackarr-overview.json`, ou téléverser le
   fichier.
3. Choisir la source de données Prometheus quand Grafana demande
   `${DS_PROMETHEUS}` — c'est la seule variable que le fichier attend, et il ne
   contient aucun secret.

## Ce qu'il montre

Les métriques que l'API expose sur `/api/metrics` (`prom-client`) et celles du
tracker : essaims, pairs, débit d'annonces, latences, état des dépendances.
Vérifier que Prometheus scrape bien ces deux cibles avant de s'étonner de
panneaux vides.
