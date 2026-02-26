# launch.R — Script de lancement du serveur Plumber
# Usage : Rscript launch.R

# Vérifier et installer les dépendances manquantes
packages <- c("plumber", "dplyr", "jsonlite")
manquants <- packages[!packages %in% installed.packages()[,"Package"]]
if (length(manquants) > 0) {
  message("Installation des packages manquants : ", paste(manquants, collapse=", "))
  install.packages(manquants, repos = "https://cloud.r-project.org")
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

# Démarrer le serveur
pr <- plumb(file.path(dirname(sys.frame(1)$ofile), "api.R"))
pr$run(host = "0.0.0.0", port = PORT)
