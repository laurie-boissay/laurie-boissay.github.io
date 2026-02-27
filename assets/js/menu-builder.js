/* ==============================================================================
menu-builder.js — UI + orchestration (Menu hebdomadaire)
==============================================================================
Rôle
- Piloter l’interface (DOM) du générateur de menu hebdomadaire.
- Charger recipes.json et initialiser l’état.
- Déléguer la logique “métier” (tirage, plafonds, calculs) à MenuEngine.

Dépendances
- window.MenuEngine (chargé AVANT ce fichier).
- Bootstrap 5 (modals + collapse).

Contrats
- Format menu : menu[day][meal] = { slots: [ { type, recipe, locked } ] }.
- La grille propose les recipe_group officiels (SLOT_TYPES) fournis par MenuEngine.
- Le modal “Ajouter un slot” propose les mêmes groupes (pas de catégorie "other").
============================================================================== */

"use strict";

/* =========================
   État unique (source de vérité)
   ========================= */

const state = {
  recipes: [],
  pools: {},
  // state.menu[day][meal] = { slots: [ { type, recipe, locked } ] }
  menu: [],
  // Contextes temporaires pour modales
  addCtx: null, // { day, meal }
  pickCtx: null, // { day, meal, slot }
};

/* =========================
   Constantes UI
   ========================= */

const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

const MEAL_LABELS_BY_COUNT = {
  1: ["Déjeuner"],
  2: ["Déjeuner", "Dîner"],
  3: ["Petit déjeuner", "Déjeuner", "Dîner"],
  4: ["Petit déjeuner", "Déjeuner", "Goûter", "Dîner"],
  5: ["Petit déjeuner", "Collation", "Déjeuner", "Goûter", "Dîner"],
};

// Source unique : MenuEngine fournit les types.
// Initialisé à DOMContentLoaded.
let SLOT_TYPES = [];
let ADD_SLOT_TYPES = [];

// Groupe de repli utilisé lorsque le contexte ne permet pas d’inférer un type.
const DEFAULT_SLOT_TYPE = "Plat";

/* =========================
   Cache DOM + cache modals
   ========================= */

/**
 * Contrat : initialisé au DOMContentLoaded, jamais réassigné ensuite.
 * But : éviter les getElementById/querySelector répétitifs.
 */
const dom = {
  root: null,
  message: null,
  generateBtn: null,
  weekStart: null,
  mealsPerDay: null,
  calorieTargetDay: null,
  grid: null,
};

const modalCache = new Map(); // id -> bootstrap.Modal instance

/* =========================
   Bootstrap / initialisation
   ========================= */

document.addEventListener("DOMContentLoaded", async () => {
  // Préconditions DOM : si une ID manque, on arrête avec un message utile.
  const requiredIds = [
    "menu-builder-root",
    "menuMessage",
    "generateMenu",
    "weekStart",
    "mealsPerDay",
    "calorieTargetDay",
    "menuGrid",
  ];

  const missing = requiredIds.filter((id) => !document.getElementById(id));
  if (missing.length > 0) {
    showMessage(
      `Menu builder : éléments DOM manquants (${missing.join(", ")}). Vérifie les IDs dans le HTML.`,
      "danger"
    );
    return;
  }

  if (!window.MenuEngine) {
    showMessage(
      "Menu builder : MenuEngine introuvable. Vérifie que menu-engine.js est chargé avant menu-builder.js.",
      "danger"
    );
    return;
  }

  if (typeof window.MenuEngine.getSlotTypes !== "function") {
    showMessage(
      "Menu builder : MenuEngine.getSlotTypes() introuvable. Ajoute l’API côté menu-engine.js (source unique des types).",
      "danger"
    );
    return;
  }

  // Cache DOM
  dom.root = document.getElementById("menu-builder-root");
  dom.message = document.getElementById("menuMessage");
  dom.generateBtn = document.getElementById("generateMenu");
  dom.weekStart = document.getElementById("weekStart");
  dom.mealsPerDay = document.getElementById("mealsPerDay");
  dom.calorieTargetDay = document.getElementById("calorieTargetDay");
  dom.grid = document.getElementById("menuGrid");

  // Source unique des types (MenuEngine)
  SLOT_TYPES = window.MenuEngine.getSlotTypes();
  if (!Array.isArray(SLOT_TYPES) || SLOT_TYPES.length === 0) {
    showMessage("Menu builder : MenuEngine.getSlotTypes() a renvoyé une liste vide. Impossible de construire la grille.", "danger");
    return;
  }

  // Pour l’instant, même liste (filtrage possible plus tard sans changer la source unique).
  // Note : on copie la liste pour éviter toute dépendance à une référence partagée.
  ADD_SLOT_TYPES = SLOT_TYPES.slice();

  dom.generateBtn.addEventListener("click", generateMenu);

  setupCalorieTargetSync();
  setupMenuInteractions();

  ensureAddSlotModalExists();
  ensurePickRecipeModalExists();

  await loadRecipes();
});

