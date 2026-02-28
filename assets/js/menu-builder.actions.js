/* ==============================================================================
menu-builder.actions.js — UI (délégation événements + actions)
==============================================================================
Rôle
- Gérer les interactions sur la grille via délégation :
  • add-slot / remove-slot / reroll-slot / toggle-lock / pick-recipe
  • change-type (select)
- Centraliser generateMenu / rerender.

Contrat
- Ne fait pas de rendu direct : utilise MenuBuilder.renderMenu().
============================================================================== */

"use strict";

(function attachMenuBuilderActions(global) {
  const MB = global.MenuBuilder;

  // ---------------------------------------------------------------------------
  // Génération / rerender
  // ---------------------------------------------------------------------------

  MB.generateMenu = function generateMenu() {
    if (!Array.isArray(MB.state.recipes) || MB.state.recipes.length === 0) {
      MB.showMessage("Aucune recette disponible. Le menu ne peut pas être généré.", "danger");
      return;
    }

    MB.hideMessage();

    const { mealsPerDay, weekStart, daysCount, calorieMax } = MB.readParams();

    const hasExisting = Array.isArray(MB.state.menu) && MB.state.menu.length === 7;
    const baseMenu = hasExisting ? MB.state.menu : global.MenuEngine.createFreshSkeleton(MB.state.pools, mealsPerDay);

    const newMenu = global.MenuEngine.buildMenuUnderCalorieMax(MB.state.pools, baseMenu, mealsPerDay, calorieMax);

    // Analyse limitée aux jours affichés (UX : éviter des warnings sur des jours masqués).
    const status = (() => {
      const out = { max: calorieMax, overs: [], empties: 0 };
      const hasMax = Number.isFinite(calorieMax) && calorieMax > 0;

      // weekStart: 1..6 = Lundi..Samedi, 0 = Dimanche (contrat UI)
      const startIndex = weekStart === 0 ? 6 : weekStart - 1;
      const getDayIndex = (dayOffset) => (startIndex + dayOffset) % 7;

      for (let d = 0; d < daysCount; d++) {
        const total = global.MenuEngine.getDayCaloriesFromMenu(newMenu, d);
        if (hasMax && total > calorieMax) out.overs.push({ dayIndex: getDayIndex(d), total });

        const day = newMenu?.[d] || [];
        for (const meal of day) {
          const slots = Array.isArray(meal?.slots) ? meal.slots : [];
          for (const s of slots) if (!s?.recipe) out.empties += 1;
        }
      }

      return out;
    })();

    if (Number.isFinite(calorieMax) && calorieMax > 0) {
      if (status.overs.length > 0) {
        const days = status.overs.map((x) => `${MB.DAYS[x.dayIndex]} (${x.total} kcal)`).join(", ");
        MB.showMessage(
          `Menu généré, mais certaines journées dépassent le MAX ${calorieMax} kcal/jour. ` +
            `Cause probable : un ou plusieurs slots verrouillés sont trop caloriques. ` +
            `Jours concernés : ${days}. Déverrouille/ajuste des slots, ou augmente le MAX.`,
          "warning"
        );
      } else if (status.empties > 0) {
        MB.showMessage(
          `Menu généré sous le MAX ${calorieMax} kcal/jour, mais ${status.empties} slot(s) n’ont pas pu être remplis ` +
            `sans dépasser le plafond (aucune recette assez légère dans le type).`,
          "warning"
        );
      } else {
        MB.hideMessage();
      }
    }

    MB.state.menu = newMenu;
    MB.renderMenu({ calorieTarget: calorieMax, weekStart, mealsPerDay, daysCount });
  };

  MB.rerender = function rerender() {
    const { mealsPerDay, weekStart, daysCount, calorieMax } = MB.readParams();
    MB.renderMenu({ calorieTarget: calorieMax, weekStart, mealsPerDay, daysCount });
  };

  // ---------------------------------------------------------------------------
  // Interactions sur la grille
  // ---------------------------------------------------------------------------

  MB.setupMenuInteractions = function setupMenuInteractions() {
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

        const { calorieMax } = MB.readParams();
        const dayTotal = global.MenuEngine.getDayCaloriesFromMenu(MB.state.menu, day);
        const currentSlotKcal = global.MenuEngine.getRecipeCalories(s?.recipe);
        const remaining =
          Number.isFinite(calorieMax) && calorieMax > 0 ? calorieMax - (dayTotal - currentSlotKcal) : Infinity;

        const next = global.MenuEngine.pickRecipeWithCalorieLimit(MB.state.pools, s.type, remaining);
        if (Number.isFinite(calorieMax) && calorieMax > 0 && next === null) {
          MB.showMessage(
            `Aucune recette "${s.type}" ne rentre dans les ${Math.max(0, remaining)} kcal restantes pour ce jour.`,
            "warning"
          );
          return;
        }

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

      const newType = String(sel.value || MB.DEFAULT_SLOT_TYPE);
      const { calorieMax } = MB.readParams();

      const dayTotal = global.MenuEngine.getDayCaloriesFromMenu(MB.state.menu, day);
      const currentSlotKcal = global.MenuEngine.getRecipeCalories(s?.recipe);
      const remaining =
        Number.isFinite(calorieMax) && calorieMax > 0 ? calorieMax - (dayTotal - currentSlotKcal) : Infinity;

      const next = global.MenuEngine.pickRecipeWithCalorieLimit(MB.state.pools, newType, remaining);
      if (Number.isFinite(calorieMax) && calorieMax > 0 && next === null) {
        MB.showMessage(
          `Impossible de passer ce slot en "${newType}" : aucune recette ne rentre dans les ${Math.max(0, remaining)} kcal restantes pour ce jour.`,
          "warning"
        );
        sel.value = s.type;
        return;
      }

      s.type = newType;
      s.recipe = next;
      s.locked = false;

      MB.rerender();
    });
  };
})(window);
