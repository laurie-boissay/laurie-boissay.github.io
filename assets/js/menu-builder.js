/* =========================================================
   menu-builder.js — V1 (slots dynamiques + verrou + recherche)
   =========================================================
   Changements (cette étape)
   - Le sélecteur de type de slot (dans la grille) doit afficher TOUS les meal_type.
   - "other" ne doit PAS apparaître dans le sélecteur d’ajout de slot.
   - Modal "Ajouter un slot" : filtre automatiquement les types proposés
     selon les kcal restantes pour le jour :
       • si un type (ex. plat) ne peut pas rentrer dans les kcal restantes,
         il disparaît du select
       • si aucun type ne rentre, le bouton "Ajouter" est désactivé + message
   ========================================================= */

"use strict";

let RECIPES = [];
let POOLS = {};
let MENU = []; // MENU[day][meal] = { slots: [ { type, recipe, locked } ] }

const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

const MEAL_LABELS_BY_COUNT = {
  1: ["Déjeuner"],
  2: ["Déjeuner", "Dîner"],
  3: ["Petit déjeuner", "Déjeuner", "Dîner"],
  4: ["Petit déjeuner", "Déjeuner", "Goûter", "Dîner"],
  5: ["Petit déjeuner", "Collation", "Déjeuner", "Goûter", "Dîner"],
};

/**
 * Liste CANONIQUE des meal_type affichés dans la grille (selecteur de slot).
 * Contrat :
 * - Doit contenir TOUS les meal_type autorisés par le site.
 * - Les valeurs doivent matcher exactement recipes.json (champ meal_type).
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
 * - "other" volontairement exclu (contrainte demandée).
 */
const ADD_SLOT_TYPES = SLOT_TYPES.filter((t) => t.value !== "other");

document.addEventListener("DOMContentLoaded", async () => {
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

  window.addEventListener("calorieTargetUpdated", (e) => {
    if (e?.detail?.kcal) applyValue(e.detail.kcal);
  });

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
      RECIPES = [];
      POOLS = {};
      return;
    }

    const data = await res.json();
    RECIPES = Array.isArray(data) ? data : [];

    if (RECIPES.length === 0) {
      showMessage("recipes.json est chargé mais vide (aucune recette layout: recipe).", "warning");
      POOLS = {};
      return;
    }

    buildPools();
    hideMessage();
  } catch (err) {
    showMessage(`Erreur lors du chargement des recettes : ${String(err)} (URL: ${url})`, "danger");
    RECIPES = [];
    POOLS = {};
  }
}

function buildPools() {
  /**
   * Pools strictement alignés sur SLOT_TYPES :
   * - Permet d’activer les nouveaux meal_type sans modifier d’autres zones.
   */
  POOLS = {};
  for (const t of SLOT_TYPES) POOLS[t.value] = [];

  for (const r of RECIPES) {
    const t = String(r?.meal_type || "").trim();
    if (POOLS[t]) POOLS[t].push(r);
  }
}

/* =========================
   Calories helpers (MAX kcal/jour)
   ========================= */
function getRecipeCalories(recipe) {
  const kcal = parseInt(recipe?.calories ?? 0, 10);
  return Number.isFinite(kcal) && kcal > 0 ? kcal : 0;
}

function getDayCaloriesFromMenu(menuRef, dayIndex) {
  const day = menuRef?.[dayIndex];
  if (!Array.isArray(day)) return 0;

  let total = 0;
  for (const meal of day) {
    const slots = Array.isArray(meal?.slots) ? meal.slots : [];
    for (const s of slots) {
      total += getRecipeCalories(s?.recipe);
    }
  }
  return total;
}

