/* ==============================================================================
menu-builder.modals.js — UI (Bootstrap modals)
==============================================================================
Rôle
- Créer et gérer les modales :
  • "Ajouter un slot"
  • "Rechercher une recette"
- Le contenu proposé respecte les plafonds bloquants :
  kcal + glucides nets + lipides.

Contrat
- S’appuie sur MenuEngine pour les getters et le tirage sous plafonds.
- Ne dépend pas du rendu grille (menu-builder.render.js) sauf via MB.state.menu.
============================================================================== */

"use strict";

(function attachMenuBuilderModals(global) {
  const MB = global.MenuBuilder;

  // ---------------------------------------------------------------------------
  // Bootstrap Modal helpers (cache instances)
  // ---------------------------------------------------------------------------

  MB.getOrCreateModalInstance = function getOrCreateModalInstance(id) {
    const el = document.getElementById(id);
    if (!el || !global.bootstrap?.Modal) return null;

    if (MB.modalCache?.has?.(id)) return MB.modalCache.get(id);

    const existing = global.bootstrap.Modal.getInstance(el);
    if (existing) {
      MB.modalCache?.set?.(id, existing);
      return existing;
    }

    const inst = new global.bootstrap.Modal(el);
    MB.modalCache?.set?.(id, inst);
    return inst;
  };

  MB.openModal = function openModal(id) {
    const inst = MB.getOrCreateModalInstance(id);
    if (!inst) return;
    inst.show();
  };

  MB.closeModal = function closeModal(id) {
    const inst = MB.getOrCreateModalInstance(id);
    if (!inst) return;
    inst.hide();
  };

  // ---------------------------------------------------------------------------
  // Utils : plafonds (kcal + carbs + fat)
  // ---------------------------------------------------------------------------

  function normalizeLimitToInfinity(v) {
    const n =
      typeof v === "number"
        ? v
        : parseFloat(String(v ?? "").trim().replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : Infinity;
  }

  function getAllSlotTypesForAdd() {
    // Ordre de préférence :
    // 1) MB.ADD_SLOT_TYPES (si le core l’a initialisé)
    // 2) MB.SLOT_TYPES (liste canonique UI)
    // 3) MenuEngine.getSlotTypes() (source unique côté moteur)
    if (Array.isArray(MB.ADD_SLOT_TYPES) && MB.ADD_SLOT_TYPES.length > 0) return MB.ADD_SLOT_TYPES;
    if (Array.isArray(MB.SLOT_TYPES) && MB.SLOT_TYPES.length > 0) return MB.SLOT_TYPES;
    if (typeof global.MenuEngine?.getSlotTypes === "function") return global.MenuEngine.getSlotTypes();
    return [];
  }

  function buildRemainingLimitsForDay(dayIndex) {
    const p = MB.readParams();

    const dayK = global.MenuEngine.getDayCaloriesFromMenu(MB.state.menu, dayIndex);
    const dayC = global.MenuEngine.getDayNetCarbsFromMenu(MB.state.menu, dayIndex);
    const dayF = global.MenuEngine.getDayFatFromMenu(MB.state.menu, dayIndex);

    const maxK = normalizeLimitToInfinity(p.calorieMax);
    const maxC = normalizeLimitToInfinity(p.carbMax);
    const maxF = normalizeLimitToInfinity(p.fatMax);

    return {
      max: { kcalMax: maxK, carbMax: maxC, fatMax: maxF },
      used: { kcal: dayK, carb: dayC, fat: dayF },
      remaining: {
        kcalMax: maxK - dayK,
        carbMax: maxC - dayC,
        fatMax: maxF - dayF,
      },
    };
  }

  function getAddableTypesForDayUnderLimits(dayIndex) {
    const types = getAllSlotTypesForAdd();
    const { remaining } = buildRemainingLimitsForDay(dayIndex);

    return types.filter((t) => {
      const pool = MB.state.pools?.[t.value] || [];
      if (!Array.isArray(pool) || pool.length === 0) return false;

      // Au moins 1 recette doit passer les plafonds restants.
      return pool.some((r) => {
        return (
          global.MenuEngine.getRecipeCalories(r) <= remaining.kcalMax &&
          global.MenuEngine.getRecipeNetCarbs(r) <= remaining.carbMax &&
          global.MenuEngine.getRecipeFat(r) <= remaining.fatMax
        );
      });
    });
  }

  function formatRemainingHint(dayIndex) {
    const { max, used, remaining } = buildRemainingLimitsForDay(dayIndex);

    const hasAnyLimit = max.kcalMax !== Infinity || max.carbMax !== Infinity || max.fatMax !== Infinity;
    if (!hasAnyLimit) {
      return "Aucun plafond défini : toutes les catégories avec recettes sont proposées.";
    }

    const overParts = [];
    if (max.kcalMax !== Infinity && used.kcal > max.kcalMax) overParts.push("kcal");
    if (max.carbMax !== Infinity && used.carb > max.carbMax) overParts.push("glucides nets");
    if (max.fatMax !== Infinity && used.fat > max.fatMax) overParts.push("lipides");

    if (overParts.length > 0) {
      return `Plafond déjà dépassé (${overParts.join(", ")}) : ajout impossible sans dépasser.`;
    }

    const parts = [];
    if (max.kcalMax !== Infinity) parts.push(`Kcal restantes : ${Math.round(Math.max(0, remaining.kcalMax))} kcal`);
    if (max.carbMax !== Infinity) parts.push(`Glucides nets restants : ${Math.round(Math.max(0, remaining.carbMax) * 10) / 10} g`);
    if (max.fatMax !== Infinity) parts.push(`Lipides restants : ${Math.round(Math.max(0, remaining.fatMax) * 10) / 10} g`);
    return parts.join(" | ");
  }

  // ---------------------------------------------------------------------------
  // Modal “Ajouter un slot”
  // ---------------------------------------------------------------------------

  MB.ensureAddSlotModalExists = function ensureAddSlotModalExists() {
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

        <div class="form-text mt-2" id="addSlotHint"></div>
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

    document.getElementById("addSlotModal").addEventListener("shown.bs.modal", () => {
      MB.refreshAddSlotTypeOptions();
    });

    document.getElementById("addSlotModal").addEventListener("hidden.bs.modal", () => {
      MB.state.addCtx = null;
    });

    document.getElementById("confirmAddSlot").addEventListener("click", () => {
      MB.confirmAddSlot();
    });
  };

  MB.refreshAddSlotTypeOptions = function refreshAddSlotTypeOptions() {
    const sel = document.getElementById("addSlotType");
    const hint = document.getElementById("addSlotHint");
    const confirmBtn = document.getElementById("confirmAddSlot");
    if (!sel || !hint || !confirmBtn) return;

    sel.innerHTML = "";

    const ctx = MB.state.addCtx;
    if (!ctx || !Number.isFinite(ctx.day) || !Number.isFinite(ctx.meal)) {
      hint.textContent = "Contexte introuvable (jour/repas non sélectionné).";
      sel.disabled = true;
      confirmBtn.disabled = true;
      return;
    }

    // Diagnostic utile (sans console)
    const poolsKeys = Object.keys(MB.state.pools || {});
    if (poolsKeys.length === 0) {
      hint.textContent = "Aucune recette chargée (pools vides) : impossible de proposer des types.";
      sel.disabled = true;
      confirmBtn.disabled = true;
      return;
    }

    hint.textContent = formatRemainingHint(ctx.day);

    const addable = getAddableTypesForDayUnderLimits(ctx.day);

    if (addable.length === 0) {
      sel.disabled = true;
      confirmBtn.disabled = true;

      // Explication complémentaire (cas typique : types non init OU plafonds trop bas)
      const allTypes = getAllSlotTypesForAdd();
      if (allTypes.length === 0) {
        hint.textContent = "Liste des types introuvable (SLOT_TYPES/ADD_SLOT_TYPES vides). Vérifie l’init MenuBuilder.SLOT_TYPES.";
      } else {
        // On a des types, mais rien d’addable => soit plafonds trop bas, soit pools vides pour ces types.
        hint.textContent = `${formatRemainingHint(ctx.day)} — Aucun type ne passe (plafonds trop bas ou pools vides pour les types).`;
      }
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
  };

  MB.confirmAddSlot = function confirmAddSlot() {
    const ctx = MB.state.addCtx;
    if (!ctx) return;

    const typeSelect = document.getElementById("addSlotType");
    const type = String(typeSelect?.value || "");
    if (!MB.state.menu?.[ctx.day]?.[ctx.meal]) return;

    if (!type) {
      MB.showMessage("Ajout impossible : aucun type ne respecte les plafonds restants.", "warning");
      return;
    }

    const { remaining } = buildRemainingLimitsForDay(ctx.day);

    const recipe = global.MenuEngine.pickRecipeWithLimits(MB.state.pools, type, {
      kcalMax: remaining.kcalMax,
      carbMax: remaining.carbMax,
      fatMax: remaining.fatMax,
    });

    // Bloquant : si aucune recette ne passe, on refuse l’ajout.
    if (recipe === null) {
      MB.showMessage(`Aucune recette "${type}" ne respecte les plafonds restants pour ce jour.`, "warning");
      MB.refreshAddSlotTypeOptions();
      return;
    }

    MB.state.menu[ctx.day][ctx.meal].slots.push({ type, recipe, locked: false });
    MB.state.addCtx = null;

    MB.closeModal("addSlotModal");
    MB.rerender();
  };

  // ---------------------------------------------------------------------------
  // Modal “Choisir une recette”
  // ---------------------------------------------------------------------------

  MB.ensurePickRecipeModalExists = function ensurePickRecipeModalExists() {
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

    document.getElementById("pickRecipeModal").addEventListener("hidden.bs.modal", () => {
      MB.state.pickCtx = null;
      MB._pickRecipeList = [];
      const q = document.getElementById("pickRecipeQuery");
      const all = document.getElementById("pickRecipeAllTypes");
      const res = document.getElementById("pickRecipeResults");
      const hint = document.getElementById("pickRecipeHint");
      if (q) q.value = "";
      if (all) all.checked = false;
      if (res) res.innerHTML = "";
      if (hint) hint.textContent = "";
    });

    document.getElementById("pickRecipeQuery").addEventListener("input", () => MB.refreshPickRecipeResults());
    document.getElementById("pickRecipeAllTypes").addEventListener("change", () => MB.refreshPickRecipeResults());

    document.getElementById("pickRecipeResults").addEventListener("click", (e) => {
      const btn = e.target?.closest?.("button[data-recipe-idx]");
      if (!btn) return;
      const idx = parseInt(btn.getAttribute("data-recipe-idx"), 10);
      if (!Number.isFinite(idx)) return;
      MB.confirmPickRecipe(idx);
    });

    document.getElementById("pickRecipeModal").addEventListener("shown.bs.modal", () => {
      MB.refreshPickRecipeResults();
      document.getElementById("pickRecipeQuery")?.focus();
    });
  };

  MB.refreshPickRecipeResults = function refreshPickRecipeResults() {
    const ctx = MB.state.pickCtx;
    const hint = document.getElementById("pickRecipeHint");
    const res = document.getElementById("pickRecipeResults");
    const q = document.getElementById("pickRecipeQuery");
    const all = document.getElementById("pickRecipeAllTypes");

    if (!hint || !res || !q || !all) return;

    res.innerHTML = "";

    if (!ctx) {
      hint.textContent = "Contexte introuvable (slot non sélectionné).";
      return;
    }

    const slot = MB.state.menu?.[ctx.day]?.[ctx.meal]?.slots?.[ctx.slot];
    if (!slot) {
      hint.textContent = "Slot introuvable.";
      return;
    }

    const query = String(q.value || "").trim().toLowerCase();

    const type = String(slot.type || "");
    const pool = all.checked ? MB.state.recipes : MB.state.pools?.[type] || [];

    const filtered = (Array.isArray(pool) ? pool : []).filter((r) => {
      if (!query) return true;
      const hay = `${r?.recipe_title || ""} ${r?.title || ""} ${r?.description || ""}`.toLowerCase();
      return hay.includes(query);
    });

    hint.textContent = `${filtered.length} résultat(s)`;

    const maxShow = 60;
    const slice = filtered.slice(0, maxShow);

    slice.forEach((r, i) => {
      const name = r?.recipe_title || r?.title || "Recette";
      const kcal = global.MenuEngine.getRecipeCalories(r);
      const carbs = global.MenuEngine.getRecipeNetCarbs(r);
      const fat = global.MenuEngine.getRecipeFat(r);
      const prot = typeof global.MenuEngine.getRecipeProtein === "function" ? global.MenuEngine.getRecipeProtein(r) : 0;

      const item = document.createElement("div");
      item.className = "list-group-item d-flex justify-content-between align-items-start gap-2";

      item.innerHTML = `
        <div class="flex-grow-1">
          <div class="fw-semibold">${MB.escapeHtml(name)}</div>
          <div class="small text-muted">
            ${kcal} kcal · P ${Math.round(prot * 10) / 10} g · G ${Math.round(carbs * 10) / 10} g · L ${Math.round(fat * 10) / 10} g
          </div>
        </div>
        <button class="btn btn-sm btn-outline-primary" type="button" data-recipe-idx="${i}">
          Choisir
        </button>
      `;
      res.appendChild(item);
    });

    if (filtered.length > maxShow) {
      const more = document.createElement("div");
      more.className = "small text-muted mt-2";
      more.textContent = `Affichage limité à ${maxShow} résultats. Affine la recherche.`;
      res.appendChild(more);
    }

    MB._pickRecipeList = slice;
  };

  MB.confirmPickRecipe = function confirmPickRecipe(idx) {
    const ctx = MB.state.pickCtx;
    if (!ctx) return;

    const list = Array.isArray(MB._pickRecipeList) ? MB._pickRecipeList : [];
    const picked = list[idx];
    if (!picked) return;

    const slot = MB.state.menu?.[ctx.day]?.[ctx.meal]?.slots?.[ctx.slot];
    if (!slot) return;

    const { remaining } = buildRemainingLimitsForDay(ctx.day);

    const kcal = global.MenuEngine.getRecipeCalories(picked);
    const carbs = global.MenuEngine.getRecipeNetCarbs(picked);
    const fat = global.MenuEngine.getRecipeFat(picked);

    const ok = kcal <= remaining.kcalMax && carbs <= remaining.carbMax && fat <= remaining.fatMax;
    if (!ok) {
      MB.showMessage("Cette recette ferait dépasser au moins un plafond pour ce jour (bloquant).", "warning");
      return;
    }

    slot.recipe = picked;
    slot.locked = false;

    MB.closeModal("pickRecipeModal");
    MB.rerender();
  };
})(window);
