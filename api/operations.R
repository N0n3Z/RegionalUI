# =============================================================
# api/operations.R - Data operations for RegionalUI
# Add new operations here; they appear automatically in the UI.
# =============================================================

library(data.table)

# ---- Operation registry -------------------------------------

#' Return the full list of available operations with metadata.
#' Each operation has:
#'   id          : unique identifier used in the API route
#'   label       : human-readable name shown in the context menu
#'   description : tooltip description
#'   scope       : list of contexts where the operation is applicable
#'                 ("dataset", "selection", "cell")
#'   params      : list of parameter definitions for the dialog
get_operations_list <- function() {
  list(
    list(
      id          = "adjust_total",
      label       = "Ajuster au total cible",
      description = "Redimensionne proportionnellement toutes les valeurs pour que leur somme atteigne la cible.",
      scope       = list("dataset", "selection"),
      params      = list(
        list(id = "target", label = "Total cible", type = "number", required = TRUE, default = NULL)
      )
    ),
    list(
      id          = "apply_growth_rate",
      label       = "Appliquer un taux de croissance",
      description = "Multiplie chaque valeur par (1 + taux/100).",
      scope       = list("dataset", "selection"),
      params      = list(
        list(id = "rate", label = "Taux (%)", type = "number", required = TRUE, default = 2)
      )
    ),
    list(
      id          = "multiply_by",
      label       = "Multiplier par un facteur",
      description = "Multiplie les valeurs sélectionnées par un facteur constant.",
      scope       = list("dataset", "selection", "cell"),
      params      = list(
        list(id = "factor", label = "Facteur", type = "number", required = TRUE, default = 1)
      )
    ),
    list(
      id          = "add_constant",
      label       = "Ajouter une constante",
      description = "Ajoute une valeur constante aux valeurs sélectionnées.",
      scope       = list("dataset", "selection", "cell"),
      params      = list(
        list(id = "value", label = "Valeur à ajouter", type = "number", required = TRUE, default = 0)
      )
    ),
    list(
      id          = "set_value",
      label       = "Fixer une valeur",
      description = "Remplace les valeurs sélectionnées par une valeur fixe.",
      scope       = list("selection", "cell"),
      params      = list(
        list(id = "value", label = "Nouvelle valeur", type = "number", required = TRUE, default = NULL)
      )
    ),
    list(
      id          = "apply_floor_ceiling",
      label       = "Appliquer min / max",
      description = "Borne les valeurs entre un minimum et/ou un maximum.",
      scope       = list("dataset", "selection"),
      params      = list(
        list(id = "floor",   label = "Minimum (laisser vide = aucun)", type = "number", required = FALSE, default = NULL),
        list(id = "ceiling", label = "Maximum (laisser vide = aucun)", type = "number", required = FALSE, default = NULL)
      )
    ),
    list(
      id          = "redistribute_uniform",
      label       = "Redistribuer uniformément",
      description = "Distribue un total de manière égale entre toutes les unités.",
      scope       = list("dataset", "selection"),
      params      = list(
        list(id = "total", label = "Total à distribuer", type = "number", required = TRUE, default = NULL)
      )
    ),
    list(
      id          = "interpolate_linear",
      label       = "Interpolation linéaire (entre années)",
      description = "Interpole linéairement les valeurs pour les années intermédiaires entre year_from et year_to.",
      scope       = list("dataset"),
      params      = list(
        list(id = "year_from", label = "Année de départ",  type = "number", required = TRUE, default = NULL),
        list(id = "year_to",   label = "Année d'arrivée", type = "number", required = TRUE, default = NULL)
      )
    ),
    list(
      id          = "copy_year",
      label       = "Copier une année",
      description = "Copie les valeurs d'une année vers une autre (écrase les valeurs existantes).",
      scope       = list("dataset"),
      params      = list(
        list(id = "year_from", label = "Année source", type = "number", required = TRUE, default = NULL),
        list(id = "year_to",   label = "Année cible",  type = "number", required = TRUE, default = NULL)
      )
    ),
    list(
      id          = "smooth_moving_average",
      label       = "Lissage par moyenne mobile",
      description = "Lisse les séries temporelles par territoire via une moyenne mobile symétrique.",
      scope       = list("dataset"),
      params      = list(
        list(id = "window", label = "Fenêtre (nb d'années)", type = "integer", required = TRUE, default = 3)
      )
    )
  )
}

# ---- Operation dispatcher -----------------------------------