/* =========================
   Base URL GitHub Pages
   ========================= */

function getBaseUrl() {
  return (dom.root?.dataset?.baseurl || "").replace(/\/$/, "");
}

function withBaseUrl(path) {
  const baseurl = getBaseUrl();
  const safePath = String(path || "").startsWith("/") ? path : `/${path}`;
  return `${baseurl}${safePath}`;
}

/**
 * Normalise une URL de recette :
 * - si relative au site (ex. "/recettes/x.html"), on applique baseurl.
 * - sinon, on laisse tel quel.
 */
function normalizeRecipeUrl(url) {
  const u = String(url || "").trim();
  if (!u) return "#";
  if (u.startsWith("/")) return withBaseUrl(u);
  return u;
}

/* =========================
   Messages
   ========================= */

function showMessage(text, type = "secondary") {
  const box = dom.message || document.getElementById("menuMessage");
  if (!box) return;

  box.classList.remove("d-none", "alert-secondary", "alert-danger", "alert-success", "alert-warning");
  box.classList.add(`alert-${type}`);
  box.textContent = text;
}

function hideMessage() {
  const box = dom.message || document.getElementById("menuMessage");
  if (!box) return;
  box.classList.add("d-none");
  box.textContent = "";
}

/* =========================
   Lecture des paramètres UI
   ========================= */

function readParams() {
  const mealsPerDay = readIntFromEl(dom.mealsPerDay, 3, 1, 5);
  const weekStart = readIntFromEl(dom.weekStart, 1, 0, 6);
  const calorieMax = readIntFromEl(dom.calorieTargetDay, 0, 0, 99999);
  return { mealsPerDay, weekStart, calorieMax };
}

/* =========================
   Sync kcal/jour (écrasement forcé)
   ========================= */

function setupCalorieTargetSync() {
  const targetInput = dom.calorieTargetDay || document.getElementById("calorieTargetDay");
  if (!targetInput) return;

  const applyValue = (kcal) => {
    const n = parseInt(kcal, 10);
    if (!Number.isFinite(n) || n <= 0) return false;
    targetInput.value = String(n);
    return true;
  };

  // Canal “officiel” : l’include calorie-target.html peut émettre un event.
  window.addEventListener("calorieTargetUpdated", (e) => {
    if (e?.detail?.kcal) applyValue(e.detail.kcal);
  });

  // Fallbacks : variable globale / localStorage / lecture DOM opportuniste.
  if (typeof window.calorieTargetKcal === "number") applyValue(window.calorieTargetKcal);

  const storageKeys = [
    "calorieTargetKcal",
    "calorie_target_kcal",
    "calorieTarget",
    "calorie_target",
    "kcalTarget",
    "kcal_target",
  ];
  for (const k of storageKeys) {
    try {
      const v = localStorage.getItem(k);
      if (v) applyValue(v);
    } catch (_) {}
  }

  const candidateSelectors = [
    "[data-calorie-target]",
    "#ct-target-kcal",
    "#calorieTarget",
    "#calorie-target",
    "#calorieTargetValue",
    "#calorie-target-value",
  ];

  const tryReadFromDom = () => {
    for (const sel of candidateSelectors) {
      const el = document.querySelector(sel);
      if (!el) continue;

      if ("value" in el && el.value) {
        if (applyValue(el.value)) return;
      }

      const dt = el.getAttribute("data-calorie-target");
      if (dt) {
        if (applyValue(dt)) return;
      }

      const txt = (el.textContent || "").trim();
      const m = txt.match(/(\d{3,4})/);
      if (m) {
        if (applyValue(m[1])) return;
      }
    }
  };

  tryReadFromDom();

  // Observation : utile si l’include est injecté tardivement.
  // On garde l’observer mais on évite de faire trop de boulot à chaque mutation.
  let pending = false;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      tryReadFromDom();
    });
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

/* =========================
   Chargement recettes + pools
   ========================= */

