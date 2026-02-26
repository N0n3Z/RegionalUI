# api.R — Serveur Plumber pour la visualisation régionale
# Lancer avec : plumber::plumb("api.R")$run(port=8000)

library(plumber)
library(dplyr)
library(jsonlite)

# Charger les données au démarrage

ofile <- tryCatch(sys.frame(1)$ofile, error = function(e) "")
DATA_PATH <- file.path(
  if (nchar(ofile) > 0) dirname(normalizePath(ofile)) else getwd(),
  "data", "arrondissements.txt"
)

if (!exists("arrondissements")) {
  arrondissements <- read.csv(DATA_PATH, stringsAsFactors = FALSE, encoding = "UTF-8")
}

# Journal des modifications
if (!exists("historique")) {
  historique <- data.frame(
    timestamp   = character(),
    nuts3       = character(),
    variable    = character(),
    valeur_avant = numeric(),
    valeur_apres = numeric(),
    motif       = character(),
    stringsAsFactors = FALSE
  )
}

#* @filter cors
function(req, res) {
  res$setHeader("Access-Control-Allow-Origin", "*")
  res$setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res$setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req$REQUEST_METHOD == "OPTIONS") {
    res$status <- 200
    return(list())
  }
  plumber::forward()
}

#* Retourne tous les arrondissements
#* @get /arrondissements
function() {
  arrondissements
}

#* Retourne un arrondissement par code NUTS3
#* @param code Code NUTS3 (ex: BE332)
#* @get /arrondissement/<code>
function(code) {
  result <- arrondissements[arrondissements$nuts3 == code, ]
  if (nrow(result) == 0) {
    stop(paste("Code NUTS3 introuvable:", code))
  }
  result
}

#* Retourne la liste des variables disponibles
#* @get /variables
function() {
  vars_numeriques <- names(arrondissements)[sapply(arrondissements, is.numeric)]
  list(variables = vars_numeriques)
}

#* Statistiques agrégées par région ou province
#* @param groupe Grouper par "region" ou "province"
#* @param variable Variable à agréger
#* @get /stats
function(groupe = "region", variable = "population") {
  if (!variable %in% names(arrondissements)) {
    stop(paste("Variable inconnue:", variable))
  }
  if (!groupe %in% c("region", "province")) {
    stop("Le paramètre 'groupe' doit être 'region' ou 'province'")
  }

  arrondissements %>%
    group_by(across(all_of(groupe))) %>%
    summarise(
      n_arrondissements = n(),
      total             = sum(.data[[variable]], na.rm = TRUE),
      moyenne           = mean(.data[[variable]], na.rm = TRUE),
      mediane           = median(.data[[variable]], na.rm = TRUE),
      min               = min(.data[[variable]], na.rm = TRUE),
      max               = max(.data[[variable]], na.rm = TRUE),
      .groups = "drop"
    )
}

#* Corriger la valeur d'une cellule
#* @param nuts3 Code NUTS3
#* @param variable Nom de la variable
#* @param valeur Nouvelle valeur
#* @param motif Justification de la correction
#* @post /corriger
function(nuts3, variable, valeur, motif = "Correction manuelle") {
  if (!nuts3 %in% arrondissements$nuts3) {
    stop(paste("Code NUTS3 introuvable:", nuts3))
  }
  if (!variable %in% names(arrondissements)) {
    stop(paste("Variable inconnue:", variable))
  }

  valeur_num <- as.numeric(valeur)
  if (is.na(valeur_num)) stop("La valeur doit être numérique")

  valeur_avant <- arrondissements[arrondissements$nuts3 == nuts3, variable]
  arrondissements[arrondissements$nuts3 == nuts3, variable] <<- valeur_num

  historique <<- rbind(historique, data.frame(
    timestamp    = format(Sys.time(), "%Y-%m-%d %H:%M:%S"),
    nuts3        = nuts3,
    variable     = variable,
    valeur_avant = valeur_avant,
    valeur_apres = valeur_num,
    motif        = motif,
    stringsAsFactors = FALSE
  ))

  list(
    succes       = TRUE,
    nuts3        = nuts3,
    variable     = variable,
    valeur_avant = valeur_avant,
    valeur_apres = valeur_num
  )
}

#* Appliquer une règle de correction automatique
#* @param regle Nom de la règle: "zscore", "iqr", "lissage_spatial"
#* @param variable Variable cible
#* @param seuil Seuil de détection (défaut: 2.5)
#* @post /regle
function(regle, variable, seuil = 2.5) {
  if (!variable %in% names(arrondissements)) {
    stop(paste("Variable inconnue:", variable))
  }

  seuil <- as.numeric(seuil)
  valeurs <- arrondissements[[variable]]

  if (regle == "zscore") {
    z <- (valeurs - mean(valeurs, na.rm=TRUE)) / sd(valeurs, na.rm=TRUE)
    anomalies <- which(abs(z) > seuil)
    list(
      regle     = "zscore",
      variable  = variable,
      seuil     = seuil,
      anomalies = arrondissements$nuts3[anomalies],
      noms      = arrondissements$nom[anomalies],
      zscores   = round(z[anomalies], 3)
    )

  } else if (regle == "iqr") {
    q1  <- quantile(valeurs, 0.25, na.rm=TRUE)
    q3  <- quantile(valeurs, 0.75, na.rm=TRUE)
    iqr <- q3 - q1
    anomalies <- which(valeurs < (q1 - seuil * iqr) | valeurs > (q3 + seuil * iqr))
    list(
      regle     = "iqr",
      variable  = variable,
      seuil     = seuil,
      q1        = q1,
      q3        = q3,
      anomalies = arrondissements$nuts3[anomalies],
      noms      = arrondissements$nom[anomalies],
      valeurs   = valeurs[anomalies]
    )

  } else if (regle == "lissage_spatial") {
    moyennes_region <- arrondissements %>%
      group_by(region) %>%
      mutate(valeur_lissee = round(mean(.data[[variable]], na.rm=TRUE), 2)) %>%
      pull(valeur_lissee)

    list(
      regle           = "lissage_spatial",
      variable        = variable,
      nuts3           = arrondissements$nuts3,
      noms            = arrondissements$nom,
      valeurs_orig    = valeurs,
      valeurs_lissees = moyennes_region
    )

  } else {
    stop(paste("Règle inconnue:", regle, "— Valeurs: zscore, iqr, lissage_spatial"))
  }
}

#* Retourner l'historique des modifications
#* @get /historique
function() {
  if (nrow(historique) == 0) {
    return(list(message = "Aucune modification enregistrée"))
  }
  historique
}

#* Exporter les données corrigées en CSV
#* @get /exporter
#* @serializer contentType list(type="text/csv")
function(res) {
  tmp <- tempfile(fileext = ".csv")
  write.csv(arrondissements, tmp, row.names = FALSE)
  readBin(tmp, "raw", file.info(tmp)$size)
}

#* Réinitialiser les données depuis le fichier source
#* @post /reinitialiser
function() {
  arrondissements <<- read.csv(DATA_PATH, stringsAsFactors = FALSE, encoding = "UTF-8")
  historique      <<- data.frame(
    timestamp=character(), nuts3=character(), variable=character(),
    valeur_avant=numeric(), valeur_apres=numeric(), motif=character(),
    stringsAsFactors=FALSE
  )
  list(succes = TRUE, message = "Données réinitialisées depuis le fichier source")
}
