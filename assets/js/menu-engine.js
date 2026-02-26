/* ==============================================================================
menu-engine.js — Moteur “métier” (sans DOM)
==============================================================================
Rôle
- Fournir des fonctions pures (ou quasi pures) pour :
  • construire les pools de recettes par type (recipe_group + types synthétiques)
  • calculer les kcal d’une journée
  • tirer des recettes sous plafond calorique
  • générer un menu hebdomadaire en respectant les slots verrouillés

Contrats
- Aucune dépendance au DOM.
- Aucune dépendance à Bootstrap.
- Les fonctions n’accèdent pas à des variables globales : tout est injecté via arguments.
- Format menu :
  menu[day][meal] = { slots: [ { type, recipe, locked } ] }

Notes d’architecture
- "Plat", "Snack" et "Final" sont des types synthétiques (agrégations de recipe_group).
- Petit déjeuner : Plat + Final + Boissons
- Déjeuner / Dîner : Plat + Final
- Collation / Goûter : Boissons + Snack
============================================================================== */

"use strict";

(function attachMenuEngine(global) {
  // ---------------------------------------------------------------------------
  // Types synthétiques (agrégation de groupes)
  // ---------------------------------------------------------------------------

  // "Plat" : union des groupes "Plats à base de ...".
  const AGG_PLAT_KEY = "Plat";
  const AGG_PLAT_GROUPS = [
    "Plats à base de viande",
    "Plats à base de poissons",
    "Plats à base de fruits de mer",
    "Plats à base d’œufs",
    "Plats à base de fromages",
  ];

  // "Snack" : collations/goûters (chocolat EXCLU).
  const AGG_SNACK_KEY = "Snack";
  const AGG_SNACK_GROUPS = ["Pains & substituts", "Yaourts", "Fruits à coque"];

  // "Final" : fin de repas (ne présume pas du sucré).
  const AGG_FINAL_KEY = "Final";
  const AGG_FINAL_GROUPS = ["Gâteaux & biscuits", "Desserts & crèmes", "Yaourts", "Fruits frais", "Fruits à coque"];

  /**
   * Normalise une valeur “kcal” (entier ≥ 0).
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
   * Construit un index complet recipe_group -> recettes, indépendamment de slotTypes.
   * Contrat : l’UI peut choisir de ne pas afficher certains recipe_group, sans casser les agrégations.
   * @param {Array} recipes
   * @returns {Record<string, Array>}
   */
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

  /**
   * Construit un pool agrégé = concat des pools des groupes fournis.
   * @param {Record<string, Array>} groupIndex
   * @param {string[]} groups
   * @returns {Array}
   */
  function buildAggregatePoolFromIndex(groupIndex, groups) {
    const agg = [];
    for (const g of groups) {
      const pool = groupIndex[g] || [];
      if (pool.length > 0) agg.push(...pool);
    }
    return agg;
  }

  /**
   * Construit les pools de recettes par type.
   * - Les types "réels" sont indexés par recipe_group.
   * - Les types synthétiques (Plat/Snack/Final) sont des unions de recipe_group.
   *
   * Contrat : les clés de pools sont initialisées à partir de slotTypes.
   *
   * @param {Array} recipes
   * @param {Array<{value:string,label:string}>} slotTypes
   * @returns {Record<string, Array>}
   */
  function buildPools(recipes, slotTypes) {
    const pools = {};
    for (const t of slotTypes) pools[t.value] = [];

    const groupIndex = buildGroupIndex(recipes);

    // Pools “réels” : uniquement si la clé est prévue dans slotTypes.
    for (const key of Object.keys(pools)) {
      // Les types synthétiques sont remplis plus bas.
      if (key === AGG_PLAT_KEY || key === AGG_SNACK_KEY || key === AGG_FINAL_KEY) continue;
      pools[key] = groupIndex[key] ? [...groupIndex[key]] : [];
    }

    // Pools synthétiques : construits uniquement si la clé existe dans slotTypes.
    if (pools[AGG_PLAT_KEY]) pools[AGG_PLAT_KEY] = buildAggregatePoolFromIndex(groupIndex, AGG_PLAT_GROUPS);
    if (pools[AGG_SNACK_KEY]) pools[AGG_SNACK_KEY] = buildAggregatePoolFromIndex(groupIndex, AGG_SNACK_GROUPS);
    if (pools[AGG_FINAL_KEY]) pools[AGG_FINAL_KEY] = buildAggregatePoolFromIndex(groupIndex, AGG_FINAL_GROUPS);

    return pools;
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
   * Indique si le repas est le petit déjeuner (quand mealsPerDay >= 3).
   * Convention : index 0 = petit déjeuner.
   * @param {number} mealsPerDay
   * @param {number} mealIndex
   * @returns {boolean}
   */
  function isBreakfastMeal(mealsPerDay, mealIndex) {
    return mealsPerDay >= 3 && mealIndex === 0;
  }

  /**
   * Remplace les types absents de pools par des alternatives existantes.
   * Note : on garde le contrat "les clés viennent de slotTypes", donc ici on ne “devine” pas d’autres types.
   * @param {Record<string, Array>} pools
   * @param {string[]} wanted
   * @returns {string[]}
   */
  function normalizeTypesAgainstPools(pools, wanted) {
    const keys = Object.keys(pools || {});
    const fallback0 = keys[0] || "";
    const fallback1 = keys[1] || fallback0;

    return wanted.map((t, idx) => (keys.includes(t) ? t : idx === 0 ? fallback0 : fallback1));
  }

  /**
   * Retourne une liste ordonnée de types par défaut pour un repas.
   * - Petit déjeuner : Plat + Final + Boissons
   * - Déjeuner / Dîner : Plat + Final
   * - Collation / Goûter : Boissons + Snack
   *
   * @param {Record<string, Array>} pools
   * @param {number} mealsPerDay
   * @param {number} mealIndex
   * @returns {string[]}
   */
  function getDefaultSlotTypeListForMeal(pools, mealsPerDay, mealIndex) {
    if (isSnackMeal(mealsPerDay, mealIndex)) {
      return normalizeTypesAgainstPools(pools, ["Boissons", AGG_SNACK_KEY]);
    }

    if (isBreakfastMeal(mealsPerDay, mealIndex)) {
      return normalizeTypesAgainstPools(pools, [AGG_PLAT_KEY, AGG_FINAL_KEY, "Boissons"]);
    }

    return normalizeTypesAgainstPools(pools, [AGG_PLAT_KEY, AGG_FINAL_KEY]);
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
   * Génère un squelette complet (7 jours) avec slots par défaut selon le repas.
   * @param {Record<string, Array>} pools
   * @param {number} mealsPerDay
   * @returns {Array}
   */
  function createFreshSkeleton(pools, mealsPerDay) {
    const out = [];

    for (let d = 0; d < 7; d++) {
      const dayMeals = [];
      for (let m = 0; m < mealsPerDay; m++) {
        const types = getDefaultSlotTypeListForMeal(pools, mealsPerDay, m);

        dayMeals.push({
          slots: types.map((type) => ({
            type,
            recipe: pickRecipeWithCalorieLimit(pools, type, Infinity),
            locked: false,
          })),
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
   * - Retourne un nouveau menu (pas de mutation sur prevMenu).
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

        const defaultTypes = getDefaultSlotTypeListForMeal(pools, mealsPerDay, m);

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

          // Kcal consommées “jusqu’ici” dans le jour en cours.
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
    const status = { max: calorieMax, overs: [], empties: 0 };

    for (let d = 0; d < 7; d++) {
      const total = getDayCaloriesFromMenu(menu, d);
      if (Number.isFinite(calorieMax) && calorieMax > 0 && total > calorieMax) {
        status.overs.push({ dayIndex: d, total });
      }

      const day = menu?.[d] || [];
      for (const meal of day) {
        const slots = Array.isArray(meal?.slots) ? meal.slots : [];
        for (const s of slots) if (!s?.recipe) status.empties += 1;
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