async function loadRecipes() {
  const url = withBaseUrl("/assets/data/recipes.json");

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      showMessage(`Impossible de charger les recettes (${res.status}). URL: ${url}`, "danger");
      state.recipes = [];
      state.pools = {};
      return;
    }

    const data = await res.json();
    state.recipes = Array.isArray(data) ? data : [];

    if (state.recipes.length === 0) {
      showMessage("recipes.json est chargé mais vide (aucune recette layout: recipe).", "warning");
      state.pools = {};
      return;
    }

    // Source unique : buildPools utilise les SLOT_TYPES internes de MenuEngine.
    // Rétrocompat : buildPools(recipes, slotTypes) peut exister, mais on n’injecte plus l’UI.
    state.pools = window.MenuEngine.buildPools(state.recipes);
    hideMessage();
  } catch (err) {
    showMessage(`Erreur lors du chargement des recettes : ${String(err)} (URL: ${url})`, "danger");
    state.recipes = [];
    state.pools = {};
  }
}

/* =========================
   Génération / reroll menu
   ========================= */

function generateMenu() {
  if (!Array.isArray(state.recipes) || state.recipes.length === 0) {
    showMessage("Aucune recette disponible. Le menu ne peut pas être généré.", "danger");
    return;
  }

  hideMessage();

  const { mealsPerDay, weekStart, calorieMax } = readParams();

  const hasExisting = Array.isArray(state.menu) && state.menu.length === 7;
  const baseMenu = hasExisting ? state.menu : window.MenuEngine.createFreshSkeleton(state.pools, mealsPerDay);

  const newMenu = window.MenuEngine.buildMenuUnderCalorieMax(state.pools, baseMenu, mealsPerDay, calorieMax);

  const status = window.MenuEngine.computeCalorieStatus(newMenu, calorieMax);
  if (Number.isFinite(calorieMax) && calorieMax > 0) {
    if (status.overs.length > 0) {
      const days = status.overs.map((x) => `${DAYS[x.dayIndex]} (${x.total} kcal)`).join(", ");
      showMessage(
        `Menu généré, mais certaines journées dépassent le MAX ${calorieMax} kcal/jour. ` +
          `Cause probable : un ou plusieurs slots verrouillés sont trop caloriques. ` +
          `Jours concernés : ${days}. Déverrouille/ajuste des slots, ou augmente le MAX.`,
        "warning"
      );
    } else if (status.empties > 0) {
      showMessage(
        `Menu généré sous le MAX ${calorieMax} kcal/jour, mais ${status.empties} slot(s) n’ont pas pu être remplis ` +
          `sans dépasser le plafond (aucune recette assez légère dans le type).`,
        "warning"
      );
    } else {
      hideMessage();
    }
  }

  state.menu = newMenu;
  renderMenu({ calorieTarget: calorieMax, weekStart, mealsPerDay });
}

function rerender() {
  const { mealsPerDay, weekStart, calorieMax } = readParams();
  renderMenu({ calorieTarget: calorieMax, weekStart, mealsPerDay });
}

/* =========================
   Modal “Ajouter un slot”
   ========================= */

function ensureAddSlotModalExists() {
  if (document.getElementById("addSlotModal")) return;

  const modalHtml = `
<div class="modal fade" id="addSlotModal" tabindex="-1" aria-labelledby="addSlotModalLabel" aria-hidden="true">
  <div class="modal-dialog">
    <div class="modal-content">

      <div class="modal-header">
        <h5 class="modal-title" id="addSlotModalLabel">Ajouter un slot</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fermer"></button>
      </div>

      <div class="modal-body">
        <label class="form-label" for="addSlotType">Type à ajouter</label>
        <select id="addSlotType" class="form-select"></select>
        <div class="form-text mt-2" id="addSlotHint">
          Une recette sera tirée au hasard dans ce type si disponible, en respectant le MAX kcal/jour.
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Annuler</button>
        <button type="button" class="btn btn-primary" id="confirmAddSlot">Ajouter</button>
      </div>

    </div>
  </div>
</div>`;

  const wrap = document.createElement("div");
  wrap.innerHTML = modalHtml;
  document.body.appendChild(wrap.firstElementChild);

  // À chaque ouverture, on recalcule le filtrage des types selon kcal restantes.
  document.getElementById("addSlotModal").addEventListener("shown.bs.modal", () => {
    refreshAddSlotTypeOptions();
  });

  // Nettoyage du contexte si fermeture “manuelle” (ESC/click backdrop).
  document.getElementById("addSlotModal").addEventListener("hidden.bs.modal", () => {
    state.addCtx = null;
  });

  document.getElementById("confirmAddSlot").addEventListener("click", () => {
    if (!state.addCtx) return;

    const typeSelect = document.getElementById("addSlotType");
    const type = String(typeSelect?.value || "");
    const { day, meal } = state.addCtx;

    if (!state.menu?.[day]?.[meal]) return;

    if (!type) {
      showMessage("Impossible d’ajouter : aucune catégorie ne rentre dans les kcal restantes pour ce jour.", "warning");
      return;
    }

    const { calorieMax } = readParams();
    const used = window.MenuEngine.getDayCaloriesFromMenu(state.menu, day);
    const remaining = Number.isFinite(calorieMax) && calorieMax > 0 ? calorieMax - used : Infinity;

    const recipe = window.MenuEngine.pickRecipeWithCalorieLimit(state.pools, type, remaining);

    // Si aucune recette compatible : on re-filtre et on garde le modal ouvert.
    if (Number.isFinite(calorieMax) && calorieMax > 0 && recipe === null) {
      showMessage(
        `Aucune recette "${type}" ne rentre dans les ${Math.max(0, remaining)} kcal restantes pour ce jour. ` +
          `Je retire ce type de la liste.`,
        "warning"
      );
      refreshAddSlotTypeOptions();
      return;
    }

    state.menu[day][meal].slots.push({ type, recipe, locked: false });
    state.addCtx = null;

    closeModal("addSlotModal");
    rerender();
  });
}

