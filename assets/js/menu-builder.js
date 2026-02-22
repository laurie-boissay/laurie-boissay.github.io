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
- Le format du menu est : menu[day][meal] = { slots: [ { type, recipe, locked } ] }.
- Les meal_type proposés dans la grille doivent couvrir tous les types autorisés.
- Le modal “Ajouter un slot” ne propose jamais le type "other".
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
  addCtx: null,  // { day, meal }
  pickCtx: null, // { day, meal, slot }
};

const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

const MEAL_LABELS_BY_COUNT = {
  1: ["Déjeuner"],
  2: ["Déjeuner", "Dîner"],
  3: ["Petit déjeuner", "Déjeuner", "Dîner"],
  4: ["Petit déjeuner", "Déjeuner", "Goûter", "Dîner"],
  5: ["Petit déjeuner", "Collation", "Déjeuner", "Goûter", "Dîner"],
};

/**
 * Liste CANONIQUE des meal_type affichés dans la grille (sélecteur de type de slot).
 * Contrat : doit matcher les valeurs de recipes.json (champ meal_type).
 */
const SLOT_TYPES = [
  { value: "plat", label: "Plat" },
  { value: "dessert", label: "Dessert" },
  { value: "pain", label: "Pain" },
  { value: "boisson", label: "Boisson" },
  { value: "amuse-bouche", label: "Amuse-bouche" },
  { value: "fromage", label: "Fromage" },
  { value: "poisson", label: "Poisson" },
  { value: "viande", label: "Viande" },
  { value: "œuf", label: "Œuf" },
  { value: "accompagnement", label: "Accompagnement" },
  { value: "other", label: "Other" },
];

/**
 * Types autorisés UNIQUEMENT pour “Ajouter un slot”.
 * - "other" volontairement exclu (contrainte UX).
 */
const ADD_SLOT_TYPES = SLOT_TYPES.filter((t) => t.value !== "other");

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

  document.getElementById("generateMenu").addEventListener("click", generateMenu);

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
  const root = document.getElementById("menu-builder-root");
  return (root?.dataset?.baseurl || "").replace(/\/$/, "");
}

function withBaseUrl(path) {
  const baseurl = getBaseUrl();
  const safePath = String(path || "").startsWith("/") ? path : `/${path}`;
  return `${baseurl}${safePath}`;
}

/* =========================
   Messages
   ========================= */

function showMessage(text, type = "secondary") {
  const box = document.getElementById("menuMessage");
  if (!box) return;

  box.classList.remove("d-none", "alert-secondary", "alert-danger", "alert-success", "alert-warning");
  box.classList.add(`alert-${type}`);
  box.textContent = text;
}

function hideMessage() {
  const box = document.getElementById("menuMessage");
  if (!box) return;
  box.classList.add("d-none");
  box.textContent = "";
}

/* =========================
   Sync kcal/jour (écrasement forcé)
   ========================= */

