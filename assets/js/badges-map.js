/*
  =========================================================
  BADGES MAP (tags + micronutriments)
  Fichier : assets/js/badges-map.js

  Rôle :
  - Centralise les mappings ID -> {emoji, title}
  - Utilisé par random-pick.html (et potentiellement d’autres scripts)

  Convention :
  - Expose une variable globale window.RECETTES_BADGES_MAP
  =========================================================
*/
(function () {
  "use strict";

  window.RECETTES_BADGES_MAP = {
    TAG_BADGES: {
      "tres-proteine":       { emoji: "💪", title: "Très protéiné" },
      "riche-en-fibres":     { emoji: "💩", title: "Riche en fibres" },
      "rapide":              { emoji: "⏱️", title: "Rapide" },
      "congelable":          { emoji: "❄️", title: "Congélable" },
      "micro-ondable":       { emoji: "♨️", title: "Micro-ondable" },
      "peu-calorique":       { emoji: "🪶", title: "Peu calorique" },
      "calorique":           { emoji: "🔥", title: "Calorique" },
      "longue":              { emoji: "🐌", title: "Préparation longue" },

      // Tag fonctionnel utilisé en navigation
      "gout-sucre":          { emoji: "🍬", title: "Goût sucré" },

      // Nouveau tag fonctionnel
      "microbiote-friendly": { emoji: "🦠", title: "Microbiote friendly" }
    },

    MICRO_BADGES: {
      "omega-3":      { emoji: "🐟", title: "Oméga-3" },

      "vitamine-a":   { emoji: "👁️", title: "Vitamine A" },
      "vitamine-c":   { emoji: "🍋", title: "Vitamine C" },
      "vitamine-d":   { emoji: "🌤️", title: "Vitamine D" },
      "vitamine-e":   { emoji: "🛡️", title: "Vitamine E" },
      "vitamine-k":   { emoji: "🩸", title: "Vitamine K" },
      "vitamine-b9":  { emoji: "🌱", title: "Vitamine B9" },
      "vitamine-b12": { emoji: "🥩", title: "Vitamine B12" },

      "calcium":      { emoji: "🦴", title: "Calcium" },
      "fer":          { emoji: "🧲", title: "Fer" },
      "magnesium":    { emoji: "⚡", title: "Magnésium" },
      "potassium":    { emoji: "🍌", title: "Potassium" },
      "zinc":         { emoji: "🔩", title: "Zinc" },
      "selenium":     { emoji: "🧪", title: "Sélénium" },
      "iode":         { emoji: "🌊", title: "Iode" }
    }
  };
})();