/**
 * Rafraîchit les options du select "Type à ajouter" selon :
 * - le jour ciblé (state.addCtx.day)
 * - le MAX kcal/jour et les kcal déjà utilisées
 * - les pools disponibles
 */
function refreshAddSlotTypeOptions() {
  const sel = document.getElementById("addSlotType");
  const hint = document.getElementById("addSlotHint");
  const confirmBtn = document.getElementById("confirmAddSlot");

  if (!sel || !hint || !confirmBtn) return;

  sel.innerHTML = "";

  if (!state.addCtx || !Number.isFinite(state.addCtx.day)) {
    hint.textContent = "Contexte introuvable (jour/repas non sélectionné).";
    sel.disabled = true;
    confirmBtn.disabled = true;
    return;
  }

  const { calorieMax } = readParams();
  const used = window.MenuEngine.getDayCaloriesFromMenu(state.menu, state.addCtx.day);
  const remaining = Number.isFinite(calorieMax) && calorieMax > 0 ? calorieMax - used : Infinity;

  const addable = window.MenuEngine.getAddableTypesForDay(
    state.menu,
    state.pools,
    state.addCtx.day,
    calorieMax,
    ADD_SLOT_TYPES
  );

  hint.textContent =
    Number.isFinite(calorieMax) && calorieMax > 0
      ? `Kcal restantes pour ce jour : ${Math.max(0, remaining)} kcal.`
      : "Aucun MAX kcal/jour défini : toutes les catégories disponibles sont proposées.";

  if (addable.length === 0) {
    sel.disabled = true;
    confirmBtn.disabled = true;
    hint.textContent =
      Number.isFinite(calorieMax) && calorieMax > 0
        ? `Aucune catégorie ne rentre dans les ${Math.max(0, remaining)} kcal restantes pour ce jour.`
        : "Aucune catégorie disponible (pools vides).";
    return;
  }

  for (const t of addable) {
    const opt = document.createElement("option");
    opt.value = t.value;
    opt.textContent = t.label;
    sel.appendChild(opt);
  }

  sel.disabled = false;
  confirmBtn.disabled = false;
}

/* =========================
   Modal “Choisir une recette” (recherche)
   ========================= */

