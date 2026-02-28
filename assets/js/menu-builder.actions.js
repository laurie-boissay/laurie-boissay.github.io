/* ==============================================================================
menu-builder.actions.js — UI (délégation événements + actions)
==============================================================================
Rôle
- Générer / rerender le menu.
- Appliquer les contraintes bloquantes : kcal + glucides nets + lipides.
- Gérer les interactions (reroll / change-type) en respectant les plafonds.
- Gérer le picker “jours affichés” (bouton 1..7) et rerender.

Contrat
- Ne fait pas de rendu direct : utilise MenuBuilder.renderMenu().
============================================================================== */

"use strict";

(function attachMenuBuilderActions(global) {
  const MB = global.MenuBuilder;

  function buildLimitsFromParams(params) {
    return {
      kcalMax: params.calorieMax,
      carbMax: params.carbMax,
      fatMax: params.fatMax,
    };
  }

  function formatOvers(overs, getDayLabel, unit) {
    return overs.map((x) => `${getDayLabel(x.dayIndex)} (${Math.round(x.total * 10) / 10} ${unit})`).join(", ");
  }

  function normalizeDaysCountLabel(n) {
    return n === 1 ? "Afficher 1 jour" : `Afficher ${n} jours`;
  }

  MB.setupDaysCountPicker = function setupDaysCountPicker() {
    const input = document.getElementById("daysCount");
    const btn = document.getElementById("daysCountBtn");
    if (!input || !btn) return;

    // Init label (au chargement)
    const initial = parseInt(input.value, 10);
    const safeInitial = Math.max(1, Math.min(7, Number.isFinite(initial) ? initial : 3));
    input.value = String(safeInitial);
    btn.textContent = normalizeDaysCountLabel(safeInitial);

    // Délégation sur les items dropdown
    btn.closest(".btn-group")?.addEventListener("click", (e) => {
      const item = e.target?.closest?.("button[data-days]");
      if (!item) return;

      const n = parseInt(item.getAttribute("data-days"), 10);
      if (!Number.isFinite(n)) return;

      const safe = Math.max(1, Math.min(7, n));
      input.value = String(safe);
      btn.textContent = normalizeDaysCountLabel(safe);

      // Rerender sans régénérer
      MB.rerender?.();
    });
  };

  // ---------------------------------------------------------------------------
  // Génération / rerender
  // ---------------------------------------------------------------------------

  MB.generateMenu = function generateMenu() {
    if (!Array.isArray(MB.state.recipes) || MB.state.recipes.length === 0) {
      MB.showMessage("Aucune recette disponible. Le menu ne peut pas être généré.", "danger");
      return;
    }

    MB.hideMessage();

    const params = MB.readParams();
    const limits = buildLimitsFromParams(params);

    const hasExisting = Array.isArray(MB.state.menu) && MB.state.menu.length === 7;
    const baseMenu = hasExisting ? MB.state.menu : global.MenuEngine.createFreshSkeleton(MB.state.pools, params.mealsPerDay);

    // Plafonds bloquants : kcal + glucides nets + lipides
    const newMenu = global.MenuEngine.buildMenuUnderLimits(MB.state.pools, baseMenu, params.mealsPerDay, limits);

    // Analyse : dépassements (souvent slots verrouillés) + slots vides (bloquant)
    const status = global.MenuEngine.computeLimitsStatus(newMenu, limits, params.daysCount);

    const getDayLabel = (dayOffset) => {
      const startIndex = params.weekStart === 0 ? 6 : params.weekStart - 1;
      const dayIndex = (startIndex + dayOffset) % 7;
      return MB.DAYS[dayIndex];
    };

    const parts = [];

    if (status.overs.kcal.length > 0) parts.push(`Kcal dépassées : ${formatOvers(status.overs.kcal, getDayLabel, "kcal")}`);
    if (status.overs.carb.length > 0) parts.push(`Glucides nets dépassés : ${formatOvers(status.overs.carb, getDayLabel, "g")}`);
    if (status.overs.fat.length > 0) parts.push(`Lipides dépassés : ${formatOvers(status.overs.fat, getDayLabel, "g")}`);

    if (parts.length > 0) {
      MB.showMessage(
        `Menu généré, mais certains plafonds sont dépassés (cause probable : slots verrouillés). ${parts.join(" | ")}.`,
        "warning"
      );
    } else if (status.empties > 0) {
      MB.showMessage(
        `Menu généré, mais ${status.empties} slot(s) n’ont pas pu être remplis sans dépasser au moins un plafond (bloquant).`,
        "warning"
      );
    } else {
      MB.hideMessage();
    }

    MB.state.menu = newMenu;

    MB.renderMenu({
      calorieTarget: params.calorieMax,
      carbMax: params.carbMax,
      fatMax: params.fatMax,
      weekStart: params.weekStart,
      mealsPerDay: params.mealsPerDay,
      daysCount: params.daysCount,
    });
  };

  MB.rerender = function rerender() {
    const params = MB.readParams();
    MB.renderMenu({
      calorieTarget: params.calorieMax,
      carbMax: params.carbMax,
      fatMax: params.fatMax,
      weekStart: params.weekStart,
      mealsPerDay: params.mealsPerDay,
      daysCount: params.daysCount,
    });
  };

  // ---------------------------------------------------------------------------
  // Interactions sur la grille
  // ---------------------------------------------------------------------------

  MB.setupMenuInteractions = function setupMenuInteractions() {
    MB.setupDaysCountPicker?.();

    const grid = MB.dom.grid || document.getElementById("menuGrid");
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
        MB.state.addCtx = { day, meal };
        MB.openModal("addSlotModal");
        return;
      }

      if (!Number.isFinite(slot)) return;

      const slots = MB.state.menu?.[day]?.[meal]?.slots;
      if (!Array.isArray(slots)) return;

      const s = slots[slot];

      if (action === "remove-slot") {
        if (!s) return;
        if (s.locked) {
          MB.showMessage("Slot verrouillé : suppression interdite. Déverrouille d’abord.", "warning");
          return;
        }
        if (slots.length <= 1) return;
        slots.splice(slot, 1);
        MB.rerender();
        return;
      }

      if (action === "reroll-slot") {
        if (!s || s.locked) return;

        const p = MB.readParams();
        const limits = buildLimitsFromParams(p);

        const dayK = global.MenuEngine.getDayCaloriesFromMenu(MB.state.menu, day);
        const dayC = global.MenuEngine.getDayNetCarbsFromMenu(MB.state.menu, day);
        const dayF = global.MenuEngine.getDayFatFromMenu(MB.state.menu, day);

        const curK = global.MenuEngine.getRecipeCalories(s?.recipe);
        const curC = global.MenuEngine.getRecipeNetCarbs(s?.recipe);
        const curF = global.MenuEngine.getRecipeFat(s?.recipe);

        // Reroll : on “retire” le slot actuel, puis tirage sous plafonds restants.
        const remK = (limits.kcalMax > 0 ? limits.kcalMax : Infinity) - (dayK - curK);
        const remC = (limits.carbMax > 0 ? limits.carbMax : Infinity) - (dayC - curC);
        const remF = (limits.fatMax > 0 ? limits.fatMax : Infinity) - (dayF - curF);

        const next = global.MenuEngine.pickRecipeWithLimits(MB.state.pools, s.type, {
          kcalMax: remK,
          carbMax: remC,
          fatMax: remF,
        });

        // Bloquant : si aucune recette ne passe, slot vidé (visible).
        s.recipe = next;
        MB.rerender();
        return;
      }

      if (action === "toggle-lock") {
        if (!s) return;
        s.locked = !s.locked;
        MB.rerender();
        return;
      }

      if (action === "pick-recipe") {
        if (!s) return;
        if (s.locked) {
          MB.showMessage("Slot verrouillé : recherche interdite. Déverrouille d’abord.", "warning");
          return;
        }
        MB.state.pickCtx = { day, meal, slot };
        MB.openModal("pickRecipeModal");
      }
    });

    grid.addEventListener("change", (e) => {
      const sel = e.target?.closest?.("select[data-action='change-type']");
      if (!sel) return;

      const day = parseInt(sel.getAttribute("data-day"), 10);
      const meal = parseInt(sel.getAttribute("data-meal"), 10);
      const slot = parseInt(sel.getAttribute("data-slot"), 10);
      if (!Number.isFinite(day) || !Number.isFinite(meal) || !Number.isFinite(slot)) return;

      const s = MB.state.menu?.[day]?.[meal]?.slots?.[slot];
      if (!s) return;

      if (s.locked) {
        MB.showMessage("Slot verrouillé : changement de type interdit. Déverrouille d’abord.", "warning");
        sel.value = s.type;
        return;
      }

      const p = MB.readParams();
      const limits = buildLimitsFromParams(p);

      const newType = String(sel.value || MB.DEFAULT_SLOT_TYPE);

      const dayK = global.MenuEngine.getDayCaloriesFromMenu(MB.state.menu, day);
      const dayC = global.MenuEngine.getDayNetCarbsFromMenu(MB.state.menu, day);
      const dayF = global.MenuEngine.getDayFatFromMenu(MB.state.menu, day);

      const curK = global.MenuEngine.getRecipeCalories(s?.recipe);
      const curC = global.MenuEngine.getRecipeNetCarbs(s?.recipe);
      const curF = global.MenuEngine.getRecipeFat(s?.recipe);

      const remK = (limits.kcalMax > 0 ? limits.kcalMax : Infinity) - (dayK - curK);
      const remC = (limits.carbMax > 0 ? limits.carbMax : Infinity) - (dayC - curC);
      const remF = (limits.fatMax > 0 ? limits.fatMax : Infinity) - (dayF - curF);

      const next = global.MenuEngine.pickRecipeWithLimits(MB.state.pools, newType, {
        kcalMax: remK,
        carbMax: remC,
        fatMax: remF,
      });

      // Bloquant : type accepté, mais slot vide si impossible.
      s.type = newType;
      s.recipe = next;
      s.locked = false;

      MB.rerender();
    });
  };
})(window);
