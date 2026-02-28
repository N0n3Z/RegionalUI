# RegionalUI — Interface de visualisation de données géographiques

Application web locale pour visualiser, modifier et sauvegarder des données géographiques structurées.

## Démarrage rapide

```bash
# Depuis le répertoire RegionalUI/
Rscript start.R
```

Ouvrir ensuite http://localhost:8080 dans le navigateur.

## Structure du projet

```
RegionalUI/
├── start.R              # Script de lancement
├── api/
│   ├── plumber.R        # Endpoints REST (Plumber)
│   ├── utils.R          # I/O fichiers, historique
│   └── operations.R     # Opérations sur les données
├── data/                # ← Placer les fichiers ici
│   ├── POPULATION.csv   # Exemple fourni
│   └── TAUX_EMPLOI.csv  # Exemple fourni
├── saves/               # Snapshots horodatés (auto-créé)
└── www/                 # Interface web (HTML/CSS/JS)
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

## Format des données

Chaque fichier (`VARIABLE.xlsx` ou `VARIABLE.csv`) doit contenir au minimum :

| Colonne           | Description                          |
|-------------------|--------------------------------------|
| TERRITORIAL_CODE  | Code de l'unité géographique         |
| TERRITORIAL_NAME  | Nom de l'unité géographique          |
| VARIABLE          | Nom de la variable (= nom du fichier)|
| YEAR              | Année (optionnel)                    |
| VALUE             | Valeur numérique                     |

Les colonnes supplémentaires sont affichées mais non éditables.

## Paquets R requis

Installés automatiquement au premier démarrage :
- `plumber` — API REST
- `data.table` — lecture/écriture CSV rapide
- `openxlsx2` — lecture/écriture Excel
- `jsonlite` — sérialisation JSON

## Système de sauvegarde

```
saves/
└── POPULATION/
    ├── 20240115_103022/
    │   ├── POPULATION.csv   # données
    │   └── meta.json        # horodatage + description + statistiques
    └── 20240116_143500/
        ├── POPULATION.csv
        └── meta.json
```

## Ajouter de nouvelles opérations

Éditez `api/operations.R` :

1. Ajoutez une entrée dans `get_operations_list()` avec `id`, `label`, `description`, `scope` et `params`.
2. Ajoutez un `case` dans `apply_operation()` correspondant au même `id`.

Exemple minimal :

```r
# Dans get_operations_list()
list(
  id          = "mon_operation",
  label       = "Mon opération",
  description = "Description affichée dans l'interface.",
  scope       = list("dataset", "selection"),
  params      = list(
    list(id = "facteur", label = "Facteur", type = "number",
         required = TRUE, default = 1)
  )
)

# Dans apply_operation(), dans le switch()
"mon_operation" = {
  f <- as.numeric(params$facteur)
  dt[mask, VALUE := VALUE * f]
},
```

L'opération apparaît automatiquement dans le menu contextuel.

## Interface utilisateur

- **Tableau central** : tri, filtre par colonne, édition inline (double-clic colonne VALUE)
- **Clic droit** sur une cellule VALUE : modifier, appliquer une opération à la sélection ou au dataset
- **Clic droit** ailleurs : opérations sur l'ensemble du dataset
- **Graphiques** : barres horizontales (valeurs) + donut (parts relatives), filtrés par année
- **💾 Valider** : écrit les modifications en mémoire sur le disque
- **📷 Sauvegarder** : crée un snapshot horodaté sans modifier le fichier principal
- **📚 Historique** : liste et restaure les snapshots
