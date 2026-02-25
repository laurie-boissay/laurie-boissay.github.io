/* ==============================================================================
menu-engine.js — Moteur “métier” (sans DOM)
==============================================================================
Rôle
- Fournir des fonctions pures (ou quasi pures) pour :
  • construire les pools de recettes par type
  • calculer les kcal d’une journée
  • tirer des recettes sous plafond calorique
  • générer un menu hebdomadaire en respectant les slots verrouillés

Contrats
- Aucune dépendance au DOM.
- Aucune dépendance à Bootstrap.
- Les fonctions n’accèdent pas à des variables globales : tout est injecté via arguments.
- Le format attendu du menu est :
  menu[day][meal] = { slots: [ { type, recipe, locked } ] }
============================================================================== */

"use strict";

(function attachMenuEngine(global) {
  // ---------------------------------------------------------------------------
  // Types synthétiques (agrégation de groupes)
  // ---------------------------------------------------------------------------
  // "Plat" est un type virtuel : il pioche au hasard dans l’ensemble des groupes
  // "Plats à base de ...". Il ne correspond pas à un recipe_group en tant que tel.
  const AGG_PLAT_KEY = "Plat";
  const AGG_PLAT_GROUPS = [
    "Plats à base de viande",
    "Plats à base de poissons",
    "Plats à base de fruits de mer",
    "Plats à base d’œufs",
    "Plats à base de fromages",
  ];

  // "Snack" est un type virtuel destiné aux collations/goûters :
  // il pioche dans plusieurs groupes “simples”.
  // NOTE : Chocolat volontairement exclu (décision UX).
  const AGG_SNACK_KEY = "Snack";
  const AGG_SNACK_GROUPS = ["Pains & substituts", "Yaourts", "Fruits à coque"];

  /**
   * Normalise une valeur “kcal” (nombre entier ≥ 0).
   * @param {any} recipe
   * @returns {number}
   */
  function getRecipeCalories(recipe) {
    const kcal = parseInt(recipe?.calories ?? 0, 10);
    return Number.isFinite(kcal) && kcal > 0 ? kcal : 0;
  }

  /**
   * Calcule le total kcal d’un jour.
   * @param {Array} menuRef
   * @param {number} dayIndex
   * @returns {number}
   */
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

  /**
   * Construit les pools de recettes par type.
   * @param {Array} recipes
   * @param {Array<{value:string,label:string}>} slotTypes
   * @returns {Record<string, Array>}
   */
  function buildPools(recipes, slotTypes) {
    const pools = {};
    for (const t of slotTypes) pools[t.value] = [];

    // Pools “réels” : indexés par recipe_group.
    for (const r of Array.isArray(recipes) ? recipes : []) {
      const t = String(r?.recipe_group || "").trim();
      if (pools[t]) pools[t].push(r);
    }

    // Pool “virtuel” : "Plat" = union des groupes "Plats à base de ...".
    if (pools[AGG_PLAT_KEY]) {
      const agg = [];
      for (const g of AGG_PLAT_GROUPS) {
        const pool = pools[g] || [];
        if (pool.length > 0) agg.push(...pool);
      }
      pools[AGG_PLAT_KEY] = agg;
    }

    // Pool “virtuel” : "Snack" = union de groupes simples (collation/goûter).
    if (pools[AGG_SNACK_KEY]) {
      const agg = [];
      for (const g of AGG_SNACK_GROUPS) {
        const pool = pools[g] || [];
        if (pool.length > 0) agg.push(...pool);
      }
      pools[AGG_SNACK_KEY] = agg;
    }

    return pools;
  }

  /**
   * Déduit les types par défaut.
   * Priorité UX : 1 slot "Plat" + 1 slot "Desserts & crèmes".
   * Fallback : l'ordre des clés reflète l'ordre de SLOT_TYPES (construction via buildPools()).
   * @param {Record<string, Array>} pools
   * @returns {{ primary: string, secondary: string }}
   */
  function getDefaultSlotTypes(pools) {
    const desiredPrimary = AGG_PLAT_KEY;
    const desiredSecondary = "Desserts & crèmes";

    const keys = Object.keys(pools || {});
    const primary = keys.includes(desiredPrimary) ? desiredPrimary : keys[0] || "";
    const secondary = keys.includes(desiredSecondary) ? desiredSecondary : keys[1] || primary;

    return { primary, secondary };
  }

  /**
   * Indique si un repas est une collation/goûter selon le nombre de repas/jour.
   * Convention (alignée sur MEAL_LABELS_BY_COUNT côté UI) :
   * - 4 repas : index 2 = Goûter
   * - 5 repas : index 1 = Collation, index 3 = Goûter
   * @param {number} mealsPerDay
   * @param {number} mealIndex
   * @returns {boolean}
   */
  function isSnackMeal(mealsPerDay, mealIndex) {
    if (mealsPerDay === 4) return mealIndex === 2;
    if (mealsPerDay === 5) return mealIndex === 1 || mealIndex === 3;
    return false;
  }

  /**
   * Déduit les types par défaut pour un repas donné.
   * - Petit déjeuner / déjeuner / dîner : 1 "Plat" + 1 "Desserts & crèmes"
   * - Collation / goûter : 1 "Boissons" + 1 "Snack" (pool agrégé)
   * @param {Record<string, Array>} pools
   * @param {number} mealsPerDay
   * @param {number} mealIndex
   * @returns {{ primary: string, secondary: string }}
   */
  function getDefaultSlotTypesForMeal(pools, mealsPerDay, mealIndex) {
    const keys = Object.keys(pools || {});

    if (isSnackMeal(mealsPerDay, mealIndex)) {
      const desiredPrimary = "Boissons";
      const desiredSecondary = AGG_SNACK_KEY;

      const primary = keys.includes(desiredPrimary) ? desiredPrimary : keys[0] || "";
      const secondary = keys.includes(desiredSecondary) ? desiredSecondary : keys[1] || primary;

      return { primary, secondary };
    }

    return getDefaultSlotTypes(pools);
  }

  /**
   * Tire une recette aléatoire dans un pool sous contrainte maxKcal.
   * @param {Record<string, Array>} pools
   * @param {string} type
   * @param {number} maxKcal
   * @returns {any|null}
   */
  function pickRecipeWithCalorieLimit(pools, type, maxKcal) {
    const pool = pools?.[String(type || "")] || [];
    if (pool.length === 0) return null;

    // Pas de plafond => tirage simple.
    if (!Number.isFinite(maxKcal) || maxKcal <= 0 || maxKcal === Infinity) {
      return pool[Math.floor(Math.random() * pool.length)];
    }

    const filtered = pool.filter((r) => getRecipeCalories(r) <= maxKcal);
    if (filtered.length === 0) return null;

    return filtered[Math.floor(Math.random() * filtered.length)];
  }

  /**
   * Retourne les types ajoutables pour un jour, sous plafond calorique.
   * @param {Array} menu
   * @param {Record<string, Array>} pools
   * @param {number} dayIndex
   * @param {number} calorieMax
   * @param {Array<{value:string,label:string}>} addSlotTypes
   * @returns {Array<{value:string,label:string}>}
   */
  function getAddableTypesForDay(menu, pools, dayIndex, calorieMax, addSlotTypes) {
    const used = getDayCaloriesFromMenu(menu, dayIndex);

    // Pas de plafond => on propose tous les types dispos (au moins 1 recette).
    if (!Number.isFinite(calorieMax) || calorieMax <= 0) {
      return addSlotTypes.filter((t) => (pools[t.value] || []).length > 0);
    }

    const remaining = calorieMax - used;
    if (remaining <= 0) return [];

    return addSlotTypes.filter((t) => {
      const pool = pools[t.value] || [];
      if (pool.length === 0) return false;
      return pool.some((r) => getRecipeCalories(r) <= remaining);
    });
  }

  /**
   * Génère un squelette complet (7 jours) avec 2 slots de base par repas.
   * @param {Record<string, Array>} pools
   * @param {number} mealsPerDay
   * @returns {Array}
   */
  function createFreshSkeleton(pools, mealsPerDay) {
    const out = [];

    for (let d = 0; d < 7; d++) {
      const dayMeals = [];
      for (let m = 0; m < mealsPerDay; m++) {
        const defaults = getDefaultSlotTypesForMeal(pools, mealsPerDay, m);
        dayMeals.push({
          slots: [
            {
              type: defaults.primary,
              recipe: pickRecipeWithCalorieLimit(pools, defaults.primary, Infinity),
              locked: false,
            },
            {
              type: defaults.secondary,
              recipe: pickRecipeWithCalorieLimit(pools, defaults.secondary, Infinity),
              locked: false,
            },
          ],
        });
      }
      out.push(dayMeals);
    }

    return out;
  }

  /**
   * Construit un menu sous plafond (si défini), en respectant :
   * - slots verrouillés (conservés)
   * - types des slots existants
   * - tirage sous contrainte kcal restante
   *
   * IMPORTANT :
   * - La fonction retourne un nouveau menu (pas de mutation sur prevMenu).
   * - Si aucun tirage n’est possible sous plafond, le slot reste à recipe:null.
   *
   * @param {Record<string, Array>} pools
   * @param {Array} prevMenu
   * @param {number} mealsPerDay
   * @param {number} calorieMax
   * @returns {Array}
   */
  function buildMenuUnderCalorieMax(pools, prevMenu, mealsPerDay, calorieMax) {
    const out = [];

    for (let d = 0; d < 7; d++) {
      const prevDay = prevMenu?.[d] || [];
      const newDay = [];

      for (let m = 0; m < mealsPerDay; m++) {
        const prevMeal = prevDay[m];
        const prevSlots = Array.isArray(prevMeal?.slots) ? prevMeal.slots : null;

        const mealDefaults = getDefaultSlotTypesForMeal(pools, mealsPerDay, m);

        const baseSlots =
          prevSlots && prevSlots.length > 0
            ? prevSlots
            : [
                { type: mealDefaults.primary, recipe: null, locked: false },
                { type: mealDefaults.secondary, recipe: null, locked: false },
              ];

        const newSlots = [];

        for (const s of baseSlots) {
          const type = String(s?.type || mealDefaults.primary);
          const locked = !!s?.locked;

          if (locked) {
            newSlots.push({ type, recipe: s?.recipe ?? null, locked: true });
            continue;
          }

          // Calcule les kcal consommées “jusqu’ici” dans le jour en cours.
          const tmpDayMeals = [...newDay, { slots: newSlots }];
          const usedSoFar = getDayCaloriesFromMenu([tmpDayMeals], 0);

          let remaining = Infinity;
          if (Number.isFinite(calorieMax) && calorieMax > 0) remaining = calorieMax - usedSoFar;

          const picked = pickRecipeWithCalorieLimit(pools, type, remaining);
          newSlots.push({ type, recipe: picked, locked: false });
        }

        newDay.push({ slots: newSlots });
      }

      out.push(newDay);
    }

    return out;
  }

  /**
   * Analyse un menu (dépassements, slots vides) au regard du plafond.
   * @param {Array} menu
   * @param {number} calorieMax
   * @returns {{max:number, overs:Array<{dayIndex:number,total:number}>, empties:number}}
   */
  function computeCalorieStatus(menu, calorieMax) {
    const status = {
      max: calorieMax,
      overs: [],
      empties: 0,
    };

    for (let d = 0; d < 7; d++) {
      const total = getDayCaloriesFromMenu(menu, d);
      if (Number.isFinite(calorieMax) && calorieMax > 0 && total > calorieMax) {
        status.overs.push({ dayIndex: d, total });
      }

      const day = menu?.[d] || [];
      for (const meal of day) {
        const slots = Array.isArray(meal?.slots) ? meal.slots : [];
        for (const s of slots) {
          if (!s?.recipe) status.empties += 1;
        }
      }
    }

    return status;
  }

  global.MenuEngine = Object.freeze({
    getRecipeCalories,
    getDayCaloriesFromMenu,
    buildPools,
    pickRecipeWithCalorieLimit,
    getAddableTypesForDay,
    createFreshSkeleton,
    buildMenuUnderCalorieMax,
    computeCalorieStatus,
  });
})(window);
