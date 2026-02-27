#!/usr/bin/env Rscript
# =============================================================
# RegionalUI - Geographic Data Visualization Interface
# Run this script to start the application:
#   Rscript start.R
# =============================================================

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

# Start the Plumber API (serves static files + REST API)
pr <- plumb("api/plumber.R")
pr$run(host = "0.0.0.0", port = 8080)
