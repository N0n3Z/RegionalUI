# =============================================================
# api/utils.R - Utility functions for RegionalUI
# =============================================================

DATA_DIR  <- "data"
SAVES_DIR <- "saves"

# Year column candidates (in order of preference)
YEAR_COLS <- c("YEAR", "ANNEE", "PERIODE", "PERIOD", "DATE", "AN")

# ---- File listing -------------------------------------------

#' List all available variable files in DATA_DIR
list_variables <- function() {
  xlsx_files <- list.files(DATA_DIR, pattern = "\\.xlsx$", full.names = FALSE, ignore.case = TRUE)
  csv_files  <- list.files(DATA_DIR, pattern = "\\.csv$",  full.names = FALSE, ignore.case = TRUE)
  all_files  <- c(xlsx_files, csv_files)

  if (length(all_files) == 0) return(list())

  lapply(all_files, function(f) {
    ext  <- tolower(tools::file_ext(f))
    name <- tools::file_path_sans_ext(f)
    path <- file.path(DATA_DIR, f)
    list(
      name  = name,
      file  = f,
      type  = ext,
      mtime = format(file.mtime(path), "%Y-%m-%d %H:%M:%S")
    )
  })
}

# ---- Data I/O -----------------------------------------------

#' Load data for a given variable name (without extension)
#' Returns a data.table
load_variable_data <- function(variable) {
  xlsx_path <- file.path(DATA_DIR, paste0(variable, ".xlsx"))
  csv_path  <- file.path(DATA_DIR, paste0(variable, ".csv"))

  if (file.exists(xlsx_path)) {
    dt <- as.data.table(openxlsx2::read_xlsx(xlsx_path))
  } else if (file.exists(csv_path)) {
    dt <- data.table::fread(csv_path, encoding = "UTF-8")
  } else {
    stop(paste("Variable introuvable:", variable))
  }

  # Ensure VALUE is numeric
  if ("VALUE" %in% names(dt)) {
    dt[, VALUE := suppressWarnings(as.numeric(VALUE))]
  }
  dt
}

#' Save a data.table back to the original file (xlsx or csv)
save_variable_data <- function(variable, dt) {
  xlsx_path <- file.path(DATA_DIR, paste0(variable, ".xlsx"))
  csv_path  <- file.path(DATA_DIR, paste0(variable, ".csv"))

  if (file.exists(xlsx_path)) {
    openxlsx2::write_xlsx(as.data.frame(dt), xlsx_path)
    return(invisible(xlsx_path))
  } else if (file.exists(csv_path)) {
    data.table::fwrite(dt, csv_path)
    return(invisible(csv_path))
  } else {
    stop(paste("Fichier introuvable pour la variable:", variable))
  }
}

# ---- Temporal helpers ---------------------------------------

#' Return the name of the year/period column, or NULL
get_year_col <- function(dt) {
  col <- YEAR_COLS[YEAR_COLS %in% names(dt)][1]
  if (is.na(col)) NULL else col
}

#' Return sorted unique years, or NULL if no year column
get_years <- function(dt) {
  yc <- get_year_col(dt)
  if (is.null(yc)) return(NULL)
  sort(unique(dt[[yc]]))
}

# ---- Snapshot / history -------------------------------------

#' Save a snapshot of the data with metadata
#' Returns the timestamp string used as snapshot id
save_state <- function(variable, dt, description = "") {
  snap_root <- file.path(SAVES_DIR, variable)
  dir.create(snap_root, showWarnings = FALSE, recursive = TRUE)

  ts       <- format(Sys.time(), "%Y%m%d_%H%M%S")
  snap_dir <- file.path(snap_root, ts)
  dir.create(snap_dir, showWarnings = FALSE)

  # Save data as CSV inside snapshot
  data.table::fwrite(dt, file.path(snap_dir, paste0(variable, ".csv")))

  # Save metadata
  total_val <- if ("VALUE" %in% names(dt)) sum(dt$VALUE, na.rm = TRUE) else NA_real_
  meta <- list(
    timestamp   = ts,
    datetime    = format(Sys.time(), "%Y-%m-%d %H:%M:%S"),
    variable    = variable,
    description = description,
    rows        = nrow(dt),
    total       = total_val
  )
  jsonlite::write_json(meta, file.path(snap_dir, "meta.json"),
                       auto_unbox = TRUE, pretty = TRUE)
  ts
}

#' Return list of snapshots for a variable (most recent first)
get_history <- function(variable) {
  snap_root <- file.path(SAVES_DIR, variable)
  if (!dir.exists(snap_root)) return(list())

  dirs <- list.dirs(snap_root, full.names = TRUE, recursive = FALSE)
  if (length(dirs) == 0) return(list())

  history <- lapply(dirs, function(d) {
    meta_file <- file.path(d, "meta.json")
    if (file.exists(meta_file)) {
      jsonlite::read_json(meta_file)
    } else {
      list(timestamp = basename(d), datetime = basename(d),
           description = "", rows = NA, total = NA)
    }
  })

  # Sort descending by timestamp
  history[order(sapply(history, `[[`, "timestamp"), decreasing = TRUE)]
}

#' Restore data from a snapshot; also overwrites the main file
restore_state <- function(variable, timestamp) {
  data_file <- file.path(SAVES_DIR, variable, timestamp, paste0(variable, ".csv"))
  if (!file.exists(data_file)) {
    stop(paste("Snapshot introuvable:", timestamp))
  }
  dt <- data.table::fread(data_file, encoding = "UTF-8")
  if ("VALUE" %in% names(dt)) dt[, VALUE := suppressWarnings(as.numeric(VALUE))]
  # Overwrite main file
  save_variable_data(variable, dt)
  dt
}

# ---- JSON serialisation helper ------------------------------

#' Convert a data.table to a plain list suitable for toJSON
dt_to_records <- function(dt) {
  df <- as.data.frame(dt)
  lapply(seq_len(nrow(df)), function(i) as.list(df[i, , drop = FALSE]))
}
