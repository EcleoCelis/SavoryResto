# SavoryBites Menu Image Attributions & Media Manifest

Every active menu dish image stored in `backend/media/dishes/` uses sanitized WebP format (`quality=85`, metadata stripped, downscaled to `<=1600px`) served through `GET /api/v1/media/dishes/{filename}` and mapped by stable `menu_items.id`.

| Product ID | Dish Name | Category | Status | Stored Image URL | WebP Dimensions & Size | Source Page | Photographer / Author | License | Attribution Required |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Classic Burger | Burgers | Downloaded & Integrated | `/api/v1/media/dishes/dish_ad8ef5c9cde74c50b44f22f6d212256a.webp` | `1600x1067` (248,618 B) | https://commons.wikimedia.org/wiki/File:NCI_Visuals_Food_Hamburger.jpg | Len Rizzi (National Cancer Institute) | Public domain | No |
| 2 | Cheese Burger | Burgers | Retained Existing | `/api/v1/media/dishes/dish_41f9dc72448742bcbe713f82392e0e21.webp` | `1600x1067` (145,934 B) | Pre-existing SavoryBites dish upload | Existing Restaurant Media | Retained asset | N/A |
| 3 | Crispy Chicken Meal | Chicken | Downloaded & Integrated | `/api/v1/media/dishes/dish_f08a32b070db4cf18bd4628d9923d1d1.webp` | `1600x1071` (120,612 B) | https://commons.wikimedia.org/wiki/File:Thai-style_Hainanese_Crispy_Fried_Chicken_Rice.jpg | Alpha | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) | Yes (displayed on `/about`) |
| 4 | Chicken Alfredo | Pasta | Downloaded & Integrated | `/api/v1/media/dishes/dish_31c4bca5b08542c9a30a2debbb154cd7.webp` | `1367x885` (110,886 B) | https://commons.wikimedia.org/wiki/File:Fettuccini_alfredo_with_grilled_chicken_(Medici)_(53448852).jpg | Kim Scarborough | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) | Yes (displayed on `/about`) |
| 5 | Chicken Adobo Rice | Rice Meals | Downloaded & Integrated | `/api/v1/media/dishes/dish_3207c0d2232140c4859a4786f2aaedb1.webp` | `1600x1207` (189,764 B) | https://commons.wikimedia.org/wiki/File:Chicken_Adobo_over_rice.jpg | Jack Lawrence | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) | Yes (displayed on `/about`) |
| 6 | Hawaiian Pizza | Pizza | Downloaded & Integrated | `/api/v1/media/dishes/dish_2ca185930f5a4147966fbce0490ee5b0.webp` | `1600x1067` (167,724 B) | https://commons.wikimedia.org/wiki/File:Hawaiian_pizza_image.jpg | Elsie Hui | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) | Yes (displayed on `/about`) |
| 7 | Garden Salad | Salads | Downloaded & Integrated | `/api/v1/media/dishes/dish_6f1c9664fac4472d905e45f4871dfdc4.webp` | `1600x1600` (480,892 B) | https://commons.wikimedia.org/wiki/File:Garden_salad_-_San_Francisco.jpg | Daderot | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | No |
| 8 | Chocolate Cake | Desserts | Downloaded & Integrated | `/api/v1/media/dishes/dish_0c6ae7ca4f4449bc84f282c8a6e2599d.webp` | `1600x1205` (224,140 B) | https://commons.wikimedia.org/wiki/File:Flourless_Chocolate_Cake_-_Sugardough_2025-07-01.jpg | Andy Li | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | No |
| 9 | Iced Tea | Beverages | Downloaded & Integrated | `/api/v1/media/dishes/dish_86fdfc1d39454775875fc80a870f5135.webp` | `1600x1600` (160,888 B) | https://commons.wikimedia.org/wiki/File:Iced_tea_(Unsplash).jpg | Julia D'Alkmin (`jdalkmin`) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | No |
| 10 | French Fries | Snacks | Downloaded & Integrated | `/api/v1/media/dishes/dish_d09846a7d1d84df890d642e010a5162e.webp` | `1600x1067` (82,908 B) | https://commons.wikimedia.org/wiki/File:Truffle_Fries_(Unsplash).jpg | Stephanie McCabe (`stephaniemccabe`) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | No |

## Category Summary Note

- **Breakfast** (`menu_categories.id = 9`, active) currently has `0` active dishes in `menu_items` and therefore requires no dish image records yet.
- All `menu_items` with `deleted_at IS NULL` (IDs `1` through `10`, including unavailable item `#9 Iced Tea`) have verified, distinct, non-duplicate WebP photographs.
- Image transformations applied: decoded from verified JPEG source, metadata/EXIF stripped, Lanczos downscaled (where > 1600px), and encoded to clean `image/webp`.