function setupCalorieTargetSync() {
  const targetInput = document.getElementById("calorieTargetDay");
  if (!targetInput) return;

  const applyValue = (kcal) => {
    const n = parseInt(kcal, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    targetInput.value = String(n);
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
        applyValue(el.value);
        return;
      }

      const dt = el.getAttribute("data-calorie-target");
      if (dt) {
        applyValue(dt);
        return;
      }

      const txt = (el.textContent || "").trim();
      const m = txt.match(/(\d{3,4})/);
      if (m) {
        applyValue(m[1]);
        return;
      }
    }
  };

  tryReadFromDom();

  const observer = new MutationObserver(() => tryReadFromDom());
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

    state.pools = window.MenuEngine.buildPools(state.recipes, SLOT_TYPES);
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

  const mealsPerDay = readInt("#mealsPerDay", 3, 1, 5);
  const weekStart = readInt("#weekStart", 1, 0, 6);
  const calorieMax = readInt("#calorieTargetDay", 0, 0, 99999);

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
  const mealsPerDay = readInt("#mealsPerDay", 3, 1, 5);
  const weekStart = readInt("#weekStart", 1, 0, 6);
  const calorieMax = readInt("#calorieTargetDay", 0, 0, 99999);

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

  // À chaque ouverture, on recalcul le filtrage des types selon kcal restantes.
  document.getElementById("addSlotModal").addEventListener("shown.bs.modal", () => {
    refreshAddSlotTypeOptions();
  });

  document.getElementById("confirmAddSlot").addEventListener("click", () => {
    if (!state.addCtx) return;

    const typeSelect = document.getElementById("addSlotType");
    const type = String(typeSelect?.value || "");
    const { day, meal } = state.addCtx;

    if (!state.menu?.[day]?.[meal]) return;

    // Aucune option => rien à faire.
    if (!type) {
      showMessage("Impossible d’ajouter : aucune catégorie ne rentre dans les kcal restantes pour ce jour.", "warning");
      return;
    }

    const calorieMax = readInt("#calorieTargetDay", 0, 0, 99999);
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

  const calorieMax = readInt("#calorieTargetDay", 0, 0, 99999);
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
                Tous types (ignore le type du slot)
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
}

function renderPickResults() {
  const results = document.getElementById("pickRecipeResults");
  const hint = document.getElementById("pickRecipeHint");
  const q = String(document.getElementById("pickRecipeQuery")?.value || "").trim().toLowerCase();
  const allTypes = !!document.getElementById("pickRecipeAllTypes")?.checked;

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

  const slotType = slot?.type || "plat";
  const baseList = allTypes ? state.recipes : (state.pools[slotType] || []);

  hint.textContent = allTypes
    ? `Recherche dans toutes les recettes (type du slot : ${slotType}).`
    : `Recherche dans les recettes de type : ${slotType}.`;

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
    const a = document.createElement("button");
    a.type = "button";
    a.className = "list-group-item list-group-item-action";

    const title = r?.title ?? "Recette sans titre";
    const kcalN = parseInt(r?.calories, 10);
    const kcal = Number.isFinite(kcalN) ? `${kcalN} kcal` : "— kcal";
    const tpe = r?.meal_type ? `(${r.meal_type})` : "";

    a.innerHTML = `<div class="d-flex justify-content-between gap-2">
      <div><strong>${escapeHtml(title)}</strong> <span class="text-muted">${escapeHtml(tpe)}</span></div>
      <div class="text-muted">${escapeHtml(kcal)}</div>
    </div>`;

    a.addEventListener("click", () => applyPickedRecipe(r));
    results.appendChild(a);
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

  const calorieMax = readInt("#calorieTargetDay", 0, 0, 99999);
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

  closeModal("pickRecipeModal");
  rerender();
}

/* =========================
   Interactions UI (+ / − / ↻ / 🔒 / 🔎 / type change)
   ========================= */

function setupMenuInteractions() {
  const grid = document.getElementById("menuGrid");
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

      const calorieMax = readInt("#calorieTargetDay", 0, 0, 99999);
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

    const newType = String(sel.value || "plat");
    const calorieMax = readInt("#calorieTargetDay", 0, 0, 99999);

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
   Rendu (cartes jour -> cartes repas -> slots)
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
  return tpl.content.firstElementChild.cloneNode(true);
}

/**
 * Rendu UI (Option B — <template> HTML)
 * Contrat :
 * - Le rendu s’appuie sur des templates présents dans la page :
 *   • #tpl-menu-day
 *   • #tpl-menu-meal
 *   • #tpl-menu-slot
 * - Les events restent gérés par délégation (setupMenuInteractions).
 * - Aucune logique métier ici (elle est dans menu-engine.js).
 */
function renderMenu({ calorieTarget = 0, weekStart = 1, mealsPerDay = 3 } = {}) {
  const grid = document.getElementById("menuGrid");
  if (!grid) return;

  grid.innerHTML = "";

  if (!Array.isArray(state.menu) || state.menu.length === 0) return;

  const dayTpl = getTemplate("tpl-menu-day");
  const mealTpl = getTemplate("tpl-menu-meal");
  const slotTpl = getTemplate("tpl-menu-slot");

  if (!dayTpl || !mealTpl || !slotTpl) {
    showMessage(
      "Templates manquants : #tpl-menu-day / #tpl-menu-meal / #tpl-menu-slot. " +
        "Vérifie que la page menu inclut bien les <template> requis.",
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
      const mealTitleEl = mealCard.querySelector(".js-meal-title");
      const slotsWrap = mealCard.querySelector(".js-slots-wrap");
      const addBtn = mealCard.querySelector("button[data-action='add-slot']");

      if (!mealTitleEl || !slotsWrap || !addBtn) {
        showMessage("Template repas invalide (hooks .js-meal-title/.js-slots-wrap ou bouton add-slot manquants).", "danger");
        return;
      }

      mealTitleEl.textContent = mealLabels[mealIndex] || `Repas ${mealIndex + 1}`;

      // Paramétrage du bouton “Ajouter un slot” (délégation events)
      addBtn.setAttribute("data-day", String(dayOffset));
      addBtn.setAttribute("data-meal", String(mealIndex));

      slots.forEach((slotObj, slotIndex) => {
        const slotBox = cloneTemplate("tpl-menu-slot");

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

        // Style verrouillé
        if (slotObj.locked) {
          box.classList.add("bg-warning-subtle", "border-warning", "border-2");
        } else {
          box.classList.remove("bg-warning-subtle", "border-warning", "border-2");
        }

        // Data attrs (délégation events)
        for (const el of [typeSelect, lockBtn, pickBtn, rerollBtn, removeBtn]) {
          el.setAttribute("data-day", String(dayOffset));
          el.setAttribute("data-meal", String(mealIndex));
          el.setAttribute("data-slot", String(slotIndex));
        }

        // Select type : tous les meal_type (y compris other) dans la grille
        typeSelect.innerHTML = "";
        for (const t of SLOT_TYPES) {
          const opt = document.createElement("option");
          opt.value = t.value;
          opt.textContent = t.label;
          if (t.value === slotObj.type) opt.selected = true;
          typeSelect.appendChild(opt);
        }

        if (slotObj.locked) {
          typeSelect.disabled = true;
        } else {
          typeSelect.disabled = false;
        }

        // Boutons : état visuel + disabled
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

        // Ligne recette
        const r = slotObj.recipe;
        const title = r?.title ?? "— (non rempli)";
        const url = r?.url ?? "#";
        const kcal = MenuEngine.getRecipeCalories(r);

        totalCalories += kcal;

        if (r) {
          recipeLine.innerHTML =
            `<a href="${url}" target="_blank"><strong>${escapeHtml(title)}</strong></a> — ${kcal > 0 ? kcal : "—"} kcal`;
        } else {
          recipeLine.innerHTML = `<span class="text-muted"><strong>${escapeHtml(title)}</strong></span>`;
        }

        slotsWrap.appendChild(slotBox);
      });

      mealsWrap.appendChild(mealCard);
    });

    // Total jour
    if (hasMax) {
      const remaining = calorieTarget - totalCalories;
      dayTotalEl.innerHTML =
        `<strong>Total :</strong> ${totalCalories} kcal ` +
        `<span class="text-muted">(MAX : ${calorieTarget} kcal | Reste : ${remaining})</span>`;

      if (remaining < 0) {
        dayTotalEl.innerHTML += ` <span class="badge text-bg-danger ms-2">Dépassement</span>`;
      }
    } else {
      dayTotalEl.innerHTML = `<strong>Total :</strong> ${totalCalories} kcal`;
    }

    grid.appendChild(dayCard);
  });
}
/* =========================
   Utils
   ========================= */

function readInt(selector, fallback, min, max) {
  const el = document.querySelector(selector);
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

function openModal(id) {
  const el = document.getElementById(id);
  if (!el || !window.bootstrap) return;
  const modal = new window.bootstrap.Modal(el);
  modal.show();
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el || !window.bootstrap) return;
  const inst = window.bootstrap?.Modal?.getInstance(el) || new window.bootstrap.Modal(el);
  inst.hide();
}
