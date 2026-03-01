/* ==============================================================================
menu-engine.js — Moteur “métier” (sans DOM)
==============================================================================
Rôle
- Fournir des fonctions pures (ou quasi pures) pour :
  • construire les pools de recettes par type (recipe_group + types synthétiques)
  • calculer les totaux (kcal, lipides, glucides nets, protéines) d’une journée
  • tirer des recettes sous plafonds (kcal + glucides nets + lipides)
  • générer un menu hebdomadaire en respectant les slots verrouillés
  • fournir la liste canonique des types (source unique UI)

Contrats
- Aucune dépendance au DOM.
- Aucune dépendance à Bootstrap.
- Les fonctions n’accèdent pas à des variables globales : tout est injecté via arguments.
- Format menu :
  menu[day][meal] = { slots: [ { type, recipe, locked } ] }

Notes importantes
- Le tirage “bloquant” est conservé : si aucun candidat ne passe, recipe = null.
- Pour limiter les slots vides, la génération fait des tentatives (restart de journée).
============================================================================== */

"use strict";

(function attachMenuEngine(global) {
  // ---------------------------------------------------------------------------
  // Source unique des types (UI)
  // ---------------------------------------------------------------------------

  const SLOT_TYPES = Object.freeze([
    { value: "Légumes & accompagnements", label: "Accompagnement" },
    { value: "Amuse-bouche", label: "Amuse-bouche" },
    { value: "Barres nutritionnelles", label: "Barre nutritionnelle" },
    { value: "Boissons", label: "Boisson" },
    { value: "Cake", label: "Cake" },
    { value: "Chocolat", label: "Chocolat" },
    { value: "Desserts & crèmes", label: "Dessert" },
    { value: "Fromages", label: "Fromage" },
    { value: "Fruits à coque", label: "Fruits à coque" },
    { value: "Fruits frais", label: "Fruits frais" },
    { value: "Gâteaux & biscuits", label: "Gâteaux & biscuits" },
    { value: "Graines", label: "Graines" },
    { value: "Œufs", label: "Œufs" },
    { value: "Pains & substituts", label: "Pains & substituts" },
    { value: "Pâtés", label: "Pâtés" },
    { value: "Poissons", label: "Poissons" },
    { value: "Sauces & assaisonnements", label: "Sauces & assaisonnements" },
    { value: "Soupe", label: "Soupe" },
    { value: "Viandes", label: "Viandes" },
    { value: "Yaourts", label: "Yaourts" },

    { value: "Plat", label: "Plat (au hasard)" },
    { value: "Snack", label: "Snack (au hasard)" },
    { value: "Final", label: "Final (au hasard)" },
  ]);

  function getSlotTypes() {
    return SLOT_TYPES.map((t) => ({ value: t.value, label: t.label }));
  }

  // ---------------------------------------------------------------------------
  // Types synthétiques (agrégation de groupes)
  // ---------------------------------------------------------------------------

  const AGG_PLAT_KEY = "Plat";
  const AGG_PLAT_GROUPS = [
    "Plats à base de viande",
    "Plats à base de poissons",
    "Plats à base de fruits de mer",
    "Plats à base d’œufs",
    "Plats à base de fromages",
  ];

  const AGG_SNACK_KEY = "Snack";
  const AGG_SNACK_GROUPS = ["Pains & substituts", "Yaourts", "Fruits à coque"];

  const AGG_FINAL_KEY = "Final";
  const AGG_FINAL_GROUPS = ["Gâteaux & biscuits", "Desserts & crèmes", "Yaourts", "Fruits frais", "Fruits à coque"];

  // ---------------------------------------------------------------------------
  // Helpers robustes : parsing + limites
  // ---------------------------------------------------------------------------

  function parseNumberLike(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;

    const s = String(v).trim();
    if (!s) return null;

    const normalized = s.replace(",", ".");
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : null;
  }

  function getFirstNonNegativeNumber(recipe, pickers) {
    for (const pick of pickers) {
      const n = parseNumberLike(pick(recipe));
      if (n === null) continue;
      if (n >= 0) return n;
    }
    return 0;
  }

  function normalizeLimitToInfinity(limit) {
    const n = parseNumberLike(limit);
    return n !== null && n > 0 ? n : Infinity;
  }

  function clampNonNegative(n) {
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }

  // ---------------------------------------------------------------------------
  // Getters nutrition (source unique côté moteur)
  // ---------------------------------------------------------------------------

  function getRecipeCalories(recipe) {
    const kcal = parseInt(recipe?.calories ?? 0, 10);
    return Number.isFinite(kcal) && kcal > 0 ? kcal : 0;
  }

  function getRecipeFat(recipe) {
    return getFirstNonNegativeNumber(recipe, [
      (r) => r?.nutrition?.lipides,
      (r) => r?.lipides,
      (r) => r?.nutrition?.fat,
      (r) => r?.fat,
      (r) => r?.macros?.lipides,
      (r) => r?.macros?.fat,
    ]);
  }

  function getRecipeNetCarbs(recipe) {
    return getFirstNonNegativeNumber(recipe, [
      (r) => r?.glucides_nets,
      (r) => r?.nutrition?.glucides_nets,
      (r) => r?.net_carbs,
      (r) => r?.nutrition?.net_carbs,
      (r) => r?.macros?.glucides_nets,
      (r) => r?.macros?.net_carbs,
    ]);
  }

  function getRecipeProtein(recipe) {
    return getFirstNonNegativeNumber(recipe, [
      (r) => r?.proteines,
      (r) => r?.nutrition?.proteines,
      (r) => r?.protein,
      (r) => r?.nutrition?.protein,
      (r) => r?.macros?.proteines,
      (r) => r?.macros?.protein,
    ]);
  }

  // ---------------------------------------------------------------------------
  // Totaux jour
  // ---------------------------------------------------------------------------

  function getDayCaloriesFromMenu(menuRef, dayIndex) {
    const day = menuRef?.[dayIndex];
    if (!Array.isArray(day)) return 0;

    let total = 0;
    for (const meal of day) {
      const slots = Array.isArray(meal?.slots) ? meal.slots : [];
      for (const s of slots) total += getRecipeCalories(s?.recipe);
    }
    return total;
  }

  function getDayFatFromMenu(menuRef, dayIndex) {
    const day = menuRef?.[dayIndex];
    if (!Array.isArray(day)) return 0;

    let total = 0;
    for (const meal of day) {
      const slots = Array.isArray(meal?.slots) ? meal.slots : [];
      for (const s of slots) total += getRecipeFat(s?.recipe);
    }
    return total;
  }

  function getDayNetCarbsFromMenu(menuRef, dayIndex) {
    const day = menuRef?.[dayIndex];
    if (!Array.isArray(day)) return 0;

    let total = 0;
    for (const meal of day) {
      const slots = Array.isArray(meal?.slots) ? meal.slots : [];
      for (const s of slots) total += getRecipeNetCarbs(s?.recipe);
    }
    return total;
  }

  function getDayProteinFromMenu(menuRef, dayIndex) {
    const day = menuRef?.[dayIndex];
    if (!Array.isArray(day)) return 0;

    let total = 0;
    for (const meal of day) {
      const slots = Array.isArray(meal?.slots) ? meal.slots : [];
      for (const s of slots) total += getRecipeProtein(s?.recipe);
    }
    return total;
  }

  // ---------------------------------------------------------------------------
  // Pools
  // ---------------------------------------------------------------------------

  function buildGroupIndex(recipes) {
    const index = {};
    for (const r of Array.isArray(recipes) ? recipes : []) {
      const g = String(r?.recipe_group || "").trim();
      if (!g) continue;
      if (!index[g]) index[g] = [];
      index[g].push(r);
    }
    return index;
  }

  function buildAggregatePoolFromIndex(groupIndex, groups) {
    const agg = [];
    for (const g of groups) {
      const pool = groupIndex[g] || [];
      if (pool.length > 0) agg.push(...pool);
    }
    return agg;
  }

  function buildPools(recipes, slotTypesOverride) {
    const slotTypes = Array.isArray(slotTypesOverride) && slotTypesOverride.length > 0 ? slotTypesOverride : SLOT_TYPES;

    const pools = {};
    for (const t of slotTypes) pools[t.value] = [];

    const groupIndex = buildGroupIndex(recipes);

    for (const key of Object.keys(pools)) {
      if (key === AGG_PLAT_KEY || key === AGG_SNACK_KEY || key === AGG_FINAL_KEY) continue;
      pools[key] = groupIndex[key] ? [...groupIndex[key]] : [];
    }

    if (Object.prototype.hasOwnProperty.call(pools, AGG_PLAT_KEY)) {
      pools[AGG_PLAT_KEY] = buildAggregatePoolFromIndex(groupIndex, AGG_PLAT_GROUPS);
    }
    if (Object.prototype.hasOwnProperty.call(pools, AGG_SNACK_KEY)) {
      pools[AGG_SNACK_KEY] = buildAggregatePoolFromIndex(groupIndex, AGG_SNACK_GROUPS);
    }
    if (Object.prototype.hasOwnProperty.call(pools, AGG_FINAL_KEY)) {
      pools[AGG_FINAL_KEY] = buildAggregatePoolFromIndex(groupIndex, AGG_FINAL_GROUPS);
    }

    return pools;
  }

  // ---------------------------------------------------------------------------
  // Slots par défaut
  // ---------------------------------------------------------------------------

  function isSnackMeal(mealsPerDay, mealIndex) {
    if (mealsPerDay === 4) return mealIndex === 2;
    if (mealsPerDay === 5) return mealIndex === 1 || mealIndex === 3;
    return false;
  }

  function isBreakfastMeal(mealsPerDay, mealIndex) {
    return mealsPerDay >= 3 && mealIndex === 0;
  }

  function normalizeTypesAgainstPools(pools, wanted) {
    const keys = Object.keys(pools || {});
    const fallback0 = keys[0] || "";
    const fallback1 = keys[1] || fallback0;
    return wanted.map((t, idx) => (keys.includes(t) ? t : idx === 0 ? fallback0 : fallback1));
  }

  function getDefaultSlotTypeListForMeal(pools, mealsPerDay, mealIndex) {
    if (isSnackMeal(mealsPerDay, mealIndex)) {
      return normalizeTypesAgainstPools(pools, ["Boissons", AGG_SNACK_KEY]);
    }

    if (isBreakfastMeal(mealsPerDay, mealIndex)) {
      return normalizeTypesAgainstPools(pools, [AGG_PLAT_KEY, AGG_FINAL_KEY, "Boissons"]);
    }

    return normalizeTypesAgainstPools(pools, [AGG_PLAT_KEY, AGG_FINAL_KEY]);
  }

  // ---------------------------------------------------------------------------
  // Tirage sous plafonds (amélioré)
  // ---------------------------------------------------------------------------

  function passesLimits(recipe, kcalMax, carbMax, fatMax) {
    return getRecipeCalories(recipe) <= kcalMax && getRecipeNetCarbs(recipe) <= carbMax && getRecipeFat(recipe) <= fatMax;
  }

  /**
   * Tirage sous plafonds : tente plusieurs échantillons aléatoires avant abandon.
   * Objectif : éviter les "slots vides" dus au hasard, sans faire de backtracking lourd.
   *
   * @param {Record<string, Array>} pools
   * @param {string} type
   * @param {{kcalMax?:number,carbMax?:number,fatMax?:number}} limits
   * @param {{maxTries?:number}=} opts
   * @returns {any|null}
   */
  function pickRecipeWithLimits(pools, type, limits, opts) {
    const pool = pools?.[String(type || "")] || [];
    if (pool.length === 0) return null;

    const kcalMax = normalizeLimitToInfinity(limits?.kcalMax);
    const carbMax = normalizeLimitToInfinity(limits?.carbMax);
    const fatMax = normalizeLimitToInfinity(limits?.fatMax);

    if (kcalMax === Infinity && carbMax === Infinity && fatMax === Infinity) {
      return pool[Math.floor(Math.random() * pool.length)];
    }

    const maxTries = Math.max(5, Math.min(200, parseInt(opts?.maxTries ?? 60, 10) || 60));

    // Cas pools petits : filtrage direct (simple et rapide)
    if (pool.length <= 40) {
      const filtered = pool.filter((r) => passesLimits(r, kcalMax, carbMax, fatMax));
      if (filtered.length === 0) return null;
      return filtered[Math.floor(Math.random() * filtered.length)];
    }

    // Cas pools moyens/grands : échantillonnage aléatoire (évite filter complet à répétition)
    for (let i = 0; i < maxTries; i++) {
      const r = pool[Math.floor(Math.random() * pool.length)];
      if (passesLimits(r, kcalMax, carbMax, fatMax)) return r;
    }

    // Fallback : filtrage complet si l’échantillonnage n’a rien trouvé (peut être très contraint)
    const filtered = pool.filter((r) => passesLimits(r, kcalMax, carbMax, fatMax));
    if (filtered.length === 0) return null;
    return filtered[Math.floor(Math.random() * filtered.length)];
  }

  // ---------------------------------------------------------------------------
  // Génération : squelette + construction sous plafonds
  // ---------------------------------------------------------------------------

  function createFreshSkeleton(pools, mealsPerDay) {
    const out = [];

    for (let d = 0; d < 7; d++) {
      const dayMeals = [];
      for (let m = 0; m < mealsPerDay; m++) {
        const types = getDefaultSlotTypeListForMeal(pools, mealsPerDay, m);

        dayMeals.push({
          slots: types.map((type) => ({
            type,
            recipe: pickRecipeWithLimits(pools, type, { kcalMax: Infinity, carbMax: Infinity, fatMax: Infinity }),
            locked: false,
          })),
        });
      }
      out.push(dayMeals);
    }

    return out;
  }

  function cloneDayStructure(dayMeals) {
    return (Array.isArray(dayMeals) ? dayMeals : []).map((meal) => ({
      slots: (Array.isArray(meal?.slots) ? meal.slots : []).map((s) => ({
        type: String(s?.type || ""),
        recipe: s?.recipe ?? null,
        locked: !!s?.locked,
      })),
    }));
  }

  function countDayEmpties(dayMeals) {
    let empties = 0;
    for (const meal of Array.isArray(dayMeals) ? dayMeals : []) {
      for (const s of Array.isArray(meal?.slots) ? meal.slots : []) {
        if (!s?.recipe) empties += 1;
      }
    }
    return empties;
  }

  /**
   * Construit UNE journée sous plafonds, avec tentatives.
   * - On conserve les slots verrouillés tels quels (même s’ils dépassent).
   * - Pour les slots non verrouillés, on tire sous "restant" à l’instant T.
   * - Si un slot est impossible, on retente la journée complète quelques fois.
   */
  function buildOneDayUnderLimits(pools, baseDay, mealsPerDay, limits, opts) {
    const kcalMax = normalizeLimitToInfinity(limits?.kcalMax);
    const carbMax = normalizeLimitToInfinity(limits?.carbMax);
    const fatMax = normalizeLimitToInfinity(limits?.fatMax);

    const dayRestarts = Math.max(1, Math.min(60, parseInt(opts?.dayRestarts ?? 20, 10) || 20));
    const pickTries = Math.max(10, Math.min(200, parseInt(opts?.pickTries ?? 80, 10) || 80));

    const defaultTypesByMeal = [];
    for (let m = 0; m < mealsPerDay; m++) defaultTypesByMeal.push(getDefaultSlotTypeListForMeal(pools, mealsPerDay, m));

    let best = null;
    let bestEmpties = Infinity;

    for (let attempt = 0; attempt < dayRestarts; attempt++) {
      const newDay = [];

      for (let m = 0; m < mealsPerDay; m++) {
        const prevMeal = baseDay?.[m];
        const prevSlots = Array.isArray(prevMeal?.slots) ? prevMeal.slots : null;

        const defaultTypes = defaultTypesByMeal[m];

        const baseSlots =
          prevSlots && prevSlots.length > 0
            ? prevSlots
            : defaultTypes.map((type) => ({ type, recipe: null, locked: false }));

        const newSlots = [];

        for (let i = 0; i < baseSlots.length; i++) {
          const s = baseSlots[i];
          const fallbackType = defaultTypes[i] || defaultTypes[0] || "";
          const type = String(s?.type || fallbackType);
          const locked = !!s?.locked;

          if (locked) {
            newSlots.push({ type, recipe: s?.recipe ?? null, locked: true });
            continue;
          }

          // Conso “déjà posée” dans le jour en construction
          const tmpDayMeals = [...newDay, { slots: newSlots }];
          const usedK = getDayCaloriesFromMenu([tmpDayMeals], 0);
          const usedC = getDayNetCarbsFromMenu([tmpDayMeals], 0);
          const usedF = getDayFatFromMenu([tmpDayMeals], 0);

          const remainingK = kcalMax - usedK;
          const remainingC = carbMax - usedC;
          const remainingF = fatMax - usedF;

          const picked = pickRecipeWithLimits(
            pools,
            type,
            { kcalMax: remainingK, carbMax: remainingC, fatMax: remainingF },
            { maxTries: pickTries }
          );

          newSlots.push({ type, recipe: picked, locked: false });
        }

        newDay.push({ slots: newSlots });
      }

      const empties = countDayEmpties(newDay);

      // Optimisation : si on a 0 vide, on prend direct.
      if (empties === 0) return newDay;

      // Sinon, on garde la meilleure tentative.
      if (empties < bestEmpties) {
        bestEmpties = empties;
        best = newDay;
      }
    }

    // Si on n’a jamais réussi à remplir tout, on retourne la meilleure version.
    return best || cloneDayStructure(baseDay);
  }

  /**
   * Construit un menu sous plafonds, avec tentatives par journée pour réduire les slots vides.
   *
   * @param {Record<string, Array>} pools
   * @param {Array} prevMenu
   * @param {number} mealsPerDay
   * @param {{kcalMax?:number,carbMax?:number,fatMax?:number}} limits
   * @param {{dayRestarts?:number,pickTries?:number}=} opts
   * @returns {Array}
   */
  function buildMenuUnderLimits(pools, prevMenu, mealsPerDay, limits, opts) {
    const out = [];

    for (let d = 0; d < 7; d++) {
      const prevDay = prevMenu?.[d] || [];
      const builtDay = buildOneDayUnderLimits(pools, prevDay, mealsPerDay, limits, opts);
      out.push(builtDay);
    }

    return out;
  }

  // ---------------------------------------------------------------------------
  // Analyse : dépassements plafonds + slots vides
  // ---------------------------------------------------------------------------

  function computeLimitsStatus(menu, limits, daysCount) {
    const safeDaysCount = Math.max(1, Math.min(7, parseInt(daysCount, 10) || 7));

    const lk = normalizeLimitToInfinity(limits?.kcalMax);
    const lc = normalizeLimitToInfinity(limits?.carbMax);
    const lf = normalizeLimitToInfinity(limits?.fatMax);

    const status = {
      limits: { kcalMax: lk, carbMax: lc, fatMax: lf },
      overs: { kcal: [], carb: [], fat: [] },
      empties: 0,
    };

    for (let d = 0; d < safeDaysCount; d++) {
      const k = getDayCaloriesFromMenu(menu, d);
      const c = getDayNetCarbsFromMenu(menu, d);
      const f = getDayFatFromMenu(menu, d);

      if (lk !== Infinity && k > lk) status.overs.kcal.push({ dayIndex: d, total: k });
      if (lc !== Infinity && c > lc) status.overs.carb.push({ dayIndex: d, total: c });
      if (lf !== Infinity && f > lf) status.overs.fat.push({ dayIndex: d, total: f });

      const day = menu?.[d] || [];
      for (const meal of day) {
        const slots = Array.isArray(meal?.slots) ? meal.slots : [];
        for (const s of slots) if (!s?.recipe) status.empties += 1;
      }
    }

    return status;
  }

  global.MenuEngine = Object.freeze({
    // Source unique des types
    getSlotTypes,

    // Getters nutrition
    getRecipeCalories,
    getRecipeFat,
    getRecipeNetCarbs,
    getRecipeProtein,

    // Totaux jour
    getDayCaloriesFromMenu,
    getDayFatFromMenu,
    getDayNetCarbsFromMenu,
    getDayProteinFromMenu,

    // API pools / génération
    buildPools,
    pickRecipeWithLimits,
    createFreshSkeleton,
    buildMenuUnderLimits,
    computeLimitsStatus,
  });
})(window);
