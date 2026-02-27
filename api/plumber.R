# =============================================================
# api/plumber.R - RegionalUI REST API (Plumber)
# =============================================================

library(plumber)
library(data.table)
library(openxlsx2)
library(jsonlite)

# Source helpers (paths relative to working directory = project root)
source("api/utils.R")
source("api/operations.R")

# Static files are served via pr_static() in start.R

# ---- CORS filter -------------------------------------------
#* @filter cors
function(req, res) {
  res$setHeader("Access-Control-Allow-Origin",  "*")
  res$setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res$setHeader("Access-Control-Allow-Headers", "Content-Type, Accept")

  if (identical(req$REQUEST_METHOD, "OPTIONS")) {
    res$status <- 200
    return(list())
  }
  plumber::forward()
}

# ============================================================
# Variable endpoints
# ============================================================

#* List available variables
#* @get /api/variables
#* @serializer unboxedJSON
function() {
  tryCatch(
    list_variables(),
    error = function(e) list(error = conditionMessage(e))
  )
}

#* Get full data for a variable
#* @param variable Variable name
#* @get /api/data/<variable>
#* @serializer unboxedJSON
function(variable) {
  tryCatch({
    dt      <- load_variable_data(variable)
    year_col <- get_year_col(dt)
    years    <- get_years(dt)

    list(
      variable    = variable,
      columns     = as.list(names(dt)),
      year_column = year_col,
      years       = if (is.null(years)) list() else as.list(years),
      data        = dt_to_records(dt),
      total_rows  = nrow(dt)
    )
  }, error = function(e) list(error = conditionMessage(e)))
}

# ============================================================
# Cell / data update
# ============================================================

#* Commit in-memory data to disk (called by the frontend's "Valider" button)
#* Expects JSON body: { "data": [ {row}, ... ] }
#* @param variable Variable name
#* @post /api/data/<variable>/commit
#* @serializer unboxedJSON
function(variable, req) {
  tryCatch({
    body <- jsonlite::fromJSON(req$postBody, simplifyVector = FALSE)
    if (is.null(body$data) || length(body$data) == 0)
      stop("Aucune donnee fournie.")

    dt <- rbindlist(lapply(body$data, as.data.table), fill = TRUE)
    if ("VALUE" %in% names(dt))
      dt[, VALUE := suppressWarnings(as.numeric(VALUE))]

    save_variable_data(variable, dt)
    list(success = TRUE, message = "Donnees enregistrees sur le disque.")
  }, error = function(e) list(success = FALSE, error = conditionMessage(e)))
}

# ============================================================
# History / snapshots
# ============================================================

#* Create a snapshot of current data
#* Expects JSON body: { "data": [ {row}, ... ], "description": "..." }
#* @param variable Variable name
#* @post /api/data/<variable>/save
#* @serializer unboxedJSON
function(variable, req) {
  tryCatch({
    body        <- jsonlite::fromJSON(req$postBody, simplifyVector = FALSE)
    description <- if (!is.null(body$description)) body$description else ""

    # Build dt from provided data
    if (!is.null(body$data) && length(body$data) > 0) {
      dt <- rbindlist(lapply(body$data, as.data.table), fill = TRUE)
      if ("VALUE" %in% names(dt))
        dt[, VALUE := suppressWarnings(as.numeric(VALUE))]
    } else {
      dt <- load_variable_data(variable)
    }

    ts <- save_state(variable, dt, description)
    list(success = TRUE, timestamp = ts,
         message = paste("Snapshot cree:", ts))
  }, error = function(e) list(success = FALSE, error = conditionMessage(e)))
}

#* Get snapshot history for a variable
#* @param variable Variable name
#* @get /api/data/<variable>/history
#* @serializer unboxedJSON
function(variable) {
  tryCatch(
    get_history(variable),
    error = function(e) list(error = conditionMessage(e))
  )
}

#* Restore data from a snapshot
#* Expects JSON body: { "timestamp": "..." }
#* @param variable Variable name
#* @post /api/data/<variable>/restore
#* @serializer unboxedJSON
function(variable, req) {
  tryCatch({
    body      <- jsonlite::fromJSON(req$postBody)
    timestamp <- body$timestamp
    dt        <- restore_state(variable, timestamp)
    list(
      success = TRUE,
      message = paste("Donnees restaurees depuis:", timestamp),
      data    = dt_to_records(dt)
    )
  }, error = function(e) list(success = FALSE, error = conditionMessage(e)))
}

# ============================================================
# Operations
# ============================================================

#* List available operations
#* @get /api/operations
#* @serializer unboxedJSON
function() {
  get_operations_list()
}

#* Apply an operation to a variable's data (returns modified data, does NOT save)
#* Expects JSON body:
#*   { "variable": "...", "params": {...},
#*     "selection": ["CODE1", ...],   <- optional
#*     "year": 2020 }                 <- optional
#* @param operation Operation id
#* @post /api/operations/<operation>
#* @serializer unboxedJSON
function(operation, req) {
  tryCatch({
    body      <- jsonlite::fromJSON(req$postBody, simplifyVector = FALSE)
    variable  <- body$variable
    params    <- if (!is.null(body$params))    body$params    else list()
    selection <- if (!is.null(body$selection)) unlist(body$selection) else NULL
    year      <- if (!is.null(body$year))      body$year      else NULL

    dt       <- load_variable_data(variable)
    year_col <- get_year_col(dt)

    dt_mod <- apply_operation(
      operation = operation,
      dt        = dt,
      params    = params,
      selection = selection,
      year_col  = year_col,
      year      = year
    )

    list(
      success   = TRUE,
      variable  = variable,
      operation = operation,
      data      = dt_to_records(dt_mod)
    )
  }, error = function(e) list(success = FALSE, error = conditionMessage(e)))
}
