import type { CustomerProfile } from "../types/customer";
import type { Product } from "../types/product";

export const DIETARY_PREFERENCE_OPTIONS: Array<{ code: string; label: string }> = [
  { code: "vegetarian", label: "Vegetarian" },
  { code: "vegan", label: "Vegan" },
  { code: "no_pork", label: "No Pork" },
  { code: "no_beef", label: "No Beef" },
  { code: "pescatarian", label: "Pescatarian" },
  { code: "halal_friendly", label: "Halal-Friendly" },
  { code: "low_carb", label: "Low Carb" },
];

export const ALLERGEN_OPTIONS: Array<{ code: string; label: string; keywords: string[] }> = [
  { code: "peanuts", label: "Peanuts", keywords: ["peanut", "groundnut", "satay"] },
  {
    code: "tree_nuts",
    label: "Tree Nuts",
    keywords: ["almond", "cashew", "walnut", "pecan", "pistachio", "hazelnut", "macadamia", "nut"],
  },
  {
    code: "milk_dairy",
    label: "Milk / Dairy",
    keywords: ["milk", "cheese", "butter", "cream", "cheddar", "mozzarella", "parmesan", "yogurt", "dairy"],
  },
  { code: "eggs", label: "Eggs", keywords: ["egg", "mayo", "mayonnaise", "aioli"] },
  {
    code: "shellfish",
    label: "Shellfish",
    keywords: ["shrimp", "prawn", "crab", "lobster", "clam", "mussel", "oyster", "scallop", "squid", "calamari"],
  },
  { code: "fish", label: "Fish", keywords: ["fish", "salmon", "tuna", "tilapia", "bangus", "anchovy", "patis"] },
  { code: "soy", label: "Soy", keywords: ["soy", "tofu", "edamame", "miso", "teriyaki"] },
  {
    code: "wheat_gluten",
    label: "Wheat / Gluten",
    keywords: ["wheat", "flour", "bread", "bun", "pasta", "noodle", "spaghetti", "crust", "pastry", "gluten", "soy sauce"],
  },
  { code: "sesame", label: "Sesame", keywords: ["sesame", "tahini"] },
];

export function formatAllergenLabel(code: string): string {
  return ALLERGEN_OPTIONS.find((item) => item.code === code)?.label ?? code.replace(/_/g, " ");
}

export function formatDietaryLabel(code: string): string {
  return DIETARY_PREFERENCE_OPTIONS.find((item) => item.code === code)?.label ?? code.replace(/_/g, " ");
}

export interface DishConflictResult {
  matchedAllergens: string[];
  matchedDisliked: string[];
}

export function detectDishConflicts(
  product: Pick<Product, "name" | "description" | "ingredient_names">,
  profile: Pick<CustomerProfile, "allergy_flags" | "disliked_ingredients" | "allergy_consent_given"> | null,
): DishConflictResult {
  if (!profile || !profile.allergy_consent_given) {
    return { matchedAllergens: [], matchedDisliked: [] };
  }

  const haystack = [
    product.name,
    product.description ?? "",
    ...(product.ingredient_names ?? []),
  ]
    .join(" ")
    .toLowerCase();

  const matchedAllergens: string[] = [];
  for (const flag of profile.allergy_flags ?? []) {
    const def = ALLERGEN_OPTIONS.find((opt) => opt.code === flag);
    if (!def) continue;
    if (def.keywords.some((kw) => haystack.includes(kw))) {
      matchedAllergens.push(def.label);
    }
  }

  const matchedDisliked: string[] = [];
  if (profile.disliked_ingredients) {
    const tokens = profile.disliked_ingredients
      .split(/[,;\n]/)
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length >= 2);
    for (const token of tokens) {
      if (haystack.includes(token)) {
        matchedDisliked.push(token);
      }
    }
  }

  return { matchedAllergens, matchedDisliked };
}

export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("blob:") || url.startsWith("data:")) {
    return url;
  }
  return url;
}
