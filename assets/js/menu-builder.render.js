/* ==============================================================================
menu-builder.render.js — UI (rendu grille via <template>)
==============================================================================
Rôle
- Construire l’UI du menu à partir de templates HTML.
- Injecter les data-attrs nécessaires à la délégation d’événements.

Contrats
- Templates requis dans la page :
  • #tpl-menu-day   (hooks .js-day-title/.js-meals-wrap/.js-day-total)
  • #tpl-menu-meal  (hooks .js-meal-title/.js-slots-wrap + bouton data-action="add-slot")
  • #tpl-menu-slot  (hooks .js-slot-box/.js-recipe-line + contrôles data-action)
============================================================================== */

"use strict";

(function attachMenuBuilderRender(global) {
  const MB = global.MenuBuilder;

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
    return root || null;
  }

  MB.renderMenu = function renderMenu({ calorieTarget = 0, weekStart = 1, mealsPerDay = 3, daysCount = 3 } = {}) {
    const grid = MB.dom.grid || document.getElementById("menuGrid");
    if (!grid) return;

    grid.innerHTML = "";

    if (!Array.isArray(MB.state.menu) || MB.state.menu.length === 0) return;

    const dayTpl = getTemplate("tpl-menu-day");
    const mealTpl = getTemplate("tpl-menu-meal");
    const slotTpl = getTemplate("tpl-menu-slot");

    if (!dayTpl || !mealTpl || !slotTpl) {
      MB.showMessage(
        "Templates manquants : #tpl-menu-day / #tpl-menu-meal / #tpl-menu-slot. Vérifie que la page menu inclut bien les <template> requis.",
        "danger"
      );
      return;
    }

    const mealLabels = MB.MEAL_LABELS_BY_COUNT[mealsPerDay] || MB.MEAL_LABELS_BY_COUNT[3];
    const hasMax = Number.isFinite(calorieTarget) && calorieTarget > 0;

    const safeDaysCount = Math.max(1, Math.min(7, parseInt(daysCount, 10) || 3));

    MB.state.menu.slice(0, safeDaysCount).forEach((dayMeals, dayOffset) => {
      const dayIndex = getDayIndex(dayOffset, weekStart);
      const dayLabel = MB.DAYS[dayIndex];

      const dayCard = cloneTemplate("tpl-menu-day");
      if (!dayCard) {
        MB.showMessage("Template jour invalide (clone impossible).", "danger");
        return;
      }

      const dayTitleEl = dayCard.querySelector(".js-day-title");
      const mealsWrap = dayCard.querySelector(".js-meals-wrap");
      const dayTotalEl = dayCard.querySelector(".js-day-total");

      if (!dayTitleEl || !mealsWrap || !dayTotalEl) {
        MB.showMessage("Template jour invalide (hooks .js-day-title/.js-meals-wrap/.js-day-total manquants).", "danger");
        return;
      }

      dayTitleEl.textContent = dayLabel;

      let totalCalories = 0;

      dayMeals.forEach((mealObj, mealIndex) => {
        const slots = Array.isArray(mealObj?.slots) ? mealObj.slots : [];

        const mealCard = cloneTemplate("tpl-menu-meal");
        if (!mealCard) {
          MB.showMessage("Template repas invalide (clone impossible).", "danger");
          return;
        }

        const mealTitleEl = mealCard.querySelector(".js-meal-title");
        const slotsWrap = mealCard.querySelector(".js-slots-wrap");
        const addBtn = mealCard.querySelector("button[data-action='add-slot']");

        if (!mealTitleEl || !slotsWrap || !addBtn) {
          MB.showMessage("Template repas invalide (hooks .js-meal-title/.js-slots-wrap ou bouton add-slot manquants).", "danger");
          return;
        }

        mealTitleEl.textContent = mealLabels[mealIndex] || `Repas ${mealIndex + 1}`;

        addBtn.setAttribute("data-day", String(dayOffset));
        addBtn.setAttribute("data-meal", String(mealIndex));

        slots.forEach((slotObj, slotIndex) => {
          const slotBox = cloneTemplate("tpl-menu-slot");
          if (!slotBox) {
            MB.showMessage("Template slot invalide (clone impossible).", "danger");
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
            MB.showMessage("Template slot invalide (hooks .js-slot-box/.js-recipe-line ou contrôles manquants).", "danger");
            return;
          }

          if (slotObj.locked) box.classList.add("bg-warning-subtle", "border-warning", "border-2");
          else box.classList.remove("bg-warning-subtle", "border-warning", "border-2");

          for (const el of [typeSelect, lockBtn, pickBtn, rerollBtn, removeBtn]) {
            el.setAttribute("data-day", String(dayOffset));
            el.setAttribute("data-meal", String(mealIndex));
            el.setAttribute("data-slot", String(slotIndex));
          }

          // Types (source unique : MenuEngine -> MB.SLOT_TYPES)
          typeSelect.innerHTML = "";
          for (const t of MB.SLOT_TYPES) {
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
          const url = MB.normalizeRecipeUrl(rawUrl);
          const kcal = global.MenuEngine.getRecipeCalories(r);

          if (Number.isFinite(kcal) && kcal > 0) totalCalories += kcal;

          if (r) {
            recipeLine.innerHTML =
              `<a href="${MB.escapeHtml(url)}" target="_blank" rel="noopener">` +
              `<strong>${MB.escapeHtml(title)}</strong></a> — ${kcal > 0 ? kcal : "—"} kcal`;
          } else {
            recipeLine.innerHTML = `<span class="text-muted"><strong>${MB.escapeHtml(title)}</strong></span>`;
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
  };
})(window);
