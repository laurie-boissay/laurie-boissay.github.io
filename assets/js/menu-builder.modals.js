/* ==============================================================================
menu-builder.modals.js — UI (Bootstrap modals)
==============================================================================
Rôle
- Créer et gérer les modales :
  • "Ajouter un slot"
  • "Rechercher une recette"
- Isoler la logique de construction HTML modale + open/close + render des résultats.

Contrat
- La logique métier (tirage, kcal) reste dans MenuEngine.
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

    if (MB.modalCache.has(id)) return MB.modalCache.get(id);

    const existing = global.bootstrap.Modal.getInstance(el);
    if (existing) {
      MB.modalCache.set(id, existing);
      return existing;
    }

    const inst = new global.bootstrap.Modal(el);
    MB.modalCache.set(id, inst);
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
    if (!ctx || !Number.isFinite(ctx.day)) {
      hint.textContent = "Contexte introuvable (jour/repas non sélectionné).";
      sel.disabled = true;
      confirmBtn.disabled = true;
      return;
    }

    const { calorieMax } = MB.readParams();
    const used = global.MenuEngine.getDayCaloriesFromMenu(MB.state.menu, ctx.day);
    const remaining = Number.isFinite(calorieMax) && calorieMax > 0 ? calorieMax - used : Infinity;

    const addable = global.MenuEngine.getAddableTypesForDay(
      MB.state.menu,
      MB.state.pools,
      ctx.day,
      calorieMax,
      MB.ADD_SLOT_TYPES
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
  };

  MB.confirmAddSlot = function confirmAddSlot() {
    const ctx = MB.state.addCtx;
    if (!ctx) return;

    const typeSelect = document.getElementById("addSlotType");
    const type = String(typeSelect?.value || "");
    if (!MB.state.menu?.[ctx.day]?.[ctx.meal]) return;

    if (!type) {
      MB.showMessage("Impossible d’ajouter : aucune catégorie ne rentre dans les kcal restantes pour ce jour.", "warning");
      return;
    }

    const { calorieMax } = MB.readParams();
    const used = global.MenuEngine.getDayCaloriesFromMenu(MB.state.menu, ctx.day);
    const remaining = Number.isFinite(calorieMax) && calorieMax > 0 ? calorieMax - used : Infinity;

    const recipe = global.MenuEngine.pickRecipeWithCalorieLimit(MB.state.pools, type, remaining);

    if (Number.isFinite(calorieMax) && calorieMax > 0 && recipe === null) {
      MB.showMessage(
        `Aucune recette "${type}" ne rentre dans les ${Math.max(0, remaining)} kcal restantes pour ce jour. Je retire ce type de la liste.`,
        "warning"
      );
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

    const input = document.getElementById("pickRecipeQuery");
    const allTypes = document.getElementById("pickRecipeAllTypes");

    let t = null;
    const trigger = () => {
      if (t) clearTimeout(t);
      t = setTimeout(MB.renderPickResults, 120);
    };

    input.addEventListener("input", trigger);
    allTypes.addEventListener("change", MB.renderPickResults);

    document.getElementById("pickRecipeModal").addEventListener("shown.bs.modal", () => {
      input.value = "";
      allTypes.checked = false;
      input.focus();
      MB.renderPickResults();
    });

    document.getElementById("pickRecipeModal").addEventListener("hidden.bs.modal", () => {
      MB.state.pickCtx = null;
    });
  };

  MB.renderPickResults = function renderPickResults() {
    const results = document.getElementById("pickRecipeResults");
    const hint = document.getElementById("pickRecipeHint");
    if (!results || !hint) return;

    const q = String(document.getElementById("pickRecipeQuery")?.value || "").trim().toLowerCase();
    const allTypes = !!document.getElementById("pickRecipeAllTypes")?.checked;

    results.innerHTML = "";

    const ctx = MB.state.pickCtx;
    if (!ctx) {
      hint.textContent = "Contexte introuvable (slot non sélectionné).";
      return;
    }

    const slot = MB.state.menu?.[ctx.day]?.[ctx.meal]?.slots?.[ctx.slot];
    if (slot?.locked) {
      hint.textContent = "Slot verrouillé : recherche désactivée.";
      return;
    }

    const slotType = slot?.type || MB.DEFAULT_SLOT_TYPE;
    const baseList = allTypes ? MB.state.recipes : MB.state.pools[slotType] || [];

    hint.textContent = allTypes
      ? `Recherche dans toutes les recettes (groupe du slot : ${slotType}).`
      : `Recherche dans les recettes du groupe : ${slotType}.`;

    let filtered = baseList;
    if (q.length > 0) filtered = baseList.filter((r) => String(r?.title || "").toLowerCase().includes(q));
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
        <div><strong>${MB.escapeHtml(title)}</strong> <span class="text-muted">${MB.escapeHtml(group)}</span></div>
        <div class="text-muted">${MB.escapeHtml(kcal)}</div>
      </div>`;

      btn.addEventListener("click", () => MB.applyPickedRecipe(r));
      results.appendChild(btn);
    }
  };

  MB.applyPickedRecipe = function applyPickedRecipe(recipe) {
    const ctx = MB.state.pickCtx;
    if (!ctx) return;

    const s = MB.state.menu?.[ctx.day]?.[ctx.meal]?.slots?.[ctx.slot];
    if (!s) return;

    if (s.locked) {
      MB.showMessage("Slot verrouillé : tu dois d’abord déverrouiller pour changer la recette.", "warning");
      return;
    }

    const { calorieMax } = MB.readParams();
    const currentSlotKcal = global.MenuEngine.getRecipeCalories(s?.recipe);
    const dayTotal = global.MenuEngine.getDayCaloriesFromMenu(MB.state.menu, ctx.day);
    const remaining =
      Number.isFinite(calorieMax) && calorieMax > 0 ? calorieMax - (dayTotal - currentSlotKcal) : Infinity;

    const pickedKcal = global.MenuEngine.getRecipeCalories(recipe);
    if (Number.isFinite(calorieMax) && calorieMax > 0 && pickedKcal > remaining) {
      MB.showMessage(
        `Recette trop calorique pour ce jour : ${pickedKcal} kcal (MAX restant : ${Math.max(0, remaining)} kcal).`,
        "warning"
      );
      return;
    }

    s.recipe = recipe;
    s.locked = true;

    MB.state.pickCtx = null;
    MB.closeModal("pickRecipeModal");
    MB.rerender();
  };
})(window);
