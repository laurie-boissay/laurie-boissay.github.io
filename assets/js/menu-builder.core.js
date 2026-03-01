/* ==============================================================================
menu-builder.core.js — UI (state + init + IO)
==============================================================================
Rôle
- Définir l’état UI (state) + cache DOM.
- Valider les préconditions (DOM + MenuEngine).
- Charger recipes.json et construire les pools via MenuEngine.
- Exposer un namespace global MenuBuilder utilisé par les autres modules UI.

Contrats
- Ne contient pas de logique de rendu détaillée (voir menu-builder.render.js).
- Ne contient pas de logique modale (voir menu-builder.modals.js).
- Ne contient pas la délégation d’événements (voir menu-builder.actions.js).
============================================================================== */

"use strict";

(function attachMenuBuilderCore(global) {
  const MenuBuilder = (global.MenuBuilder = global.MenuBuilder || {});

  // ---------------------------------------------------------------------------
  // État unique (source de vérité)
  // ---------------------------------------------------------------------------

  MenuBuilder.state = {
    recipes: [],
    pools: {},
    // menu[day][meal] = { slots: [ { type, recipe, locked } ] }
    menu: [],
    // contextes temporaires pour modales
    addCtx: null, // { day, meal }
    pickCtx: null, // { day, meal, slot }
  };

  // ---------------------------------------------------------------------------
  // Constantes UI
  // ---------------------------------------------------------------------------

  MenuBuilder.DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

  MenuBuilder.MEAL_LABELS_BY_COUNT = {
    1: ["Déjeuner"],
    2: ["Déjeuner", "Dîner"],
    3: ["Petit déjeuner", "Déjeuner", "Dîner"],
    4: ["Petit déjeuner", "Déjeuner", "Goûter", "Dîner"],
    5: ["Petit déjeuner", "Collation", "Déjeuner", "Goûter", "Dîner"],
  };

  MenuBuilder.DEFAULT_SLOT_TYPE = "Plat";

  // Initialisé au DOMContentLoaded via MenuEngine.getSlotTypes()
  MenuBuilder.SLOT_TYPES = [];
  MenuBuilder.ADD_SLOT_TYPES = [];

  // ---------------------------------------------------------------------------
  // Cache DOM + cache modals
  // ---------------------------------------------------------------------------

  MenuBuilder.dom = {
    root: null,
    message: null,
    generateBtn: null,
    weekStart: null,
    mealsPerDay: null,
    daysCount: null,
    carbMax: null,
    fatMax: null,
    calorieTargetDay: null,
    weightKg: null,
    proteinTargetDay: null,
    grid: null,
  };

  MenuBuilder.modalCache = new Map();

  // ---------------------------------------------------------------------------
  // Utils partagés (utilisés par plusieurs modules)
  // ---------------------------------------------------------------------------

  MenuBuilder.getBaseUrl = function getBaseUrl() {
    return (MenuBuilder.dom.root?.dataset?.baseurl || "").replace(/\/$/, "");
  };

  MenuBuilder.withBaseUrl = function withBaseUrl(path) {
    const baseurl = MenuBuilder.getBaseUrl();
    const safePath = String(path || "").startsWith("/") ? path : `/${path}`;
    return `${baseurl}${safePath}`;
  };

  MenuBuilder.normalizeRecipeUrl = function normalizeRecipeUrl(url) {
    const u = String(url || "").trim();
    if (!u) return "#";
    if (u.startsWith("/")) return MenuBuilder.withBaseUrl(u);
    return u;
  };

  MenuBuilder.escapeHtml = function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  };

  MenuBuilder.readIntFromEl = function readIntFromEl(el, fallback, min, max) {
    const raw = parseInt(el?.value ?? "", 10);
    const n = Number.isFinite(raw) ? raw : fallback;
    return Math.max(min, Math.min(max, n));
  };

  MenuBuilder.readFloatFromEl = function readFloatFromEl(el, fallback, min, max) {
    const raw = String(el?.value ?? "")
      .trim()
      .replace(",", ".");
    const n = parseFloat(raw);
    const safe = Number.isFinite(n) ? n : fallback;
    return Math.max(min, Math.min(max, safe));
  };

  /**
   * Lecture canonique des paramètres UI.
   * Contrat : doit matcher les attentes de menu-builder.actions.js
   */
  MenuBuilder.readParams = function readParams() {
    const mealsPerDay = MenuBuilder.readIntFromEl(MenuBuilder.dom.mealsPerDay, 3, 1, 5);
    const weekStart = MenuBuilder.readIntFromEl(MenuBuilder.dom.weekStart, 1, 0, 6);

    const daysCount = MenuBuilder.readIntFromEl(MenuBuilder.dom.daysCount, 3, 1, 7);

    const calorieMax = MenuBuilder.readIntFromEl(MenuBuilder.dom.calorieTargetDay, 0, 0, 99999);
    const carbMax = MenuBuilder.readFloatFromEl(MenuBuilder.dom.carbMax, 0, 0, 99999);
    const fatMax = MenuBuilder.readFloatFromEl(MenuBuilder.dom.fatMax, 0, 0, 99999);

    // Optionnel : utilisé uniquement pour pré-remplir et/ou valider l’objectif protéines.
    const weightKg = MenuBuilder.readFloatFromEl(MenuBuilder.dom.weightKg, 0, 0, 99999);
    const proteinTargetDay = MenuBuilder.readFloatFromEl(MenuBuilder.dom.proteinTargetDay, 0, 0, 99999);

    return { mealsPerDay, weekStart, daysCount, calorieMax, carbMax, fatMax, weightKg, proteinTargetDay };
  };

  // Messages
  MenuBuilder.showMessage = function showMessage(text, type = "secondary") {
    const box = MenuBuilder.dom.message || document.getElementById("menuMessage");
    if (!box) return;

    box.classList.remove("d-none", "alert-secondary", "alert-danger", "alert-success", "alert-warning");
    box.classList.add(`alert-${type}`);
    box.textContent = text;
  };

  MenuBuilder.hideMessage = function hideMessage() {
    const box = MenuBuilder.dom.message || document.getElementById("menuMessage");
    if (!box) return;
    box.classList.add("d-none");
    box.textContent = "";
  };

  // ---------------------------------------------------------------------------
  // IO : chargement recettes
  // ---------------------------------------------------------------------------

  MenuBuilder.loadRecipes = async function loadRecipes() {
    const url = MenuBuilder.withBaseUrl("/assets/data/recipes.json");

    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        MenuBuilder.showMessage(`Impossible de charger les recettes (${res.status}). URL: ${url}`, "danger");
        MenuBuilder.state.recipes = [];
        MenuBuilder.state.pools = {};
        return;
      }

      const data = await res.json();
      MenuBuilder.state.recipes = Array.isArray(data) ? data : [];

      if (MenuBuilder.state.recipes.length === 0) {
        MenuBuilder.showMessage("recipes.json est chargé mais vide (aucune recette layout: recipe).", "warning");
        MenuBuilder.state.pools = {};
        return;
      }

      // Source unique des types : MenuEngine gère la liste (pas injectée depuis l’UI).
      MenuBuilder.state.pools = global.MenuEngine.buildPools(MenuBuilder.state.recipes);

      MenuBuilder.hideMessage();
    } catch (err) {
      MenuBuilder.showMessage(`Erreur lors du chargement des recettes : ${String(err)} (URL: ${url})`, "danger");
      MenuBuilder.state.recipes = [];
      MenuBuilder.state.pools = {};
    }
  };

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", async () => {
    const requiredIds = [
      "menu-builder-root",
      "menuMessage",
      "generateMenu",
      "weekStart",
      "mealsPerDay",
      "daysCount",
      "carbMax",
      "fatMax",
      "calorieTargetDay",
      "weightKg",
      "proteinTargetDay",
      "menuGrid",
    ];

    const missing = requiredIds.filter((id) => !document.getElementById(id));
    if (missing.length > 0) {
      MenuBuilder.showMessage(
        `Menu builder : éléments DOM manquants (${missing.join(", ")}). Vérifie les IDs dans le HTML.`,
        "danger"
      );
      return;
    }

    if (!global.MenuEngine) {
      MenuBuilder.showMessage(
        "Menu builder : MenuEngine introuvable. Vérifie que menu-engine.js est chargé avant les scripts menu-builder.",
        "danger"
      );
      return;
    }

    if (typeof global.MenuEngine.getSlotTypes !== "function") {
      MenuBuilder.showMessage(
        "Menu builder : MenuEngine.getSlotTypes() introuvable. Mets à jour menu-engine.js (source unique des types).",
        "danger"
      );
      return;
    }

    // Cache DOM
    MenuBuilder.dom.root = document.getElementById("menu-builder-root");
    MenuBuilder.dom.message = document.getElementById("menuMessage");
    MenuBuilder.dom.generateBtn = document.getElementById("generateMenu");
    MenuBuilder.dom.weekStart = document.getElementById("weekStart");
    MenuBuilder.dom.mealsPerDay = document.getElementById("mealsPerDay");
    MenuBuilder.dom.daysCount = document.getElementById("daysCount");
    MenuBuilder.dom.carbMax = document.getElementById("carbMax");
    MenuBuilder.dom.fatMax = document.getElementById("fatMax");
    MenuBuilder.dom.calorieTargetDay = document.getElementById("calorieTargetDay");
    MenuBuilder.dom.weightKg = document.getElementById("weightKg");
    MenuBuilder.dom.proteinTargetDay = document.getElementById("proteinTargetDay");
    MenuBuilder.dom.grid = document.getElementById("menuGrid");

    // Source unique : types fournis par MenuEngine
    MenuBuilder.SLOT_TYPES = global.MenuEngine.getSlotTypes();
    if (!Array.isArray(MenuBuilder.SLOT_TYPES) || MenuBuilder.SLOT_TYPES.length === 0) {
      MenuBuilder.showMessage("Menu builder : liste de types vide (MenuEngine.getSlotTypes).", "danger");
      return;
    }
    MenuBuilder.ADD_SLOT_TYPES = MenuBuilder.SLOT_TYPES.slice();

    // Wiring : on évite de planter si actions.js n’est pas chargé / pas encore défini.
    MenuBuilder.dom.generateBtn.addEventListener("click", () => {
      if (typeof MenuBuilder.generateMenu !== "function") {
        MenuBuilder.showMessage(
          "Menu builder : generateMenu() introuvable. Vérifie que menu-builder.actions.js est chargé (et sans erreur).",
          "danger"
        );
        return;
      }
      MenuBuilder.generateMenu();
    });

    MenuBuilder.setupCalorieTargetSync?.();
    MenuBuilder.setupProteinTargetSync?.();
    MenuBuilder.setupMenuInteractions?.();
    MenuBuilder.ensureAddSlotModalExists?.();
    MenuBuilder.ensurePickRecipeModalExists?.();

    await MenuBuilder.loadRecipes();
  });
})(window);