function ensurePickRecipeModalExists() {
  if (document.getElementById("pickRecipeModal")) return;

  const modalHtml = `
<div class="modal fade" id="pickRecipeModal" tabindex="-1" aria-labelledby="pickRecipeModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-lg">
    <div class="modal-content">

      <div class="modal-header">
        <h5 class="modal-title" id="pickRecipeModalLabel">Rechercher une recette</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fermer"></button>
      </div>

      <div class="modal-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-8">
            <label class="form-label" for="pickRecipeQuery">Recherche</label>
            <input id="pickRecipeQuery" type="text" class="form-control" placeholder="Tape un mot (ex : poulet, skyr, crêpe...)">
          </div>

          <div class="col-md-4">
            <div class="form-check mt-4">
              <input class="form-check-input" type="checkbox" id="pickRecipeAllTypes">
              <label class="form-check-label" for="pickRecipeAllTypes">
                Tous groupes (ignore le groupe du slot)
              </label>
            </div>
          </div>
        </div>

        <div class="mt-3">
          <div class="small text-muted mb-2" id="pickRecipeHint"></div>
          <div class="list-group" id="pickRecipeResults"></div>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Fermer</button>
      </div>

    </div>
  </div>
</div>`;

  const wrap = document.createElement("div");
  wrap.innerHTML = modalHtml;
  document.body.appendChild(wrap.firstElementChild);

  const input = document.getElementById("pickRecipeQuery");
  const allTypes = document.getElementById("pickRecipeAllTypes");

  let t = null;
  const trigger = () => {
    if (t) clearTimeout(t);
    t = setTimeout(renderPickResults, 120);
  };

  input.addEventListener("input", trigger);
  allTypes.addEventListener("change", renderPickResults);

  document.getElementById("pickRecipeModal").addEventListener("shown.bs.modal", () => {
    input.value = "";
    allTypes.checked = false;
    input.focus();
    renderPickResults();
  });

  // Nettoyage : si fermeture “manuelle”, on évite un contexte périmé.
  document.getElementById("pickRecipeModal").addEventListener("hidden.bs.modal", () => {
    state.pickCtx = null;
  });
}

function renderPickResults() {
  const results = document.getElementById("pickRecipeResults");
  const hint = document.getElementById("pickRecipeHint");
  const q = String(document.getElementById("pickRecipeQuery")?.value || "").trim().toLowerCase();
  const allTypes = !!document.getElementById("pickRecipeAllTypes")?.checked;

  if (!results || !hint) return;

  results.innerHTML = "";

  if (!state.pickCtx) {
    hint.textContent = "Contexte introuvable (slot non sélectionné).";
    return;
  }

  const slot = state.menu?.[state.pickCtx.day]?.[state.pickCtx.meal]?.slots?.[state.pickCtx.slot];
  if (slot?.locked) {
    hint.textContent = "Slot verrouillé : recherche désactivée.";
    return;
  }

  const slotType = slot?.type || DEFAULT_SLOT_TYPE;
  const baseList = allTypes ? state.recipes : state.pools[slotType] || [];

  hint.textContent = allTypes
    ? `Recherche dans toutes les recettes (groupe du slot : ${slotType}).`
    : `Recherche dans les recettes du groupe : ${slotType}.`;

  let filtered = baseList;
  if (q.length > 0) {
    filtered = baseList.filter((r) => String(r?.title || "").toLowerCase().includes(q));
  }

  filtered = filtered.slice(0, 30);

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "text-muted small";
    empty.textContent = "Aucun résultat.";
    results.appendChild(empty);
    return;
  }

  for (const r of filtered) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "list-group-item list-group-item-action";

    const title = r?.title ?? "Recette sans titre";
    const kcalN = parseInt(r?.calories, 10);
    const kcal = Number.isFinite(kcalN) ? `${kcalN} kcal` : "— kcal";
    const group = r?.recipe_group ? `(${r.recipe_group})` : "";

    btn.innerHTML = `<div class="d-flex justify-content-between gap-2">
      <div><strong>${escapeHtml(title)}</strong> <span class="text-muted">${escapeHtml(group)}</span></div>
      <div class="text-muted">${escapeHtml(kcal)}</div>
    </div>`;

    btn.addEventListener("click", () => applyPickedRecipe(r));
    results.appendChild(btn);
  }
}

function applyPickedRecipe(recipe) {
  if (!state.pickCtx) return;

  const s = state.menu?.[state.pickCtx.day]?.[state.pickCtx.meal]?.slots?.[state.pickCtx.slot];
  if (!s) return;

  if (s.locked) {
    showMessage("Slot verrouillé : tu dois d’abord déverrouiller pour changer la recette.", "warning");
    return;
  }

  const { calorieMax } = readParams();
  const currentSlotKcal = window.MenuEngine.getRecipeCalories(s?.recipe);
  const dayTotal = window.MenuEngine.getDayCaloriesFromMenu(state.menu, state.pickCtx.day);
  const remaining =
    Number.isFinite(calorieMax) && calorieMax > 0
      ? calorieMax - (dayTotal - currentSlotKcal)
      : Infinity;

  const pickedKcal = window.MenuEngine.getRecipeCalories(recipe);
  if (Number.isFinite(calorieMax) && calorieMax > 0 && pickedKcal > remaining) {
    showMessage(
      `Recette trop calorique pour ce jour : ${pickedKcal} kcal (MAX restant : ${Math.max(0, remaining)} kcal).`,
      "warning"
    );
    return;
  }

  s.recipe = recipe;
  s.locked = true;

  // Le modal peut aussi être fermé par l’utilisateur : on force un reset propre ici.
  state.pickCtx = null;

  closeModal("pickRecipeModal");
  rerender();
}