#' Apply a named operation to a data.table.
#'
#' @param operation  character — operation id
#' @param dt         data.table — full dataset
#' @param params     named list — operation parameters (strings from the form)
#' @param selection  character vector — TERRITORIAL_CODE to restrict to, or NULL
#' @param year_col   character — name of the year column, or NULL
#' @param year       scalar — restrict to this year, or NULL
#' @return modified data.table (copy)
apply_operation <- function(operation, dt, params,
                            selection = NULL, year_col = NULL, year = NULL) {
  dt <- data.table::copy(dt)

  # Build row mask -----------------------------------------------
  mask <- rep(TRUE, nrow(dt))

  if (!is.null(selection) && length(selection) > 0) {
    mask <- mask & (dt$TERRITORIAL_CODE %in% selection)
  }

  if (!is.null(year) && !is.null(year_col) && year_col %in% names(dt)) {
    mask <- mask & (as.character(dt[[year_col]]) == as.character(year))
  }

  # Helper: parse numeric param
  num <- function(p) {
    v <- params[[p]]
    if (is.null(v) || identical(v, "") || identical(v, "null")) return(NA_real_)
    as.numeric(v)
  }

  # Dispatch ----------------------------------------------------
  switch(operation,

    "adjust_total" = {
      target        <- num("target")
      if (is.na(target)) stop("Parametre 'target' manquant.")
      current_total <- sum(dt[mask, VALUE], na.rm = TRUE)
      if (current_total == 0) stop("La somme actuelle est 0, impossible d'ajuster.")
      dt[mask, VALUE := VALUE * (target / current_total)]
    },

    "apply_growth_rate" = {
      rate <- num("rate")
      if (is.na(rate)) stop("Parametre 'rate' manquant.")
      dt[mask, VALUE := VALUE * (1 + rate / 100)]
    },

    "multiply_by" = {
      factor <- num("factor")
      if (is.na(factor)) stop("Parametre 'factor' manquant.")
      dt[mask, VALUE := VALUE * factor]
    },

    "add_constant" = {
      value <- num("value")
      if (is.na(value)) stop("Parametre 'value' manquant.")
      dt[mask, VALUE := VALUE + value]
    },

    "set_value" = {
      value <- num("value")
      if (is.na(value)) stop("Parametre 'value' manquant.")
      dt[mask, VALUE := value]
    },

    "apply_floor_ceiling" = {
      fl  <- num("floor")
      cel <- num("ceiling")
      if (!is.na(fl))  dt[mask, VALUE := pmax(VALUE, fl,  na.rm = TRUE)]
      if (!is.na(cel)) dt[mask, VALUE := pmin(VALUE, cel, na.rm = TRUE)]
    },

    "redistribute_uniform" = {
      total <- num("total")
      if (is.na(total)) stop("Parametre 'total' manquant.")
      n <- sum(mask)
      if (n == 0) stop("Aucune ligne dans la selection.")
      dt[mask, VALUE := total / n]
    },

    "interpolate_linear" = {
      if (is.null(year_col) || !year_col %in% names(dt))
        stop("Aucune colonne annee trouvee pour l'interpolation.")
      yf <- as.numeric(num("year_from"))
      yt <- as.numeric(num("year_to"))
      if (is.na(yf) || is.na(yt)) stop("Annees manquantes.")
      if (yf >= yt) stop("L'annee de depart doit etre inferieure a l'annee d'arrivee.")

      codes <- unique(dt$TERRITORIAL_CODE)
      years_between <- setdiff(seq(yf, yt), c(yf, yt))

      for (code in codes) {
        val_f <- dt[TERRITORIAL_CODE == code & get(year_col) == yf, VALUE]
        val_t <- dt[TERRITORIAL_CODE == code & get(year_col) == yt, VALUE]
        if (length(val_f) == 0 || length(val_t) == 0 ||
            is.na(val_f[1]) || is.na(val_t[1])) next

        for (yr in years_between) {
          t_frac <- (yr - yf) / (yt - yf)
          interp <- val_f[1] + t_frac * (val_t[1] - val_f[1])
          rows_exist <- nrow(dt[TERRITORIAL_CODE == code & get(year_col) == yr]) > 0
          if (rows_exist) {
            dt[TERRITORIAL_CODE == code & get(year_col) == yr, VALUE := interp]
          }
        }
      }
    },

    "copy_year" = {
      if (is.null(year_col) || !year_col %in% names(dt))
        stop("Aucune colonne annee trouvee pour la copie.")
      yf <- as.numeric(num("year_from"))
      yt <- as.numeric(num("year_to"))
      if (is.na(yf) || is.na(yt)) stop("Annees manquantes.")

      src <- dt[get(year_col) == yf, .(TERRITORIAL_CODE, VALUE)]
      if (nrow(src) == 0) stop(paste("Aucune donnee pour l'annee source", yf))

      for (i in seq_len(nrow(src))) {
        code <- src$TERRITORIAL_CODE[i]
        val  <- src$VALUE[i]
        if (nrow(dt[TERRITORIAL_CODE == code & get(year_col) == yt]) > 0) {
          dt[TERRITORIAL_CODE == code & get(year_col) == yt, VALUE := val]
        }
      }
    },

    "smooth_moving_average" = {
      if (is.null(year_col) || !year_col %in% names(dt))
        stop("Aucune colonne annee trouvee pour le lissage.")
      window <- as.integer(num("window"))
      if (is.na(window) || window < 2) stop("La fenetre doit etre >= 2.")

      half_w <- floor(window / 2)
      years  <- sort(unique(as.numeric(dt[[year_col]])))
      codes  <- unique(dt$TERRITORIAL_CODE)

      # Work on a copy of VALUES to avoid using already-smoothed values
      dt_orig <- data.table::copy(dt)

      for (code in codes) {
        for (yr in years) {
          yr_range <- years[abs(years - yr) <= half_w]
          vals <- dt_orig[TERRITORIAL_CODE == code & get(year_col) %in% yr_range, VALUE]
          avg  <- mean(vals, na.rm = TRUE)
          dt[TERRITORIAL_CODE == code & get(year_col) == yr, VALUE := avg]
        }
      }
    },

    # Default: unknown operation
    stop(paste("Operation inconnue:", operation))
  )

  dt
}
