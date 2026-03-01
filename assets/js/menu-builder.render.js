/* ==============================================================================
menu-builder.render.js — UI (rendu grille via <template>)
==============================================================================
Rôle
- Rendre le menu sur N jours (défaut 3) à partir de MenuBuilder.state.menu.
- Afficher les totaux par jour (kcal, glucides nets, lipides, protéines).
- Afficher le total de protéines par repas (et optionnellement un repère ~0,3 g/kg).

Dépendances
- window.MenuBuilder (helpers + state)
- window.MenuEngine (calculs nutrition)
- Templates requis dans menu.html :
  - #tpl-menu-day (hooks .js-day-title .js-meals-wrap .js-day-total)
  - #tpl-menu-meal (hooks .js-meal-title .js-meal-total .js-slots-wrap + bouton add-slot)
  - #tpl-menu-slot (hooks .js-slot-box .js-recipe-line + contrôles)
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

  function readProteinWeightKgFallback() {
    const el = document.getElementById("proteinWeightKg");
    if (!el) return 0;
    const v = Number(el.value);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  MB.renderMenu = function renderMenu({
    calorieTarget = 0,
    carbMax = 0,
    fatMax = 0,
    proteinWeightKg = undefined, // optionnel : repère protéines/repas (~0,3 g/kg)
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
        "Templates manquants : #tpl-menu-day / #tpl-menu-meal / #tpl-menu-slot. Vérifie que menu.html inclut bien les <template> requis.",
        "danger"
      );
      return;
    }

    const mealLabels = MB.MEAL_LABELS_BY_COUNT[mealsPerDay] || MB.MEAL_LABELS_BY_COUNT[3];

    const hasKMax = Number.isFinite(calorieTarget) && calorieTarget > 0;
    const hasCMax = Number.isFinite(carbMax) && carbMax > 0;
    const hasFMax = Number.isFinite(fatMax) && fatMax > 0;

    // Repère protéines/repas (optionnel)
    const w = Number.isFinite(Number(proteinWeightKg)) && Number(proteinWeightKg) > 0
      ? Number(proteinWeightKg)
      : readProteinWeightKgFallback();

    const hasMealProtTarget = Number.isFinite(w) && w > 0;
    const mealProtTarget = hasMealProtTarget ? (0.3 * w) : 0;

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

      (Array.isArray(dayMeals) ? dayMeals : []).forEach((mealObj, mealIndex) => {
        const slots = Array.isArray(mealObj?.slots) ? mealObj.slots : [];

        const mealCard = cloneTemplate("tpl-menu-meal");
        if (!mealCard) {
          MB.showMessage("Template repas invalide (clone impossible).", "danger");
          return;
        }

        const mealTitleEl = mealCard.querySelector(".js-meal-title");
        const mealTotalEl = mealCard.querySelector(".js-meal-total");
        const slotsWrap = mealCard.querySelector(".js-slots-wrap");
        const addBtn = mealCard.querySelector("button[data-action='add-slot']");

        if (!mealTitleEl || !slotsWrap || !addBtn) {
          MB.showMessage("Template repas invalide (hooks .js-meal-title/.js-slots-wrap ou bouton add-slot manquants).", "danger");
          return;
        }

        mealTitleEl.textContent = mealLabels[mealIndex] || `Repas ${mealIndex + 1}`;

        addBtn.setAttribute("data-day", String(dayOffset));
        addBtn.setAttribute("data-meal", String(mealIndex));

        // Total protéines sur le repas (somme des slots)
        let mealProtein = 0;

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

          // Marquage visuel du verrouillage
          if (slotObj.locked) box.classList.add("bg-warning-subtle", "border-warning", "border-2");
          else box.classList.remove("bg-warning-subtle", "border-warning", "border-2");

          // Context data-* pour actions.js
          for (const el of [typeSelect, lockBtn, pickBtn, rerollBtn, removeBtn]) {
            el.setAttribute("data-day", String(dayOffset));
            el.setAttribute("data-meal", String(mealIndex));
            el.setAttribute("data-slot", String(slotIndex));
          }

          // Select types (source unique : MB.SLOT_TYPES)
          typeSelect.innerHTML = "";
          for (const t of MB.SLOT_TYPES) {
            const opt = document.createElement("option");
            opt.value = t.value;
            opt.textContent = t.label;
            if (t.value === slotObj.type) opt.selected = true;
            typeSelect.appendChild(opt);
          }
          typeSelect.disabled = !!slotObj.locked;

          // Boutons
          lockBtn.textContent = slotObj.locked ? "🔒" : "🔓";
          lockBtn.setAttribute("title", slotObj.locked ? "Déverrouiller ce slot" : "Verrouiller ce slot");
          lockBtn.setAttribute("aria-label", slotObj.locked ? "Déverrouiller ce slot" : "Verrouiller ce slot");

          pickBtn.disabled = !!slotObj.locked;
          rerollBtn.disabled = !!slotObj.locked;

          // UX : suppression autorisée même si c’est le dernier slot du repas.
          removeBtn.disabled = !!slotObj.locked;

          // Recette
          const r = slotObj.recipe;
          const title = r?.title ?? "— (non rempli)";
          const rawUrl = r?.url ?? "#";
          const url = MB.normalizeRecipeUrl(rawUrl);

          const kcal = global.MenuEngine.getRecipeCalories(r);
          const netCarbs = global.MenuEngine.getRecipeNetCarbs(r);
          const fat = global.MenuEngine.getRecipeFat(r);
          const prot = global.MenuEngine.getRecipeProtein(r);

          mealProtein += prot;

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

        // Affichage total protéines/repas (avec repère optionnel)
        if (mealTotalEl) {
          if (!hasMealProtTarget) {
            mealTotalEl.innerHTML = `<strong>Protéines (repas) :</strong> ${fmt1(mealProtein)} g`;
          } else {
            const ok = mealProtein >= mealProtTarget;
            const badge = ok
              ? '<span class="badge text-bg-success ms-2" title="≥ ~0,3 g/kg">OK</span>'
              : '<span class="badge text-bg-warning ms-2" title="< ~0,3 g/kg">Bas</span>';

            const missing = Math.max(0, mealProtTarget - mealProtein);
            const detail = ok ? "" : ` <span class="text-muted">(manque ~${fmt1(missing)} g)</span>`;

            mealTotalEl.innerHTML =
              `<strong>Protéines (repas) :</strong> ${fmt1(mealProtein)} g` +
              ` <span class="text-muted">(cible ~${fmt1(mealProtTarget)} g)</span>` +
              badge +
              detail;
          }
        }

        mealsWrap.appendChild(mealCard);
      });

      // Totaux jour : kcal
      if (hasKMax) {
        const rem = calorieTarget - totalCalories;
        dayTotalEl.innerHTML =
          `<strong>Total :</strong> ${totalCalories} kcal ` +
          `<span class="text-muted">(MAX : ${calorieTarget} kcal | Reste : ${rem})</span>`;
        if (rem < 0) dayTotalEl.innerHTML += ` <span class="badge text-bg-danger ms-2">Dépassement</span>`;
      } else {
        dayTotalEl.innerHTML = `<strong>Total :</strong> ${totalCalories} kcal`;
      }

      // Totaux jour : glucides nets
      if (hasCMax) {
        const rem = carbMax - totalNetCarbs;
        dayTotalEl.innerHTML +=
          `<br><strong>Glucides nets :</strong> ${fmt1(totalNetCarbs)} g ` +
          `<span class="text-muted">(MAX : ${carbMax} g | Reste : ${fmt1(rem)})</span>`;
        if (rem < 0) dayTotalEl.innerHTML += ` <span class="badge text-bg-danger ms-2">Dépassement</span>`;
      } else {
        dayTotalEl.innerHTML += `<br><strong>Glucides nets :</strong> ${fmt1(totalNetCarbs)} g`;
      }

      // Totaux jour : lipides (plafond optionnel)
      if (hasFMax) {
        const rem = fatMax - totalFat;
        dayTotalEl.innerHTML +=
          `<br><strong>Lipides :</strong> ${fmt1(totalFat)} g ` +
          `<span class="text-muted">(MAX : ${fatMax} g | Reste : ${fmt1(rem)})</span>`;
        if (rem < 0) dayTotalEl.innerHTML += ` <span class="badge text-bg-danger ms-2">Dépassement</span>`;
      } else {
        dayTotalEl.innerHTML += `<br><strong>Lipides :</strong> ${fmt1(totalFat)} g`;
      }

      // Totaux jour : protéines
      dayTotalEl.innerHTML += `<br><strong>Protéines :</strong> ${fmt1(totalProtein)} g`;

      grid.appendChild(dayCard);
    });

    // Event interop (PDF, etc.) — évite le couplage fort entre modules.
    try {
      global.dispatchEvent(
        new CustomEvent("menuBuilderRendered", {
          detail: { daysCount: safeDaysCount, weekStart, mealsPerDay },
        })
      );
    } catch (_) {
      // Pas bloquant
    }
  };
})(window);
