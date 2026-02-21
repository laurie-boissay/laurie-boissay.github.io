export function setupCalorieTargetSync() {
  const targetInput = document.getElementById("calorieTargetDay");
  if (!targetInput) return;

  const applyValue = kcal => {
    const n = parseInt(kcal, 10);
    if (Number.isFinite(n) && n > 0) targetInput.value = String(n);
  };

  window.addEventListener("calorieTargetUpdated", e => {
    if (e?.detail?.kcal) applyValue(e.detail.kcal);
  });
}

export function getRecipeCalories(recipe) {
  const kcal = parseInt(recipe?.calories ?? 0, 10);
  return Number.isFinite(kcal) && kcal > 0 ? kcal : 0;
}

export function getDayCaloriesFromMenu(menuRef, dayIndex) {
  const day = menuRef?.[dayIndex];
  if (!Array.isArray(day)) return 0;

  return day.reduce((total, meal) => {
    return total + (meal?.slots?.reduce((slotTotal, slot) => slotTotal + getRecipeCalories(slot?.recipe), 0) ?? 0);
  }, 0);
}
