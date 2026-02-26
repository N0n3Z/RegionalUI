# launch.R — Script de lancement du serveur Plumber
# Usage : Rscript launch.R

# Vérifier et installer les dépendances manquantes
packages <- c("plumber", "dplyr", "jsonlite")
manquants <- packages[!packages %in% installed.packages()[,"Package"]]
if (length(manquants) > 0) {
  message("Installation des packages manquants : ", paste(manquants, collapse=", "))
  install.packages(manquants)
}

library(plumber)

PORT <- 8000

message("=================================================")
message(" Visualisation Régionale — Belgique NUTS3")
message("=================================================")
message(sprintf(" API disponible sur : http://localhost:%d", PORT))
message(sprintf(" Interface web     : ouvrir www/index.html"))
message(" Arrêter           : Ctrl+C")
message("=================================================")

path_regionalUI <- file.path("R:","SER","CN","CN3","Regional Accounts","2 Households Income","New_process","RegionalUI")

# Démarrer le serveur


args        <- commandArgs(trailingOnly = FALSE)
script_file <- sub("--file=", "", grep("--file=", args, value = TRUE))
script_dir  <- if (length(script_file) > 0) dirname(normalizePath(script_file)) else getwd()
script_dir <- path_regionalUI
setwd(script_dir)


pr <- plumb(file.path(path_regionalUI, "api.R"))
pr$run(host = "0.0.0.0", port = PORT)
