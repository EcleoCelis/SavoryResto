export type Category = {
  id: number;
  name: string;
  description: string | null;
  display_order: number;
};

export type CategoryDetail = Category & {
  is_active: boolean;
  product_count: number;
  updated_at?: string | null;
};

export type Product = {
  id: number;
  category_id: number;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;
  is_available: boolean;
  updated_at?: string | null;
  category: Category;
  sizes: ProductOption[];
  addons: ProductOption[];
  ingredient_names?: string[];
};

export type ProductOption = {
  code: string;
  label: string;
  price_adjustment: number;
};

export type ProductCreateInput = {
  name: string;
  category_id: number;
  price: number;
  description?: string | null;
  image_url?: string | null;
  is_available?: boolean;
};

export type ProductUpdateInput = Partial<ProductCreateInput> & {
  expected_updated_at?: string | null;
};

export type CategoryCreateInput = {
  name: string;
  description?: string | null;
  display_order?: number;
  is_active?: boolean;
};

export type CategoryUpdateInput = Partial<CategoryCreateInput> & {
  expected_updated_at?: string | null;
};

export type DishImageUploadResponse = {
  filename: string;
  image_url: string;
  size_bytes: number;
  width: number;
  height: number;
  content_type: string;
};
