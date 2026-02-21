import { getDayCaloriesFromMenu } from './calories.js';
import { pickRecipeWithCalorieLimit } from './recipes.js';

export function generateMenu() {
  const mealsPerDay = readInt("#mealsPerDay", 3, 1, 5);
  const calorieMax = readInt("#calorieTargetDay", 0, 0, 99999);

  const menu = createFreshSkeleton(mealsPerDay);
  const newMenu = buildMenuUnderCalorieMax(menu, mealsPerDay, calorieMax);

  renderMenu(newMenu);
}

function createFreshSkeleton(mealsPerDay) {
  const out = [];
  for (let d = 0; d < 7; d++) {
    const dayMeals = [];
    for (let m = 0; m < mealsPerDay; m++) {
      dayMeals.push({
        slots: [
          { type: "plat", recipe: pickRecipe("plat"), locked: false },
          { type: "dessert", recipe: pickRecipe("dessert"), locked: false },
        ],
      });
    }
    out.push(dayMeals);
  }
  return out;
}

function buildMenuUnderCalorieMax(menu, mealsPerDay, calorieMax) {
  // Logic to build the menu, respecting calorie limits, for each day and meal
}

function renderMenu(menu) {
  // Function to render the menu in the DOM
}
