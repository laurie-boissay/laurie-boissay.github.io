/* ==============================================================================
menu-builder.render.js — UI (rendu grille via <template>)
==============================================================================
Rôle
- Rendre le menu sur N jours (défaut 3).
- Afficher les compteurs jour : kcal + glucides nets + lipides + protéines.
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

  function fmt1(n) {
    const x = Math.round((Number(n) || 0) * 10) / 10;
    return String(x).replace(".0", "");
  }

  MB.renderMenu = function renderMenu({
    calorieTarget = 0,
    carbMax = 0,
    fatMax = 0,
    weekStart = 1,
    mealsPerDay = 3,
    daysCount = 3,
  } = {}) {
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
    const hasKMax = Number.isFinite(calorieTarget) && calorieTarget > 0;
    const hasCMax = Number.isFinite(carbMax) && carbMax > 0;
    const hasFMax = Number.isFinite(fatMax) && fatMax > 0;

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
      let totalNetCarbs = 0;
      let totalFat = 0;
      let totalProtein = 0;

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
          rerollBtn.disabled = !!slotObj.locked;

          // Permet de supprimer aussi le dernier slot d’un repas.
          // Contrat UX : un repas peut temporairement avoir 0 slot ; le bouton "+" permet d’en recréer.
          removeBtn.disabled = !!slotObj.locked;

          const r = slotObj.recipe;
          const title = r?.title ?? "— (non rempli)";
          const rawUrl = r?.url ?? "#";
          const url = MB.normalizeRecipeUrl(rawUrl);

          const kcal = global.MenuEngine.getRecipeCalories(r);
          const netCarbs = global.MenuEngine.getRecipeNetCarbs(r);
          const fat = global.MenuEngine.getRecipeFat(r);
          const prot = global.MenuEngine.getRecipeProtein(r);

          totalCalories += kcal;
          totalNetCarbs += netCarbs;
          totalFat += fat;
          totalProtein += prot;

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

      // Kcal (MAX + reste)
      if (hasKMax) {
        const rem = calorieTarget - totalCalories;
        dayTotalEl.innerHTML =
          `<strong>Total :</strong> ${totalCalories} kcal ` +
          `<span class="text-muted">(MAX : ${calorieTarget} kcal | Reste : ${rem})</span>`;
        if (rem < 0) dayTotalEl.innerHTML += ` <span class="badge text-bg-danger ms-2">Dépassement</span>`;
      } else {
        dayTotalEl.innerHTML = `<strong>Total :</strong> ${totalCalories} kcal`;
      }

      // Glucides nets (MAX + reste)
      if (hasCMax) {
        const rem = carbMax - totalNetCarbs;
        dayTotalEl.innerHTML +=
          `<br><strong>Glucides nets :</strong> ${fmt1(totalNetCarbs)} g ` +
          `<span class="text-muted">(MAX : ${carbMax} g | Reste : ${fmt1(rem)})</span>`;
        if (rem < 0) dayTotalEl.innerHTML += ` <span class="badge text-bg-danger ms-2">Dépassement</span>`;
      } else {
        dayTotalEl.innerHTML += `<br><strong>Glucides nets :</strong> ${fmt1(totalNetCarbs)} g`;
      }

      // Lipides (MAX + reste)
      if (hasFMax) {
        const rem = fatMax - totalFat;
        dayTotalEl.innerHTML +=
          `<br><strong>Lipides :</strong> ${fmt1(totalFat)} g ` +
          `<span class="text-muted">(MAX : ${fatMax} g | Reste : ${fmt1(rem)})</span>`;
        if (rem < 0) dayTotalEl.innerHTML += ` <span class="badge text-bg-danger ms-2">Dépassement</span>`;
      } else {
        dayTotalEl.innerHTML += `<br><strong>Lipides :</strong> ${fmt1(totalFat)} g`;
      }

      // Protéines (affichage simple)
      dayTotalEl.innerHTML += `<br><strong>Protéines :</strong> ${fmt1(totalProtein)} g`;

      grid.appendChild(dayCard);
    });
  };
})(window);
