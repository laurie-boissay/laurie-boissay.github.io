let RECIPES = [];
let POOLS = {};

export async function loadRecipes() {
  const url = "/assets/data/recipes.json";  // Exemple d'URL
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load recipes (${res.status})`);
    
    const data = await res.json();
    RECIPES = Array.isArray(data) ? data : [];
    buildPools();
  } catch (err) {
    console.error("Error loading recipes:", err);
    RECIPES = [];
    POOLS = {};
  }
}

function buildPools() {
  POOLS = {
    plat: [],
    dessert: [],
    pain: [],
    boisson: [],
    "amuse-bouche": [],
  };

  RECIPES.forEach(r => {
    const type = r?.meal_type?.trim();
    if (type && POOLS[type]) POOLS[type].push(r);
  });
}
