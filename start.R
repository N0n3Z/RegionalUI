#!/usr/bin/env Rscript
# =============================================================
# RegionalUI - Geographic Data Visualization Interface
# Run this script to start the application:
#   Rscript start.R
# The script sets its own directory as working directory,
# so it can be launched from any location.
# =============================================================

# ── Set working directory to the folder that contains this script ─
local({
  args <- commandArgs(trailingOnly = FALSE)
  f    <- sub("--file=", "", args[grep("--file=", args)])
  if (length(f) > 0) {
    d <- dirname(normalizePath(f))
    setwd(d)
    cat(sprintf("Repertoire de travail : %s\n", d))
  } else {
    cat("(Repertoire de travail non modifie — lancement interactif)\n")
  }
})

# Install required packages if missing
required_packages <- c("plumber", "data.table", "openxlsx2", "jsonlite")
cat("Checking required packages...\n")
for (pkg in required_packages) {
  if (!requireNamespace(pkg, quietly = TRUE)) {
    cat(sprintf("  Installing %s...\n", pkg))
    install.packages(pkg, repos = "https://cran.r-project.org")
  }
}

# Create required directories
for (d in c("data", "saves")) {
  if (!dir.exists(d)) {
    dir.create(d, showWarnings = FALSE, recursive = TRUE)
    cat(sprintf("  Created directory: %s/\n", d))
  }
}

library(plumber)

cat("\n")
cat("===================================================\n")
cat("  RegionalUI - Interface de Donnees Geographiques  \n")
cat("===================================================\n")
cat("  URL     : http://localhost:8080\n")
cat("  Donnees : ./data/    (placez vos fichiers ici)\n")
cat("  Sauves  : ./saves/   (snapshots automatiques)\n")
cat("===================================================\n")
cat("  Ctrl+C pour arreter le serveur\n\n")

# Start the Plumber API
pr <- plumb("api/plumber.R")

# Serve the web interface from www/ using pr_static()
# (more reliable than the @assets tag inside plumber.R)
www_path <- normalizePath("www", mustWork = FALSE)
if (!dir.exists(www_path)) {
  stop(paste("Repertoire www/ introuvable:", www_path,
             "\nVerifiez que vous lancez le script depuis le bon dossier."))
}
pr <- pr_static(pr, "/", www_path)

pr$run(host = "0.0.0.0", port = 8080)