/* =========================
   Interactions UI (+ / − / ↻ / 🔒 / 🔎 / type change)
   ========================= */

function setupMenuInteractions() {
  const grid = dom.grid || document.getElementById("menuGrid");
  if (!grid) return;

  grid.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("button[data-action]");
    if (!btn) return;

    const action = btn.getAttribute("data-action");
    const day = parseInt(btn.getAttribute("data-day"), 10);
    const meal = parseInt(btn.getAttribute("data-meal"), 10);
    const slot = parseInt(btn.getAttribute("data-slot"), 10);

    if (!Number.isFinite(day) || !Number.isFinite(meal)) return;

    if (action === "add-slot") {
      state.addCtx = { day, meal };
      openModal("addSlotModal");
      return;
    }

    if (!Number.isFinite(slot)) return;

    const slots = state.menu?.[day]?.[meal]?.slots;
    if (!Array.isArray(slots)) return;

    const s = slots[slot];

    if (action === "remove-slot") {
      if (!s) return;
      if (s.locked) {
        showMessage("Slot verrouillé : suppression interdite. Déverrouille d’abord.", "warning");
        return;
      }
      if (slots.length <= 1) return;
      slots.splice(slot, 1);
      rerender();
      return;
    }

    if (action === "reroll-slot") {
      if (!s) return;
      if (s.locked) return;

      const { calorieMax } = readParams();
      const dayTotal = window.MenuEngine.getDayCaloriesFromMenu(state.menu, day);
      const currentSlotKcal = window.MenuEngine.getRecipeCalories(s?.recipe);
      const remaining =
        Number.isFinite(calorieMax) && calorieMax > 0
          ? calorieMax - (dayTotal - currentSlotKcal)
          : Infinity;

      const next = window.MenuEngine.pickRecipeWithCalorieLimit(state.pools, s.type, remaining);
      if (Number.isFinite(calorieMax) && calorieMax > 0 && next === null) {
        showMessage(
          `Aucune recette "${s.type}" ne rentre dans les ${Math.max(0, remaining)} kcal restantes pour ce jour.`,
          "warning"
        );
        return;
      }

      s.recipe = next;
      rerender();
      return;
    }

    if (action === "toggle-lock") {
      if (!s) return;
      s.locked = !s.locked;
      rerender();
      return;
    }

    if (action === "pick-recipe") {
      if (!s) return;
      if (s.locked) {
        showMessage("Slot verrouillé : recherche interdite. Déverrouille d’abord.", "warning");
        return;
      }
      state.pickCtx = { day, meal, slot };
      openModal("pickRecipeModal");
      return;
    }
  });

  grid.addEventListener("change", (e) => {
    const sel = e.target?.closest?.("select[data-action='change-type']");
    if (!sel) return;

    const day = parseInt(sel.getAttribute("data-day"), 10);
    const meal = parseInt(sel.getAttribute("data-meal"), 10);
    const slot = parseInt(sel.getAttribute("data-slot"), 10);
    if (!Number.isFinite(day) || !Number.isFinite(meal) || !Number.isFinite(slot)) return;

    const s = state.menu?.[day]?.[meal]?.slots?.[slot];
    if (!s) return;

    if (s.locked) {
      showMessage("Slot verrouillé : changement de type interdit. Déverrouille d’abord.", "warning");
      sel.value = s.type;
      return;
    }

    const newType = String(sel.value || DEFAULT_SLOT_TYPE);
    const { calorieMax } = readParams();

    const dayTotal = window.MenuEngine.getDayCaloriesFromMenu(state.menu, day);
    const currentSlotKcal = window.MenuEngine.getRecipeCalories(s?.recipe);
    const remaining =
      Number.isFinite(calorieMax) && calorieMax > 0
        ? calorieMax - (dayTotal - currentSlotKcal)
        : Infinity;

    const next = window.MenuEngine.pickRecipeWithCalorieLimit(state.pools, newType, remaining);
    if (Number.isFinite(calorieMax) && calorieMax > 0 && next === null) {
      showMessage(
        `Impossible de passer ce slot en "${newType}" : aucune recette ne rentre dans les ${Math.max(0, remaining)} kcal restantes pour ce jour.`,
        "warning"
      );
      sel.value = s.type;
      return;
    }

    s.type = newType;
    s.recipe = next;
    s.locked = false;

    rerender();
  });
}

/* =========================
   Rendu (Option B — <template> HTML)
   ========================= */

