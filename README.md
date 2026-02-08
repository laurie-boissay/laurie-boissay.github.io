# Recettes low carb

Site personnel de **recettes low carb réalistes et fonctionnelles**, conçu comme un outil du quotidien pour réduire la charge mentale liée aux repas.

👉 Objectif principal : répondre simplement à la question  
**« On mange quoi ce soir ? »**  
sans idéologie, sans discours culpabilisant, et sans ingrédients introuvables.

Le site est déployé ici :  
👉 https://laurie-boissay.github.io

---

## 🎯 Philosophie du site

- **Low carb modéré**, durable, non cétogène
- **Cuisine fonctionnelle** : rapide, reproductible, faisable en semaine
- **Pas de végétarien** : viande, poisson, œufs, fromages assumés
- **Portions prévues pour 4 personnes** (sauf cas non pertinents)
- **Recettes testées en conditions réelles**
- **Goût sucré assumé**, mais maîtrisé (pas d’arrière-goût d’édulcorant)
- Pas de recettes « protéine seule » : un plat est **toujours complet**

Le site sert aussi de **mémoire externe** :  
les recettes efficaces sont conservées, classées, et documentées.

---

## 🧠 Approche nutritionnelle

Chaque recette peut inclure :

- Macros détaillés par portion :
  - calories  
  - protéines  
  - lipides  
  - glucides  
  - **dont fructose**  
  - fibres
- Compatibilité low carb clairement indiquée
- Signalement explicite de tout ingrédient **non compatible low carb**
- Informations **factuelles** uniquement  
  → toute affirmation non solidement établie est signalée comme telle

### Badges fonctionnels
- 💪 très protéiné  
- 💩 riche en fibres  
- ⏱️ rapide  
- ❄️ congélable  
- ♨️ micro-ondable  
- 🪶 peu calorique  
- 🔥 calorique  
- 🐌 préparation longue  

### Micronutriments (si apport significatif)
Oméga-3, vitamines, minéraux (liste volontairement limitée et justifiée).

---

## 🧩 Structure technique

- **Jekyll + GitHub Pages**
- Recettes au format **.html** (pas de Markdown)
- Layout centralisé `recipe` (modèle de référence : *Bol nordique*)
- JSON-LD intégré pour le référencement
- Index par catégories + filtres dynamiques :
  - recettes testées
  - tags fonctionnels
  - micronutriments
- CSS sur mesure (Bootstrap utilisé comme base, mais fortement maîtrisé)

---

## 📂 Organisation des contenus

- `layout: recipe` → pages recettes
- `recipe_group` → catégories officielles (strictement contrôlées)
- `tags` → fonctionnalités (low-carb, rapide, etc.)
- `badges_nutritionnels` → micronutriments (champ dédié)
- `_includes/` → index, filtres, random pick, composants partagés
- `style.css` → thème clair turquoise / vert, sans soulignements ni bruit visuel

---

## 🧪 Statut des recettes

- Une recette **testée** est clairement identifiée
- Les recettes non testées sont possibles, mais **visuellement signalées**
- Un filtre permet d’afficher **uniquement les recettes testées**

---

## 🚧 Ce que le site n’est pas

- Pas un blog
- Pas un site « healthy / bien-être »
- Pas un discours militant (keto, vegan, anti-sucre, etc.)
- Pas un site d’inspiration culinaire abstraite

👉 C’est un **outil pratique**, pensé pour être utilisé tous les jours.

---

## 📜 Licence

Projet personnel.  
Utilisation, duplication ou reprise du contenu non autorisée sans accord préalable.