function pickRecipe(type) {
  const pool = POOLS[String(type || "")] || [];
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickRecipeWithCalorieLimit(type, maxKcal) {
  const pool = POOLS[String(type || "")] || [];
  if (pool.length === 0) return null;

  if (!Number.isFinite(maxKcal) || maxKcal <= 0 || maxKcal === Infinity) {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const filtered = pool.filter((r) => getRecipeCalories(r) <= maxKcal);
  if (filtered.length === 0) return null;

  return filtered[Math.floor(Math.random() * filtered.length)];
}

/**
 * Retourne la liste des types ajoutables dans le modal,
 * filtrée selon les kcal restantes ET la disponibilité des pools.
 * - exclut toujours "other" (via ADD_SLOT_TYPES)
 */
function getAddableTypesForDay(dayIndex, calorieMax) {
  const used = getDayCaloriesFromMenu(MENU, dayIndex);

  // Pas de plafond => on propose tous les types (sauf other) qui ont au moins 1 recette.
  if (!Number.isFinite(calorieMax) || calorieMax <= 0) {
    return ADD_SLOT_TYPES.filter((t) => (POOLS[t.value] || []).length > 0);
  }

  const remaining = calorieMax - used;
  if (remaining <= 0) return [];

  return ADD_SLOT_TYPES.filter((t) => {
    const pool = POOLS[t.value] || [];
    if (pool.length === 0) return false;
    // Il faut AU MOINS une recette <= remaining
    return pool.some((r) => getRecipeCalories(r) <= remaining);
  });
}

/* =========================
   Construction sous plafond (validation + message)
   ========================= */
function buildMenuUnderCalorieMax(prevMenu, mealsPerDay, calorieMax) {
  const out = [];

  for (let d = 0; d < 7; d++) {
    const prevDay = prevMenu?.[d] || [];
    const newDay = [];

    for (let m = 0; m < mealsPerDay; m++) {
      const prevMeal = prevDay[m];
      const prevSlots = Array.isArray(prevMeal?.slots) ? prevMeal.slots : null;

      const baseSlots =
        prevSlots && prevSlots.length > 0
          ? prevSlots
          : [{ type: "plat", recipe: null, locked: false }, { type: "dessert", recipe: null, locked: false }];

      const newSlots = [];

      for (const s of baseSlots) {
        const type = String(s?.type || "plat");
        const locked = !!s?.locked;

        if (locked) {
          newSlots.push({ type, recipe: s?.recipe ?? null, locked: true });
          continue;
        }

        const tmpDayMeals = [...newDay, { slots: newSlots }];
        const usedSoFar = getDayCaloriesFromMenu([tmpDayMeals], 0);

        let remaining = Infinity;
        if (Number.isFinite(calorieMax) && calorieMax > 0) {
          remaining = calorieMax - usedSoFar;
        }

        const picked = pickRecipeWithCalorieLimit(type, remaining);
        newSlots.push({ type, recipe: picked, locked: false });
      }

      newDay.push({ slots: newSlots });
    }

    out.push(newDay);
  }

  return out;
}

function computeCalorieStatus(menuRef, calorieMax) {
  const status = {
    max: calorieMax,
    overs: [],
    empties: 0,
  };

  for (let d = 0; d < 7; d++) {
    const total = getDayCaloriesFromMenu(menuRef, d);
    if (Number.isFinite(calorieMax) && calorieMax > 0 && total > calorieMax) {
      status.overs.push({ dayIndex: d, total });
    }

    const day = menuRef?.[d] || [];
    for (const meal of day) {
      const slots = Array.isArray(meal?.slots) ? meal.slots : [];
      for (const s of slots) {
        if (!s?.recipe) status.empties += 1;
      }
    }
  }

  return status;
}

/* =========================
   Génération / reroll menu
   ========================= */
function generateMenu() {
  if (!Array.isArray(RECIPES) || RECIPES.length === 0) {
    showMessage("Aucune recette disponible. Le menu ne peut pas être généré.", "danger");
    return;
  }

  hideMessage();

  const mealsPerDay = readInt("#mealsPerDay", 3, 1, 5);
  const weekStart = readInt("#weekStart", 1, 0, 6);
  const calorieMax = readInt("#calorieTargetDay", 0, 0, 99999);

  const hasExisting = Array.isArray(MENU) && MENU.length === 7;
  const baseMenu = hasExisting ? MENU : createFreshSkeleton(mealsPerDay);

  const newMenu = buildMenuUnderCalorieMax(baseMenu, mealsPerDay, calorieMax);

  const status = computeCalorieStatus(newMenu, calorieMax);
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

  MENU = newMenu;
  renderMenu({ calorieTarget: calorieMax, weekStart, mealsPerDay });
}

function createFreshSkeleton(mealsPerDay) {
  const out = [];
  for (let d = 0; d < 7; d++) {
    const dayMeals = [];
    for (let m = 0; m < mealsPerDay; m++) {
      dayMeals.push({
        slots: [
          { type: "plat", recipe: pickRecipe("plat"), locked: false },
          { type: "dessert", recipe: pickRecipe("dessert"), locked: false },
        ],
      });
    }
    out.push(dayMeals);
  }
  return out;
}

/* =========================
   Modal “Ajouter un slot”
   ========================= */
let ADD_CTX = null; // { day, meal }

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

  // À chaque ouverture du modal, on filtre les types disponibles selon les kcal restantes.
  document.getElementById("addSlotModal").addEventListener("shown.bs.modal", () => {
    refreshAddSlotTypeOptions();
  });

  document.getElementById("confirmAddSlot").addEventListener("click", () => {
    if (!ADD_CTX) return;

    const typeSelect = document.getElementById("addSlotType");
    const type = String(typeSelect?.value || "");
    const { day, meal } = ADD_CTX;

    if (!MENU?.[day]?.[meal]) return;

    // Si la liste est vide (plus aucun type possible), on ne fait rien.
    if (!type) {
      showMessage("Impossible d’ajouter : aucune catégorie ne rentre dans les kcal restantes pour ce jour.", "warning");
      return;
    }

    const calorieMax = readInt("#calorieTargetDay", 0, 0, 99999);
    const used = getDayCaloriesFromMenu(MENU, day);
    const remaining = Number.isFinite(calorieMax) && calorieMax > 0 ? calorieMax - used : Infinity;

    const recipe = pickRecipeWithCalorieLimit(type, remaining);

    // Si on n’a aucune recette compatible, on REFILTRE et on laisse le modal ouvert.
    if (Number.isFinite(calorieMax) && calorieMax > 0 && recipe === null) {
      showMessage(
        `Aucune recette "${type}" ne rentre dans les ${Math.max(0, remaining)} kcal restantes pour ce jour. ` +
          `Je retire ce type de la liste.`,
        "warning"
      );
      refreshAddSlotTypeOptions();
      return;
    }

    MENU[day][meal].slots.push({ type, recipe, locked: false });
    ADD_CTX = null;

    closeModal("addSlotModal");
    rerender();
  });
}

/**
 * Rafraîchit les options du select "Type à ajouter" selon :
 * - le jour ciblé (ADD_CTX.day)
 * - le MAX kcal/jour et les kcal déjà utilisées
 * - les pools disponibles
 *
 * Comportement :
 * - si un type n’a aucune recette qui rentre dans les kcal restantes => il disparaît
 * - si aucun type n’est possible => select désactivé + bouton "Ajouter" désactivé + hint explicite
 */
function refreshAddSlotTypeOptions() {
  const sel = document.getElementById("addSlotType");
  const hint = document.getElementById("addSlotHint");
  const confirmBtn = document.getElementById("confirmAddSlot");

  if (!sel || !hint || !confirmBtn) return;

  sel.innerHTML = "";

  if (!ADD_CTX || !Number.isFinite(ADD_CTX.day)) {
    hint.textContent = "Contexte introuvable (jour/repas non sélectionné).";
    sel.disabled = true;
    confirmBtn.disabled = true;
    return;
  }

  const calorieMax = readInt("#calorieTargetDay", 0, 0, 99999);
  const used = getDayCaloriesFromMenu(MENU, ADD_CTX.day);
  const remaining = Number.isFinite(calorieMax) && calorieMax > 0 ? calorieMax - used : Infinity;

  const addable = getAddableTypesForDay(ADD_CTX.day, calorieMax);

  if (Number.isFinite(calorieMax) && calorieMax > 0) {
    hint.textContent = `Kcal restantes pour ce jour : ${Math.max(0, remaining)} kcal.`;
  } else {
    hint.textContent = "Aucun MAX kcal/jour défini : toutes les catégories disponibles sont proposées.";
  }

  if (addable.length === 0) {
    sel.disabled = true;
    confirmBtn.disabled = true;
    hint.textContent =
      (Number.isFinite(calorieMax) && calorieMax > 0)
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
let PICK_CTX = null; // { day, meal, slot }

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

  if (!PICK_CTX) {
    hint.textContent = "Contexte introuvable (slot non sélectionné).";
    return;
  }

  const slot = MENU?.[PICK_CTX.day]?.[PICK_CTX.meal]?.slots?.[PICK_CTX.slot];
  if (slot?.locked) {
    hint.textContent = "Slot verrouillé : recherche désactivée.";
    return;
  }

  const slotType = slot?.type || "plat";
  const baseList = allTypes ? RECIPES : (POOLS[slotType] || []);

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
    const kcal = Number.isFinite(parseInt(r?.calories, 10)) ? `${parseInt(r.calories, 10)} kcal` : "— kcal";
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
  if (!PICK_CTX) return;

  const s = MENU?.[PICK_CTX.day]?.[PICK_CTX.meal]?.slots?.[PICK_CTX.slot];
  if (!s) return;

  if (s.locked) {
    showMessage("Slot verrouillé : tu dois d’abord déverrouiller pour changer la recette.", "warning");
    return;
  }

  const calorieMax = readInt("#calorieTargetDay", 0, 0, 99999);
  const currentSlotKcal = getRecipeCalories(s?.recipe);
  const dayTotal = getDayCaloriesFromMenu(MENU, PICK_CTX.day);
  const remaining =
    Number.isFinite(calorieMax) && calorieMax > 0
      ? calorieMax - (dayTotal - currentSlotKcal)
      : Infinity;

  const pickedKcal = getRecipeCalories(recipe);
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
      ADD_CTX = { day, meal };
      openModal("addSlotModal");
      return;
    }

    if (!Number.isFinite(slot)) return;

    const slots = MENU?.[day]?.[meal]?.slots;
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
      const dayTotal = getDayCaloriesFromMenu(MENU, day);
      const currentSlotKcal = getRecipeCalories(s?.recipe);
      const remaining =
        Number.isFinite(calorieMax) && calorieMax > 0
          ? calorieMax - (dayTotal - currentSlotKcal)
          : Infinity;

      const next = pickRecipeWithCalorieLimit(s.type, remaining);
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
      PICK_CTX = { day, meal, slot };
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

    const s = MENU?.[day]?.[meal]?.slots?.[slot];
    if (!s) return;

    if (s.locked) {
      showMessage("Slot verrouillé : changement de type interdit. Déverrouille d’abord.", "warning");
      sel.value = s.type;
      return;
    }

    const newType = String(sel.value || "plat");
    const calorieMax = readInt("#calorieTargetDay", 0, 0, 99999);

    const dayTotal = getDayCaloriesFromMenu(MENU, day);
    const currentSlotKcal = getRecipeCalories(s?.recipe);
    const remaining =
      Number.isFinite(calorieMax) && calorieMax > 0
        ? calorieMax - (dayTotal - currentSlotKcal)
        : Infinity;

    const next = pickRecipeWithCalorieLimit(newType, remaining);
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

function rerender() {
  const mealsPerDay = readInt("#mealsPerDay", 3, 1, 5);
  const weekStart = readInt("#weekStart", 1, 0, 6);
  const calorieMax = readInt("#calorieTargetDay", 0, 0, 99999);

  renderMenu({ calorieTarget: calorieMax, weekStart, mealsPerDay });
}

/* =========================
   Rendu (cartes jour -> cartes repas -> slots)
   ========================= */
function getDayIndex(dayOffset, weekStart) {
  const startIndex = weekStart === 0 ? 6 : weekStart - 1;
  return (startIndex + dayOffset) % 7;
}

function renderMenu({ calorieTarget = 0, weekStart = 1, mealsPerDay = 3 } = {}) {
  const grid = document.getElementById("menuGrid");
  if (!grid) return;

  grid.innerHTML = "";
  if (!Array.isArray(MENU) || MENU.length === 0) return;

  const mealLabels = MEAL_LABELS_BY_COUNT[mealsPerDay] || MEAL_LABELS_BY_COUNT[3];

  MENU.forEach((dayMeals, dayOffset) => {
    const dayLabel = DAYS[getDayIndex(dayOffset, weekStart)];

    const dayCard = document.createElement("div");
    dayCard.className = "card mb-4";

    const dayHeader = document.createElement("div");
    dayHeader.className = "card-header fw-bold";
    dayHeader.textContent = dayLabel;

    const dayBody = document.createElement("div");
    dayBody.className = "card-body";

    let totalCalories = 0;

    const mealsWrap = document.createElement("div");
    mealsWrap.className = "d-flex flex-column gap-2";

    dayMeals.forEach((mealObj, mealIndex) => {
      const slots = Array.isArray(mealObj?.slots) ? mealObj.slots : [];

      const mealCard = document.createElement("div");
      mealCard.className = "card";

      const mealBody = document.createElement("div");
      mealBody.className = "card-body py-2";

      const mealTitle = document.createElement("div");
      mealTitle.className = "fw-bold mb-2";
      mealTitle.textContent = mealLabels[mealIndex] || `Repas ${mealIndex + 1}`;
      mealBody.appendChild(mealTitle);

      const slotsWrap = document.createElement("div");
      slotsWrap.className = "d-flex flex-column gap-2";

      slots.forEach((slotObj, slotIndex) => {
        const slotBox = document.createElement("div");
        slotBox.className = "border rounded p-2";

        if (slotObj.locked) {
          slotBox.classList.add("bg-warning-subtle", "border-warning", "border-2");
        }

        const top = document.createElement("div");
        top.className = "d-flex flex-wrap gap-2 align-items-center justify-content-between";

        const left = document.createElement("div");
        left.className = "d-flex flex-wrap gap-2 align-items-center";

        const typeSelect = document.createElement("select");
        typeSelect.className = "form-select form-select-sm";
        typeSelect.style.maxWidth = "180px";
        typeSelect.setAttribute("data-action", "change-type");
        typeSelect.setAttribute("data-day", String(dayOffset));
        typeSelect.setAttribute("data-meal", String(mealIndex));
        typeSelect.setAttribute("data-slot", String(slotIndex));
        if (slotObj.locked) typeSelect.disabled = true;

        // Grille : on affiche tous les meal_type (y compris "other").
        for (const t of SLOT_TYPES) {
          const opt = document.createElement("option");
          opt.value = t.value;
          opt.textContent = t.label;
          if (t.value === slotObj.type) opt.selected = true;
          typeSelect.appendChild(opt);
        }

        left.appendChild(typeSelect);
        top.appendChild(left);

        const actions = document.createElement("div");
        actions.className = "d-flex gap-2";

        const lockBtn = document.createElement("button");
        lockBtn.type = "button";
        lockBtn.className = "btn btn-outline-secondary btn-sm";
        lockBtn.textContent = slotObj.locked ? "🔒" : "🔓";
        lockBtn.setAttribute("title", slotObj.locked ? "Déverrouiller ce slot" : "Verrouiller ce slot");
        lockBtn.setAttribute("aria-label", slotObj.locked ? "Déverrouiller ce slot" : "Verrouiller ce slot");
        lockBtn.setAttribute("data-action", "toggle-lock");
        lockBtn.setAttribute("data-day", String(dayOffset));
        lockBtn.setAttribute("data-meal", String(mealIndex));
        lockBtn.setAttribute("data-slot", String(slotIndex));

        const pickBtn = document.createElement("button");
        pickBtn.type = "button";
        pickBtn.className = "btn btn-outline-primary btn-sm";
        pickBtn.textContent = "🔎";
        pickBtn.setAttribute("title", slotObj.locked ? "Slot verrouillé" : "Rechercher une recette");
        pickBtn.setAttribute("aria-label", slotObj.locked ? "Slot verrouillé" : "Rechercher une recette");
        pickBtn.setAttribute("data-action", "pick-recipe");
        pickBtn.setAttribute("data-day", String(dayOffset));
        pickBtn.setAttribute("data-meal", String(mealIndex));
        pickBtn.setAttribute("data-slot", String(slotIndex));
        if (slotObj.locked) pickBtn.disabled = true;

        const rerollBtn = document.createElement("button");
        rerollBtn.type = "button";
        rerollBtn.className = "btn btn-outline-secondary btn-sm";
        rerollBtn.textContent = "↻";
        rerollBtn.setAttribute("title", slotObj.locked ? "Slot verrouillé" : "Relancer ce slot");
        rerollBtn.setAttribute("aria-label", slotObj.locked ? "Slot verrouillé" : "Relancer ce slot");
        rerollBtn.setAttribute("data-action", "reroll-slot");
        rerollBtn.setAttribute("data-day", String(dayOffset));
        rerollBtn.setAttribute("data-meal", String(mealIndex));
        rerollBtn.setAttribute("data-slot", String(slotIndex));
        if (slotObj.locked) rerollBtn.disabled = true;

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "btn btn-outline-danger btn-sm";
        removeBtn.textContent = "−";
        removeBtn.setAttribute("title", slotObj.locked ? "Slot verrouillé" : "Supprimer ce slot");
        removeBtn.setAttribute("aria-label", slotObj.locked ? "Slot verrouillé" : "Supprimer ce slot");
        removeBtn.setAttribute("data-action", "remove-slot");
        removeBtn.setAttribute("data-day", String(dayOffset));
        removeBtn.setAttribute("data-meal", String(mealIndex));
        removeBtn.setAttribute("data-slot", String(slotIndex));
        if (slots.length <= 1 || slotObj.locked) removeBtn.disabled = true;

        actions.appendChild(lockBtn);
        actions.appendChild(pickBtn);
        actions.appendChild(rerollBtn);
        actions.appendChild(removeBtn);

        top.appendChild(actions);
        slotBox.appendChild(top);

        const recipeLine = document.createElement("div");
        recipeLine.className = "mt-2";

        const r = slotObj.recipe;
        const title = r?.title ?? "— (non rempli)";
        const url = r?.url ?? "#";
        const kcal = getRecipeCalories(r);

        totalCalories += kcal;

        recipeLine.innerHTML =
          r
            ? `<a href="${url}" target="_blank"><strong>${escapeHtml(title)}</strong></a> — ${kcal > 0 ? kcal : "—"} kcal`
            : `<span class="text-muted"><strong>${escapeHtml(title)}</strong></span>`;

        slotBox.appendChild(recipeLine);
        slotsWrap.appendChild(slotBox);
      });

      mealBody.appendChild(slotsWrap);

      const addWrap = document.createElement("div");
      addWrap.className = "mt-2 d-flex justify-content-end";

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "btn btn-outline-primary btn-sm";
      addBtn.textContent = "+";
      addBtn.setAttribute("title", "Ajouter un slot");
      addBtn.setAttribute("aria-label", "Ajouter un slot");
      addBtn.setAttribute("data-action", "add-slot");
      addBtn.setAttribute("data-day", String(dayOffset));
      addBtn.setAttribute("data-meal", String(mealIndex));

      addWrap.appendChild(addBtn);
      mealBody.appendChild(addWrap);

      mealCard.appendChild(mealBody);
      mealsWrap.appendChild(mealCard);
    });

    dayBody.appendChild(mealsWrap);

    const total = document.createElement("div");
    total.className = "mt-3";

    const hasMax = Number.isFinite(calorieTarget) && calorieTarget > 0;
    if (hasMax) {
      const remaining = calorieTarget - totalCalories;
      total.innerHTML =
        `<strong>Total :</strong> ${totalCalories} kcal ` +
        `<span class="text-muted">(MAX : ${calorieTarget} kcal | Reste : ${remaining})</span>`;
      if (remaining < 0) {
        total.innerHTML += ` <span class="badge text-bg-danger ms-2">Dépassement</span>`;
      }
    } else {
      total.innerHTML = `<strong>Total :</strong> ${totalCalories} kcal`;
    }

    dayBody.appendChild(total);

    dayCard.appendChild(dayHeader);
    dayCard.appendChild(dayBody);
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
  if (!el) return;
  const modal = new window.bootstrap.Modal(el);
  modal.show();
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const inst = window.bootstrap?.Modal?.getInstance(el) || new window.bootstrap.Modal(el);
  inst.hide();
}