function getDayIndex(dayOffset, weekStart) {
  const startIndex = weekStart === 0 ? 6 : weekStart - 1;
  return (startIndex + dayOffset) % 7;
}

function getTemplate(id) {
  const tpl = document.getElementById(id);
  if (!tpl || !(tpl instanceof HTMLTemplateElement)) return null;
  return tpl;
}

function cloneTemplate(id) {
  const tpl = getTemplate(id);
  if (!tpl) return null;

  const frag = tpl.content.cloneNode(true);
  const root = frag.firstElementChild || frag.querySelector("*");
  if (!root) return null;

  return root;
}

function renderMenu({ calorieTarget = 0, weekStart = 1, mealsPerDay = 3 } = {}) {
  const grid = dom.grid || document.getElementById("menuGrid");
  if (!grid) return;

  grid.innerHTML = "";

  if (!Array.isArray(state.menu) || state.menu.length === 0) return;

  const dayTpl = getTemplate("tpl-menu-day");
  const mealTpl = getTemplate("tpl-menu-meal");
  const slotTpl = getTemplate("tpl-menu-slot");

  if (!dayTpl || !mealTpl || !slotTpl) {
    showMessage(
      "Templates manquants : #tpl-menu-day / #tpl-menu-meal / #tpl-menu-slot. Vérifie que la page menu inclut bien les <template> requis.",
      "danger"
    );
    return;
  }

  const mealLabels = MEAL_LABELS_BY_COUNT[mealsPerDay] || MEAL_LABELS_BY_COUNT[3];
  const hasMax = Number.isFinite(calorieTarget) && calorieTarget > 0;

  state.menu.forEach((dayMeals, dayOffset) => {
    const dayIndex = getDayIndex(dayOffset, weekStart);
    const dayLabel = DAYS[dayIndex];

    const dayCard = cloneTemplate("tpl-menu-day");
    if (!dayCard) {
      showMessage("Template jour invalide (clone impossible).", "danger");
      return;
    }

    const dayTitleEl = dayCard.querySelector(".js-day-title");
    const mealsWrap = dayCard.querySelector(".js-meals-wrap");
    const dayTotalEl = dayCard.querySelector(".js-day-total");

    if (!dayTitleEl || !mealsWrap || !dayTotalEl) {
      showMessage("Template jour invalide (hooks .js-day-title/.js-meals-wrap/.js-day-total manquants).", "danger");
      return;
    }

    dayTitleEl.textContent = dayLabel;

    let totalCalories = 0;

    dayMeals.forEach((mealObj, mealIndex) => {
      const slots = Array.isArray(mealObj?.slots) ? mealObj.slots : [];

      const mealCard = cloneTemplate("tpl-menu-meal");
      if (!mealCard) {
        showMessage("Template repas invalide (clone impossible).", "danger");
        return;
      }

      const mealTitleEl = mealCard.querySelector(".js-meal-title");
      const slotsWrap = mealCard.querySelector(".js-slots-wrap");
      const addBtn = mealCard.querySelector("button[data-action='add-slot']");

      if (!mealTitleEl || !slotsWrap || !addBtn) {
        showMessage("Template repas invalide (hooks .js-meal-title/.js-slots-wrap ou bouton add-slot manquants).", "danger");
        return;
      }

      mealTitleEl.textContent = mealLabels[mealIndex] || `Repas ${mealIndex + 1}`;

      addBtn.setAttribute("data-day", String(dayOffset));
      addBtn.setAttribute("data-meal", String(mealIndex));

      slots.forEach((slotObj, slotIndex) => {
        const slotBox = cloneTemplate("tpl-menu-slot");
        if (!slotBox) {
          showMessage("Template slot invalide (clone impossible).", "danger");
          return;
        }

        const box = slotBox.querySelector(".js-slot-box");
        const typeSelect = slotBox.querySelector("select[data-action='change-type']");
        const lockBtn = slotBox.querySelector("button[data-action='toggle-lock']");
        const pickBtn = slotBox.querySelector("button[data-action='pick-recipe']");
        const rerollBtn = slotBox.querySelector("button[data-action='reroll-slot']");
        const removeBtn = slotBox.querySelector("button[data-action='remove-slot']");
        const recipeLine = slotBox.querySelector(".js-recipe-line");

        if (!box || !typeSelect || !lockBtn || !pickBtn || !rerollBtn || !removeBtn || !recipeLine) {
          showMessage("Template slot invalide (hooks .js-slot-box/.js-recipe-line ou contrôles manquants).", "danger");
          return;
        }

        if (slotObj.locked) box.classList.add("bg-warning-subtle", "border-warning", "border-2");
        else box.classList.remove("bg-warning-subtle", "border-warning", "border-2");

        for (const el of [typeSelect, lockBtn, pickBtn, rerollBtn, removeBtn]) {
          el.setAttribute("data-day", String(dayOffset));
          el.setAttribute("data-meal", String(mealIndex));
          el.setAttribute("data-slot", String(slotIndex));
        }

        // Select groupe : tous les recipe_group (liste SLOT_TYPES) dans la grille.
        typeSelect.innerHTML = "";
        for (const t of SLOT_TYPES) {
          const opt = document.createElement("option");
          opt.value = t.value;
          opt.textContent = t.label;
          if (t.value === slotObj.type) opt.selected = true;
          typeSelect.appendChild(opt);
        }

        typeSelect.disabled = !!slotObj.locked;

        lockBtn.textContent = slotObj.locked ? "🔒" : "🔓";
        lockBtn.setAttribute("title", slotObj.locked ? "Déverrouiller ce slot" : "Verrouiller ce slot");
        lockBtn.setAttribute("aria-label", slotObj.locked ? "Déverrouiller ce slot" : "Verrouiller ce slot");

        pickBtn.disabled = !!slotObj.locked;
        pickBtn.setAttribute("title", slotObj.locked ? "Slot verrouillé" : "Rechercher une recette");
        pickBtn.setAttribute("aria-label", slotObj.locked ? "Slot verrouillé" : "Rechercher une recette");

        rerollBtn.disabled = !!slotObj.locked;
        rerollBtn.setAttribute("title", slotObj.locked ? "Slot verrouillé" : "Relancer ce slot");
        rerollBtn.setAttribute("aria-label", slotObj.locked ? "Slot verrouillé" : "Relancer ce slot");

        removeBtn.disabled = slots.length <= 1 || !!slotObj.locked;
        removeBtn.setAttribute("title", slotObj.locked ? "Slot verrouillé" : "Supprimer ce slot");
        removeBtn.setAttribute("aria-label", slotObj.locked ? "Slot verrouillé" : "Supprimer ce slot");

        const r = slotObj.recipe;
        const title = r?.title ?? "— (non rempli)";
        const rawUrl = r?.url ?? "#";
        const url = normalizeRecipeUrl(rawUrl);
        const kcal = window.MenuEngine.getRecipeCalories(r);

        if (Number.isFinite(kcal) && kcal > 0) totalCalories += kcal;

        if (r) {
          recipeLine.innerHTML =
            `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">` +
            `<strong>${escapeHtml(title)}</strong></a> — ${kcal > 0 ? kcal : "—"} kcal`;
        } else {
          recipeLine.innerHTML = `<span class="text-muted"><strong>${escapeHtml(title)}</strong></span>`;
        }

        slotsWrap.appendChild(slotBox);
      });

      mealsWrap.appendChild(mealCard);
    });

    if (hasMax) {
      const remaining = calorieTarget - totalCalories;
      dayTotalEl.innerHTML =
        `<strong>Total :</strong> ${totalCalories} kcal ` +
        `<span class="text-muted">(MAX : ${calorieTarget} kcal | Reste : ${remaining})</span>`;

      if (remaining < 0) dayTotalEl.innerHTML += ` <span class="badge text-bg-danger ms-2">Dépassement</span>`;
    } else {
      dayTotalEl.innerHTML = `<strong>Total :</strong> ${totalCalories} kcal`;
    }

    grid.appendChild(dayCard);
  });
}

/* =========================
   Utils
   ========================= */

function readIntFromEl(el, fallback, min, max) {
  const raw = parseInt(el?.value ?? "", 10);
  const n = Number.isFinite(raw) ? raw : fallback;
  return Math.max(min, Math.min(max, n));
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getOrCreateModalInstance(id) {
  const el = document.getElementById(id);
  if (!el || !window.bootstrap?.Modal) return null;

  if (modalCache.has(id)) return modalCache.get(id);

  const existing = window.bootstrap.Modal.getInstance(el);
  if (existing) {
    modalCache.set(id, existing);
    return existing;
  }

  const inst = new window.bootstrap.Modal(el);
  modalCache.set(id, inst);
  return inst;
}

function openModal(id) {
  const inst = getOrCreateModalInstance(id);
  if (!inst) return;
  inst.show();
}

function closeModal(id) {
  const inst = getOrCreateModalInstance(id);
  if (!inst) return;
  inst.hide();
}
