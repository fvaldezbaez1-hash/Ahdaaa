import type { Food, Serving } from '../lib/types'

// Common whole foods, per 100 g (or 100 ml), from USDA FoodData Central
// (public domain), rounded. Packaged foods come from Open Food Facts instead.
type Row = [id: string, name: string, kcal: number, protein: number, carbs: number, fat: number, fiber: number, servings: [string, number][], unit?: 'ml']

const rows: Row[] = [
  // Meat, fish, eggs
  ['chicken-breast-cooked', 'Chicken breast, cooked', 165, 31, 0, 3.6, 0, [['1 breast', 120], ['3 oz', 85]]],
  ['chicken-breast-raw', 'Chicken breast, raw', 120, 22.5, 0, 2.6, 0, [['1 breast', 175], ['4 oz', 113]]],
  ['chicken-thigh-cooked', 'Chicken thigh, cooked, skinless', 209, 26, 0, 10.9, 0, [['1 thigh', 70]]],
  ['ground-beef-85-raw', 'Ground beef 85/15, raw', 215, 18.6, 0, 15, 0, [['4 oz', 113], ['1 lb', 454]]],
  ['ground-beef-85-cooked', 'Ground beef 85/15, cooked', 250, 25.9, 0, 15.5, 0, [['3 oz', 85]]],
  ['ground-beef-93-raw', 'Ground beef 93/7, raw', 152, 20.9, 0, 7, 0, [['4 oz', 113], ['1 lb', 454]]],
  ['ground-turkey-93-raw', 'Ground turkey 93/7, raw', 150, 18.7, 0, 8.3, 0, [['4 oz', 113], ['1 lb', 454]]],
  ['steak-sirloin-cooked', 'Steak (sirloin), cooked', 206, 29.5, 0, 8.9, 0, [['3 oz', 85], ['8 oz steak', 227]]],
  ['pork-loin-cooked', 'Pork loin, cooked', 196, 27.3, 0, 8.9, 0, [['3 oz', 85], ['1 chop', 150]]],
  ['bacon-cooked', 'Bacon, cooked', 541, 37, 1.4, 42, 0, [['1 slice', 8]]],
  ['turkey-deli', 'Turkey breast, deli slices', 104, 17.1, 4.2, 1.7, 0, [['1 slice', 28]]],
  ['salmon-cooked', 'Salmon, cooked', 206, 22.1, 0, 12.4, 0, [['1 fillet', 150], ['3 oz', 85]]],
  ['salmon-raw', 'Salmon, raw', 208, 20.4, 0, 13.4, 0, [['1 fillet', 170], ['4 oz', 113]]],
  ['tuna-canned-water', 'Tuna, canned in water, drained', 116, 25.5, 0, 0.8, 0, [['1 can (drained)', 113]]],
  ['shrimp-cooked', 'Shrimp, cooked', 99, 24, 0.2, 0.3, 0, [['3 oz', 85]]],
  ['tilapia-cooked', 'Tilapia, cooked', 128, 26, 0, 2.7, 0, [['1 fillet', 87]]],
  ['cod-cooked', 'Cod, cooked', 105, 22.8, 0, 0.9, 0, [['1 fillet', 180], ['3 oz', 85]]],
  ['egg-large', 'Egg, whole', 143, 12.6, 0.7, 9.5, 0, [['1 large', 50], ['1 extra large', 56]]],
  ['egg-white', 'Egg white', 52, 10.9, 0.7, 0.2, 0, [['1 large white', 33]]],
  ['tofu-firm', 'Tofu, firm', 144, 17.3, 2.8, 8.7, 2.3, [['1/2 cup', 126]]],

  // Dairy
  ['whey-protein', 'Whey protein powder', 400, 78, 8, 6, 0, [['1 scoop', 30]]],
  ['greek-yogurt-nonfat', 'Greek yogurt, plain, nonfat', 59, 10.2, 3.6, 0.4, 0, [['1 container', 170], ['1 cup', 245]]],
  ['greek-yogurt-2', 'Greek yogurt, plain, 2%', 73, 10, 3.9, 1.9, 0, [['1 container', 170], ['1 cup', 245]]],
  ['cottage-cheese-2', 'Cottage cheese, 2%', 81, 10.5, 4.8, 2.3, 0, [['1/2 cup', 113], ['1 cup', 226]]],
  ['milk-whole', 'Milk, whole', 61, 3.2, 4.8, 3.3, 0, [['1 cup', 244]], 'ml'],
  ['milk-2', 'Milk, 2%', 50, 3.3, 4.8, 2, 0, [['1 cup', 244]], 'ml'],
  ['milk-skim', 'Milk, skim', 34, 3.4, 5, 0.1, 0, [['1 cup', 245]], 'ml'],
  ['almond-milk', 'Almond milk, unsweetened', 15, 0.6, 0.6, 1.1, 0.2, [['1 cup', 240]], 'ml'],
  ['cheddar', 'Cheddar cheese', 403, 24.9, 1.3, 33.1, 0, [['1 slice', 28], ['1 oz', 28]]],
  ['mozzarella-part-skim', 'Mozzarella, part-skim', 254, 24.3, 2.8, 15.9, 0, [['1 oz', 28], ['1 stick', 28]]],
  ['cream-cheese', 'Cream cheese', 350, 6.2, 5.5, 34, 0, [['1 tbsp', 14.5]]],
  ['butter', 'Butter', 717, 0.9, 0.1, 81.1, 0, [['1 tbsp', 14.2], ['1 tsp', 4.7]]],
  ['ice-cream-vanilla', 'Ice cream, vanilla', 207, 3.5, 23.6, 11, 0.7, [['1/2 cup', 66]]],

  // Fats, nuts, spreads
  ['olive-oil', 'Olive oil', 884, 0, 0, 100, 0, [['1 tbsp', 13.5], ['1 tsp', 4.5]]],
  ['peanut-butter', 'Peanut butter', 588, 25, 20, 50, 6, [['1 tbsp', 16], ['2 tbsp', 32]]],
  ['almonds', 'Almonds', 579, 21.2, 21.6, 49.9, 12.5, [['1 oz (23 almonds)', 28]]],
  ['walnuts', 'Walnuts', 654, 15.2, 13.7, 65.2, 6.7, [['1 oz', 28]]],
  ['avocado', 'Avocado', 160, 2, 8.5, 14.7, 6.7, [['1 avocado', 136], ['1/2 avocado', 68]]],
  ['mayonnaise', 'Mayonnaise', 680, 1, 0.6, 75, 0, [['1 tbsp', 13.8]]],
  ['hummus', 'Hummus', 166, 7.9, 14.3, 9.6, 6, [['1 tbsp', 15], ['1/4 cup', 62]]],

  // Grains & starches
  ['white-rice-cooked', 'White rice, cooked', 130, 2.7, 28.2, 0.3, 0.4, [['1 cup', 158], ['1/2 cup', 79]]],
  ['brown-rice-cooked', 'Brown rice, cooked', 123, 2.7, 25.6, 1, 1.6, [['1 cup', 195]]],
  ['pasta-cooked', 'Pasta, cooked', 158, 5.8, 30.9, 0.9, 1.8, [['1 cup', 140]]],
  ['pasta-dry', 'Pasta, dry', 371, 13, 74.7, 1.5, 3.2, [['2 oz', 56]]],
  ['oats', 'Oats, rolled (dry)', 379, 13.2, 67.7, 6.5, 10.1, [['1/2 cup', 40], ['1 cup', 81]]],
  ['bread-white', 'Bread, white', 266, 9, 49, 3.2, 2.7, [['1 slice', 28]]],
  ['bread-whole-wheat', 'Bread, whole wheat', 252, 12.4, 42.7, 3.5, 6, [['1 slice', 32]]],
  ['bagel', 'Bagel, plain', 257, 10, 50.5, 1.6, 2.2, [['1 bagel', 105]]],
  ['tortilla-flour', 'Tortilla, flour', 306, 8.2, 50.3, 7.8, 3.5, [['1 medium (8")', 49], ['1 large (10")', 72]]],
  ['tortilla-corn', 'Tortilla, corn', 218, 5.7, 44.6, 2.9, 6.3, [['1 tortilla', 26]]],
  ['potato-baked', 'Potato, baked', 93, 2.5, 21.2, 0.1, 2.2, [['1 medium', 173]]],
  ['sweet-potato-baked', 'Sweet potato, baked', 90, 2, 20.7, 0.2, 3.3, [['1 medium', 114]]],
  ['quinoa-cooked', 'Quinoa, cooked', 120, 4.4, 21.3, 1.9, 2.8, [['1 cup', 185]]],
  ['rice-cake', 'Rice cake', 387, 8.2, 81.5, 2.8, 4.2, [['1 cake', 9]]],
  ['granola', 'Granola', 471, 10, 64, 20, 6.6, [['1/2 cup', 61]]],
  ['popcorn-air', 'Popcorn, air-popped', 387, 12.9, 77.8, 4.5, 14.5, [['1 cup', 8]]],
  ['black-beans-cooked', 'Black beans, cooked', 132, 8.9, 23.7, 0.5, 8.7, [['1 cup', 172], ['1/2 cup', 86]]],
  ['chickpeas-cooked', 'Chickpeas, cooked', 164, 8.9, 27.4, 2.6, 7.6, [['1 cup', 164]]],
  ['lentils-cooked', 'Lentils, cooked', 116, 9, 20.1, 0.4, 7.9, [['1 cup', 198]]],

  // Fruit
  ['banana', 'Banana', 89, 1.1, 22.8, 0.3, 2.6, [['1 medium', 118], ['1 large', 136]]],
  ['apple', 'Apple', 52, 0.3, 13.8, 0.2, 2.4, [['1 medium', 182]]],
  ['orange', 'Orange', 47, 0.9, 11.8, 0.1, 2.4, [['1 medium', 131]]],
  ['strawberries', 'Strawberries', 32, 0.7, 7.7, 0.3, 2, [['1 cup', 152]]],
  ['blueberries', 'Blueberries', 57, 0.7, 14.5, 0.3, 2.4, [['1 cup', 148]]],
  ['grapes', 'Grapes', 69, 0.7, 18.1, 0.2, 0.9, [['1 cup', 151]]],
  ['watermelon', 'Watermelon', 30, 0.6, 7.6, 0.2, 0.4, [['1 cup diced', 152]]],
  ['pineapple', 'Pineapple', 50, 0.5, 13.1, 0.1, 1.4, [['1 cup', 165]]],
  ['mango', 'Mango', 60, 0.8, 15, 0.4, 1.6, [['1 cup', 165]]],
  ['raisins', 'Raisins', 299, 3.1, 79.2, 0.5, 3.7, [['1/4 cup', 40]]],

  // Vegetables
  ['broccoli', 'Broccoli, raw', 34, 2.8, 6.6, 0.4, 2.6, [['1 cup chopped', 91]]],
  ['broccoli-cooked', 'Broccoli, cooked', 35, 2.4, 7.2, 0.4, 3.3, [['1 cup', 156]]],
  ['spinach', 'Spinach, raw', 23, 2.9, 3.6, 0.4, 2.2, [['1 cup', 30]]],
  ['romaine', 'Lettuce, romaine', 17, 1.2, 3.3, 0.3, 2.1, [['1 cup', 47]]],
  ['carrot', 'Carrot', 41, 0.9, 9.6, 0.2, 2.8, [['1 medium', 61]]],
  ['tomato', 'Tomato', 18, 0.9, 3.9, 0.2, 1.2, [['1 medium', 123]]],
  ['cucumber', 'Cucumber', 15, 0.7, 3.6, 0.1, 0.5, [['1 cup sliced', 104]]],
  ['bell-pepper', 'Bell pepper', 31, 1, 6, 0.3, 2.1, [['1 medium', 119]]],
  ['onion', 'Onion', 40, 1.1, 9.3, 0.1, 1.7, [['1 medium', 110]]],
  ['green-beans-cooked', 'Green beans, cooked', 35, 1.9, 7.9, 0.3, 3.2, [['1 cup', 125]]],
  ['corn-cooked', 'Sweet corn, cooked', 96, 3.4, 21, 1.5, 2.4, [['1 cup', 164]]],
  ['peas-cooked', 'Green peas, cooked', 84, 5.4, 15.6, 0.2, 5.5, [['1 cup', 160]]],
  ['mushrooms', 'Mushrooms', 22, 3.1, 3.3, 0.3, 1, [['1 cup', 70]]],
  ['zucchini', 'Zucchini', 17, 1.2, 3.1, 0.3, 1, [['1 medium', 196]]],
  ['cauliflower', 'Cauliflower', 25, 1.9, 5, 0.3, 2, [['1 cup', 107]]],

  // Drinks
  ['coffee-black', 'Coffee, black', 1, 0.1, 0, 0, 0, [['1 cup', 240]], 'ml'],
  ['orange-juice', 'Orange juice', 45, 0.7, 10.4, 0.2, 0.2, [['1 cup', 248]], 'ml'],
  ['cola', 'Cola (regular)', 39, 0, 10.9, 0, 0, [['1 can', 355]], 'ml'],
  ['beer', 'Beer (regular)', 43, 0.5, 3.6, 0, 0, [['1 bottle', 355]], 'ml'],
  ['wine-red', 'Wine, red', 85, 0.1, 2.6, 0, 0, [['1 glass', 150]], 'ml'],

  // Sweets, snacks, condiments
  ['honey', 'Honey', 304, 0.3, 82.4, 0, 0.2, [['1 tbsp', 21]]],
  ['sugar', 'Sugar', 387, 0, 100, 0, 0, [['1 tsp', 4.2], ['1 tbsp', 12.5]]],
  ['dark-chocolate', 'Dark chocolate (70–85%)', 598, 7.8, 45.9, 42.6, 10.9, [['1 oz', 28]]],
  ['milk-chocolate', 'Milk chocolate', 535, 7.7, 59.4, 29.7, 3.4, [['1 bar', 44]]],
  ['potato-chips', 'Potato chips', 536, 7, 53, 35, 4.4, [['1 oz bag', 28]]],
  ['ketchup', 'Ketchup', 101, 1, 27.4, 0.1, 0.3, [['1 tbsp', 17]]],
  ['french-fries', 'French fries (fast food)', 312, 3.4, 41.4, 14.7, 3.8, [['small', 71], ['medium', 117], ['large', 154]]],
  ['pizza-cheese', 'Pizza, cheese', 266, 11.4, 33.3, 9.7, 2.3, [['1 slice', 107]]],
]

export const BUILTIN_FOODS: Food[] = rows.map(([id, name, kcal, protein, carbs, fat, fiber, servings, unit]) => ({
  id: `b:${id}`,
  name,
  per100: { kcal, protein, carbs, fat, fiber },
  servings: servings.map(([label, grams]): Serving => ({ label, grams })),
  unit: unit ?? 'g',
  source: 'builtin',
}))
