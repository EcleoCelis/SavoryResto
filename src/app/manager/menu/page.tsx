"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  deleteUploadedDishImage,
  getManagerCategories,
  getManagerProducts,
  toggleProductAvailability,
  updateCategory,
  updateProduct,
  uploadDishImage,
} from "../../../lib/api/products";
import {
  CloseIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  EditIcon,
  TrashIcon,
  BookOpenIcon,
  CheckIcon,
  DishSortIcon,
  UploadCloudIcon,
} from "../../../components/ui/Icons";
import type { CategoryDetail, Product } from "../../../types/product";
import styles from "./menu.module.css";

type ViewMode = "editing" | "preview";
type AvailabilityFilter = "all" | "available" | "unavailable";
type SortOption = "name-asc" | "price-asc" | "price-desc";

const sortLabels: Record<SortOption, string> = {
  "name-asc": "Name (A to Z)",
  "price-asc": "Price: Low to High",
  "price-desc": "Price: High to Low",
};

const currencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

export default function ManagerMenuPage() {
  const searchInputId = useId();
  const dishNameInputId = useId();
  const dishCatInputId = useId();
  const dishPriceInputId = useId();
  const dishDescInputId = useId();
  const dishImageInputId = useId();
  const catNameInputId = useId();
  const catOrderInputId = useId();
  const catDescInputId = useId();

  // Core Data
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<CategoryDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // View & Filter States
  const [viewMode, setViewMode] = useState<ViewMode>("editing");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("name-asc");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortControlRef = useRef<HTMLDivElement>(null);

  // Close sorting popover on outside click or Escape key
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sortControlRef.current && !sortControlRef.current.contains(event.target as Node)) {
        setSortMenuOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSortMenuOpen(false);
      }
    }
    if (sortMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [sortMenuOpen]);

  // Dish Modal States
  const [dishModalOpen, setDishModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [dishName, setDishName] = useState("");
  const [dishCategoryId, setDishCategoryId] = useState<number>(0);
  const [dishPrice, setDishPrice] = useState("");
  const [dishDescription, setDishDescription] = useState("");
  const [dishImageUrl, setDishImageUrl] = useState("");
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dishIsAvailable, setDishIsAvailable] = useState(true);
  const [dishFormError, setDishFormError] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dishModalRef = useRef<HTMLDivElement>(null);
  const dishModalOpenerRef = useRef<HTMLElement | null>(null);

  // Clean up blob preview URL on unmount or when image changes
  useEffect(() => {
    return () => {
      if (imagePreviewUrl && imagePreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  const closeDishModal = useCallback(() => {
    if (imagePreviewUrl && imagePreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setSelectedImageFile(null);
    setImagePreviewUrl(null);
    setDishImageUrl("");
    setDishFormError("");
    setDishModalOpen(false);
    if (dishModalOpenerRef.current) {
      dishModalOpenerRef.current.focus();
    }
  }, [imagePreviewUrl]);

  // Trap focus and handle Escape for dish modal
  useEffect(() => {
    if (!dishModalOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (!actionLoading) {
          closeDishModal();
        }
        return;
      }
      if (e.key === "Tab" && dishModalRef.current) {
        const focusable = dishModalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dishModalOpen, actionLoading, closeDishModal]);

  function handleFileSelect(file: File) {
    const MAX_SIZE = 30 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setDishFormError("The selected image exceeds 30 MB. Please select a smaller photo.");
      return;
    }
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type.toLowerCase())) {
      setDishFormError("Unsupported file format. Please upload a JPEG, PNG, or WebP image.");
      return;
    }

    if (imagePreviewUrl && imagePreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setSelectedImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
    setDishFormError("");
  }

  function handleRemoveImage() {
    if (imagePreviewUrl && imagePreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setSelectedImageFile(null);
    setImagePreviewUrl(null);
    setDishImageUrl("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  // Category Modal States
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryDetail | null>(null);
  const [catName, setCatName] = useState("");
  const [catOrder, setCatOrder] = useState("0");
  const [catDesc, setCatDesc] = useState("");
  const [catFormError, setCatFormError] = useState("");

  // Delete Confirmation Modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ type: "product" | "category"; id: number; name: string } | null>(null);

  // Load backend catalog data
  async function loadData(showLoading = false) {
    try {
      if (showLoading) setLoading(true);
      const [loadedProducts, loadedCategories] = await Promise.all([
        getManagerProducts({ availability: "all" }),
        getManagerCategories(),
      ]);
      setNotification(null);
      setProducts(loadedProducts);
      setCategories(loadedCategories);
    } catch (err) {
      setNotification({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to load restaurant catalog.",
      });
    } finally {
      setLoading(false);
    }
  }

  // Initial catalog load — state is only updated from async callbacks (no synchronous setState in the effect body).
  useEffect(() => {
    let active = true;
    Promise.all([getManagerProducts({ availability: "all" }), getManagerCategories()])
      .then(([loadedProducts, loadedCategories]) => {
        if (!active) return;
        setProducts(loadedProducts);
        setCategories(loadedCategories);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setNotification({
          type: "error",
          message: err instanceof Error ? err.message : "Failed to load restaurant catalog.",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Availability Switch Toggle
  async function handleToggleAvailability(product: Product) {
    const nextAvailability = !product.is_available;
    // Optimistic UI update
    setProducts((prev) =>
      prev.map((p) => (p.id === product.id ? { ...p, is_available: nextAvailability } : p))
    );

    try {
      const updated = await toggleProductAvailability(product.id, nextAvailability);
      setProducts((prev) => prev.map((p) => (p.id === product.id ? updated : p)));
      setNotification({
        type: "success",
        message: `"${product.name}" is now ${nextAvailability ? "active and visible to customers" : "hidden from ordering"}.`,
      });
    } catch (err) {
      // Revert on failure
      setProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, is_available: product.is_available } : p))
      );
      setNotification({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to update dish availability.",
      });
    }
  }

  // Dish Modal Openers
  function openAddDishModal(opener?: HTMLElement) {
    dishModalOpenerRef.current = opener || (document.activeElement as HTMLElement);
    if (imagePreviewUrl && imagePreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setEditingProduct(null);
    setDishName("");
    setDishCategoryId(categories[0]?.id || 0);
    setDishPrice("");
    setDishDescription("");
    setDishImageUrl("");
    setSelectedImageFile(null);
    setImagePreviewUrl(null);
    setDishIsAvailable(true);
    setDishFormError("");
    setDishModalOpen(true);
  }

  function openEditDishModal(product: Product, opener?: HTMLElement) {
    dishModalOpenerRef.current = opener || (document.activeElement as HTMLElement);
    if (imagePreviewUrl && imagePreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setEditingProduct(product);
    setDishName(product.name);
    setDishCategoryId(product.category_id);
    setDishPrice(String(product.price));
    setDishDescription(product.description || "");
    setDishImageUrl(product.image_url || "");
    setSelectedImageFile(null);
    setImagePreviewUrl(product.image_url || null);
    setDishIsAvailable(product.is_available);
    setDishFormError("");
    setDishModalOpen(true);
  }

  // Save Dish
  async function handleSaveDish(e: React.FormEvent) {
    e.preventDefault();
    setDishFormError("");

    const trimmedName = dishName.trim();
    if (!trimmedName) {
      setDishFormError("Dish name is required.");
      return;
    }
    if (!dishCategoryId) {
      setDishFormError("Please select a valid category.");
      return;
    }
    const numPrice = Number(dishPrice);
    if (!Number.isFinite(numPrice) || numPrice <= 0) {
      setDishFormError("Price must be a valid positive amount in Philippine Pesos (₱).");
      return;
    }

    setActionLoading(true);
    let uploadedNewImageUrl: string | null = null;

    try {
      // 1. If an image file was selected by the manager, upload to backend first
      if (selectedImageFile) {
        try {
          const uploadRes = await uploadDishImage(selectedImageFile);
          uploadedNewImageUrl = uploadRes.image_url;
        } catch (uploadErr) {
          setDishFormError(
            uploadErr instanceof Error ? uploadErr.message : "Failed to upload dish photo."
          );
          setActionLoading(false);
          return;
        }
      }

      // Determine final image URL
      const finalImageUrl = uploadedNewImageUrl || (dishImageUrl.trim() || null);

      // 2. Persist in PostgreSQL
      try {
        if (editingProduct) {
          const updated = await updateProduct(editingProduct.id, {
            name: trimmedName,
            category_id: dishCategoryId,
            price: numPrice,
            description: dishDescription.trim() || null,
            image_url: finalImageUrl,
            is_available: dishIsAvailable,
          });
          setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
          setNotification({ type: "success", message: `"${updated.name}" updated successfully.` });
        } else {
          const created = await createProduct({
            name: trimmedName,
            category_id: dishCategoryId,
            price: numPrice,
            description: dishDescription.trim() || null,
            image_url: finalImageUrl,
            is_available: dishIsAvailable,
          });
          setProducts((prev) => [created, ...prev]);
          setNotification({ type: "success", message: `"${created.name}" added to menu.` });
        }
      } catch (saveErr) {
        // Compensating cleanup: If we newly uploaded an image but product creation failed,
        // clean up the orphaned file from the server
        if (uploadedNewImageUrl) {
          void deleteUploadedDishImage(uploadedNewImageUrl).catch(() => {});
        }
        throw saveErr;
      }

      closeDishModal();
      // Refresh category counts
      const updatedCats = await getManagerCategories();
      setCategories(updatedCats);
    } catch (err) {
      setDishFormError(err instanceof Error ? err.message : "Failed to save dish.");
    } finally {
      setActionLoading(false);
    }
  }

  // Category Modal Openers
  function openAddCategoryModal() {
    setEditingCategory(null);
    setCatName("");
    setCatOrder(String((categories.length + 1) * 10));
    setCatDesc("");
    setCatFormError("");
    setCategoryModalOpen(true);
  }

  function openEditCategoryModal(cat: CategoryDetail) {
    setEditingCategory(cat);
    setCatName(cat.name);
    setCatOrder(String(cat.display_order));
    setCatDesc(cat.description || "");
    setCatFormError("");
    setCategoryModalOpen(true);
  }

  // Save Category
  async function handleSaveCategory(e: React.FormEvent) {
    e.preventDefault();
    setCatFormError("");

    const trimmed = catName.trim();
    if (!trimmed) {
      setCatFormError("Category name cannot be blank.");
      return;
    }
    const orderNum = parseInt(catOrder, 10);
    if (!Number.isFinite(orderNum)) {
      setCatFormError("Display order must be a valid integer.");
      return;
    }

    setActionLoading(true);
    try {
      if (editingCategory) {
        const updated = await updateCategory(editingCategory.id, {
          name: trimmed,
          display_order: orderNum,
          description: catDesc.trim() || null,
        });
        setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        setNotification({ type: "success", message: `Category "${updated.name}" updated.` });
      } else {
        const created = await createCategory({
          name: trimmed,
          display_order: orderNum,
          description: catDesc.trim() || null,
        });
        setCategories((prev) => [...prev, created]);
        setNotification({ type: "success", message: `Category "${created.name}" created.` });
      }
      setCategoryModalOpen(false);
    } catch (err) {
      setCatFormError(err instanceof Error ? err.message : "Failed to save category.");
    } finally {
      setActionLoading(false);
    }
  }

  // Trigger Delete Confirmation
  function confirmDeleteDish(product: Product) {
    setItemToDelete({ type: "product", id: product.id, name: product.name });
    setDeleteModalOpen(true);
  }

  function confirmDeleteCategory(cat: CategoryDetail) {
    setItemToDelete({ type: "category", id: cat.id, name: cat.name });
    setDeleteModalOpen(true);
  }

  // Execute Confirmed Delete
  async function handleExecuteDelete() {
    if (!itemToDelete) return;
    setActionLoading(true);

    try {
      if (itemToDelete.type === "product") {
        await deleteProduct(itemToDelete.id);
        setProducts((prev) => prev.filter((p) => p.id !== itemToDelete.id));
        setNotification({ type: "success", message: `"${itemToDelete.name}" was removed from the menu.` });
        const updatedCats = await getManagerCategories();
        setCategories(updatedCats);
      } else {
        const res = await deleteCategory(itemToDelete.id);
        setCategories((prev) => prev.filter((c) => c.id !== itemToDelete.id));
        if (selectedCategory === String(itemToDelete.id)) {
          setSelectedCategory("all");
        }
        setNotification({ type: "success", message: res.message || `Category "${itemToDelete.name}" removed.` });
      }
      setDeleteModalOpen(false);
      setItemToDelete(null);
    } catch (err) {
      setNotification({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to execute deletion.",
      });
      setDeleteModalOpen(false);
    } finally {
      setActionLoading(false);
    }
  }

  // Filter and Sort Pipeline
  const filteredProducts = products
    .filter((prod) => {
      // Category filter
      if (selectedCategory !== "all" && prod.category_id !== Number(selectedCategory)) {
        return false;
      }
      // Availability filter
      if (availabilityFilter === "available" && !prod.is_available) return false;
      if (availabilityFilter === "unavailable" && prod.is_available) return false;
      // Search
      if (search.trim()) {
        const term = search.trim().toLowerCase();
        const matchName = prod.name.toLowerCase().includes(term);
        const matchDesc = prod.description?.toLowerCase().includes(term) ?? false;
        const matchCat = prod.category?.name.toLowerCase().includes(term) ?? false;
        if (!matchName && !matchDesc && !matchCat) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "name-asc") return a.name.localeCompare(b.name);
      if (sortBy === "price-asc") return a.price - b.price;
      if (sortBy === "price-desc") return b.price - a.price;
      return 0;
    });

  // Overview Counts
  const totalDishes = products.length;
  const availableDishes = products.filter((p) => p.is_available).length;
  const unavailableDishes = totalDishes - availableDishes;
  const totalCategories = categories.length;

  const currentCategoryObj =
    selectedCategory === "all" ? null : categories.find((c) => c.id === Number(selectedCategory));

  return (
    <div className={styles.menuPage}>
      {/* Page Header */}
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Menu Management</h1>

        <div className={styles.headerActions}>
          {/* View Mode Tabs */}
          <div className={styles.viewTabs} role="tablist" aria-label="Menu view mode">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "editing"}
              className={`${styles.viewTabBtn} ${viewMode === "editing" ? styles.viewTabBtnActive : ""}`}
              onClick={() => setViewMode("editing")}
            >
              Menu Editing
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "preview"}
              className={`${styles.viewTabBtn} ${viewMode === "preview" ? styles.viewTabBtnActive : ""}`}
              onClick={() => setViewMode("preview")}
            >
              Preview
            </button>
          </div>

          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => void loadData(true)}
            disabled={loading}
            aria-label="Refresh restaurant catalog"
          >
            <RefreshIcon size={15} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            className={styles.primaryBtn}
            onClick={(e) => openAddDishModal(e.currentTarget)}
            aria-label="Add a new dish to the menu"
          >
            <PlusIcon size={15} />
            <span>Add Dish</span>
          </button>
        </div>
      </header>

      {/* Notifications */}
      {notification && (
        <div
          className={`${styles.alertBox} ${notification.type === "success" ? styles.alertSuccess : styles.alertError}`}
          role="alert"
        >
          {notification.message}
        </div>
      )}

      {/* Operational Metrics Cards (Section 6.2) */}
      <section className={styles.metricsGrid} aria-label="Catalog summary metrics">
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Total Menu Dishes</span>
          <span className={styles.metricValue}>{totalDishes}</span>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Available for Ordering</span>
          <span className={styles.metricValue}>{availableDishes}</span>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Unavailable / Sold Out</span>
          <span className={styles.metricValue}>{unavailableDishes}</span>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Active Categories</span>
          <span className={styles.metricValue}>{totalCategories}</span>
        </article>
      </section>

      {/* Main Content: Editing Mode (Two Columns) vs Preview Grid */}
      {viewMode === "editing" ? (
        <div className={styles.layoutTwoCol}>
          {/* Left Column: Dish Categories */}
          <aside className={styles.categoriesCard} aria-label="Dish Categories">
            <div className={styles.categoriesHeader}>
              <h2 className={styles.categoriesTitle}>Dish Categories</h2>
              <span className={styles.categoryCount}>{categories.length}</span>
            </div>

            <ul className={styles.categoryList} aria-label="Category filter">
              <li
                className={`${styles.categoryRow} ${selectedCategory === "all" ? styles.categoryRowActive : ""}`}
              >
                <button
                  type="button"
                  className={styles.categorySelectBtn}
                  onClick={() => setSelectedCategory("all")}
                  aria-pressed={selectedCategory === "all"}
                >
                  <span className={styles.categoryName}>All Dishes</span>
                  <span className={styles.categoryCount}>{totalDishes}</span>
                </button>
              </li>

              {categories.map((cat) => {
                const isSelected = selectedCategory === String(cat.id);
                return (
                  <li
                    key={cat.id}
                    className={`${styles.categoryRow} ${isSelected ? styles.categoryRowActive : ""}`}
                  >
                    <button
                      type="button"
                      className={styles.categorySelectBtn}
                      onClick={() => setSelectedCategory(String(cat.id))}
                      aria-pressed={isSelected}
                    >
                      <span className={styles.categoryName} title={cat.name}>
                        {cat.name}
                      </span>
                      <span className={styles.categoryCount}>{cat.product_count}</span>
                    </button>
                    <div className={styles.categoryActions}>
                      <button
                        type="button"
                        className={styles.iconBtnSmall}
                        onClick={() => openEditCategoryModal(cat)}
                        title={`Edit category ${cat.name}`}
                        aria-label={`Edit category ${cat.name}`}
                      >
                        <EditIcon size={14} />
                      </button>
                      <button
                        type="button"
                        className={`${styles.iconBtnSmall} ${styles.iconBtnSmallDanger}`}
                        onClick={() => confirmDeleteCategory(cat)}
                        title={`Delete category ${cat.name}`}
                        aria-label={`Delete category ${cat.name}`}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <button
              type="button"
              className={styles.addCategoryBtn}
              onClick={openAddCategoryModal}
            >
              <PlusIcon size={15} />
              <span>New Category</span>
            </button>
          </aside>

          {/* Right Column: Dish Items List */}
          <section className={styles.dishesContainer} aria-label="Menu Items List">
            {/* Toolbar: Search, Filters, Sorting */}
            <div className={styles.toolbar}>
              <div className={styles.toolbarLeft}>
                <div className={styles.searchBox}>
                  <span className={styles.searchIconWrapper} aria-hidden="true">
                    <SearchIcon size={15} />
                  </span>
                  <input
                    id={searchInputId}
                    type="search"
                    className={styles.searchInput}
                    placeholder="Search dishes by name or description..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Search dishes"
                  />
                </div>
              </div>

              <div className={styles.toolbarRight}>
                <div className={styles.filterPills} role="group" aria-label="Filter by availability">
                  <button
                    type="button"
                    className={`${styles.filterPillBtn} ${availabilityFilter === "all" ? styles.filterPillBtnActive : ""}`}
                    onClick={() => setAvailabilityFilter("all")}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    className={`${styles.filterPillBtn} ${availabilityFilter === "available" ? styles.filterPillBtnActive : ""}`}
                    onClick={() => setAvailabilityFilter("available")}
                  >
                    Available
                  </button>
                  <button
                    type="button"
                    className={`${styles.filterPillBtn} ${availabilityFilter === "unavailable" ? styles.filterPillBtnActive : ""}`}
                    onClick={() => setAvailabilityFilter("unavailable")}
                  >
                    Unavailable
                  </button>
                </div>

                {/* Dish Sorting Dropdown */}
                <div ref={sortControlRef} className={styles.sortControlWrapper}>
                  <button
                    type="button"
                    className={`${styles.sortTriggerBtn} ${
                      sortMenuOpen ? styles.sortTriggerBtnActive : ""
                    }`}
                    onClick={() => setSortMenuOpen((prev) => !prev)}
                    aria-expanded={sortMenuOpen}
                    aria-haspopup="listbox"
                    aria-label={`Dish Sorting: currently sorted by ${sortLabels[sortBy]}`}
                  >
                    <DishSortIcon size={15} />
                    <span>Sort: {sortLabels[sortBy]}</span>
                  </button>

                  {sortMenuOpen && (
                    <div
                      className={styles.sortPopover}
                      role="listbox"
                      aria-label="Dish Sorting Options"
                    >
                      <div className={styles.sortPopoverHeader}>Sort Dishes By</div>
                      {(["name-asc", "price-asc", "price-desc"] as SortOption[]).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          role="option"
                          aria-selected={sortBy === opt}
                          className={`${styles.sortOptionBtn} ${
                            sortBy === opt ? styles.sortOptionBtnActive : ""
                          }`}
                          onClick={() => {
                            setSortBy(opt);
                            setSortMenuOpen(false);
                          }}
                        >
                          <span>{sortLabels[opt]}</span>
                          {sortBy === opt && (
                            <CheckIcon size={14} className={styles.sortOptionCheck} />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Section Heading */}
            <div className={styles.categorySectionTitleBar}>
              <h2 className={styles.categorySectionTitle}>
                {currentCategoryObj ? currentCategoryObj.name : "All Dishes"}
              </h2>
              <span className={styles.categorySectionCount}>
                {filteredProducts.length} dish{filteredProducts.length === 1 ? "" : "es"} in view
              </span>
            </div>

            {/* Dish Rows */}
            {filteredProducts.length === 0 ? (
              <div className={styles.emptyState}>
                <p>No dishes match the selected category and filter criteria.</p>
              </div>
            ) : (
              <div className={styles.dishList}>
                {filteredProducts.map((prod) => (
                  <article key={prod.id} className={styles.dishRow}>
                    {/* Dish Image */}
                    {prod.image_url ? (
                      <img
                        src={prod.image_url}
                        alt={prod.name}
                        className={styles.dishThumbnail}
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 24 24' fill='none' stroke='%238d9b93' stroke-width='1.5'%3E%3Cpath d='M18 2v6a3 3 0 0 1-3 3 3 3 0 0 1-3-3V2'/%3E%3Cpath d='M15 11v11'/%3E%3Cpath d='M5 2v4a3 3 0 0 0 3 3v13'/%3E%3C/svg%3E";
                        }}
                      />
                    ) : (
                      <div className={`${styles.dishThumbnail} ${styles.thumbPlaceholder}`}>
                        <BookOpenIcon size={22} />
                      </div>
                    )}

                    {/* Dish Info */}
                    <div className={styles.dishInfo}>
                      <div className={styles.dishHeaderRow}>
                        <h3 className={styles.dishName}>{prod.name}</h3>
                        <span className={styles.dishCategoryBadge}>
                          {prod.category?.name || "Uncategorized"}
                        </span>
                      </div>
                      {prod.description && (
                        <p className={styles.dishDescription}>{prod.description}</p>
                      )}
                      <span className={styles.dishPrice}>{currencyFormatter.format(prod.price)}</span>
                    </div>

                    {/* Controls & Actions */}
                    <div className={styles.dishControls}>
                      {/* Sales Status Toggle Switch */}
                      <label className={styles.salesStatusToggle}>
                        <span>Available</span>
                        <span className={styles.switch}>
                          <input
                            type="checkbox"
                            checked={prod.is_available}
                            onChange={() => void handleToggleAvailability(prod)}
                            aria-label={`Toggle sales availability for ${prod.name}`}
                          />
                          <span className={styles.slider} />
                        </span>
                      </label>

                      {/* Edit & Delete Actions */}
                      <div className={styles.dishActions}>
                        <button
                          type="button"
                          className={styles.actionBtnEdit}
                          onClick={(e) => openEditDishModal(prod, e.currentTarget)}
                          aria-label={`Edit ${prod.name}`}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={styles.actionBtnDelete}
                          onClick={() => confirmDeleteDish(prod)}
                          aria-label={`Delete ${prod.name}`}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : (
        /* Preview Grid */
        <section className={styles.previewGrid} aria-label="Customer View Catalog Preview">
          {filteredProducts.map((prod) => (
            <article key={prod.id} className={styles.previewCard}>
              {prod.image_url ? (
                <img
                  src={prod.image_url}
                  alt={prod.name}
                  className={styles.previewImage}
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src =
                      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='176' viewBox='0 0 24 24' fill='none' stroke='%238d9b93' stroke-width='1.5'%3E%3Cpath d='M18 2v6a3 3 0 0 1-3 3 3 3 0 0 1-3-3V2'/%3E%3Cpath d='M15 11v11'/%3E%3Cpath d='M5 2v4a3 3 0 0 0 3 3v13'/%3E%3C/svg%3E";
                  }}
                />
              ) : (
                <div className={`${styles.previewImage} ${styles.thumbPlaceholder}`}>
                  <BookOpenIcon size={28} />
                </div>
              )}
              <div className={styles.previewBody}>
                <h3 className={styles.previewDishTitle}>{prod.name}</h3>
                {prod.description && <p className={styles.previewDishDesc}>{prod.description}</p>}
                <div className={styles.previewFooter}>
                  <span className={styles.previewPrice}>{currencyFormatter.format(prod.price)}</span>
                  <span
                    className={`${styles.previewBadge} ${
                      prod.is_available ? styles.previewAvailable : styles.previewUnavailable
                    }`}
                  >
                    <span className={styles.statusDot} aria-hidden="true" />
                    <span>{prod.is_available ? "In Stock" : "Sold Out"}</span>
                  </span>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {/* Add / Edit Dish Modal */}
      {dishModalOpen && (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="dishModalTitle"
          aria-describedby="dishModalDesc"
        >
          <div ref={dishModalRef} className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <div className={styles.modalHeaderContent}>
                <h2 id="dishModalTitle" className={styles.modalTitle}>
                  {editingProduct ? `Edit "${editingProduct.name}"` : "Add Dish"}
                </h2>
                <p id="dishModalDesc" className={styles.modalSubtitle}>
                  {editingProduct
                    ? "Update recipe details, pricing in Philippine pesos (₱), availability, and photo."
                    : "Add a new culinary dish with photo, Philippine peso (₱) pricing, and category."}
                </p>
              </div>
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={closeDishModal}
                aria-label="Close modal"
                disabled={actionLoading}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveDish}>
              <div className={styles.modalBody}>
                {dishFormError && (
                  <div className={`${styles.alertBox} ${styles.alertError}`} role="alert">
                    {dishFormError}
                  </div>
                )}

                {/* Dish Photo Upload Section (Default & Primary Workflow) */}
                <div className={styles.formGroup}>
                  <span id="dishImageLabel" className={styles.formLabel}>
                    Dish Photo
                  </span>
                  <input
                    ref={fileInputRef}
                    id={dishImageInputId}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className={styles.hiddenFileInput}
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        handleFileSelect(e.target.files[0]);
                      }
                    }}
                    tabIndex={-1}
                    aria-hidden="true"
                  />

                  {imagePreviewUrl ? (
                    <div className={styles.imagePreviewCard}>
                      <img
                        src={imagePreviewUrl}
                        alt={dishName ? `${dishName} preview` : "Dish photo preview"}
                        className={styles.imagePreviewImg}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            "/images/delicious-crispy-chicken-nuggets-with-garlic-dip-wooden-table.jpg";
                        }}
                      />
                      <div className={styles.imagePreviewOverlay}>
                        <button
                          type="button"
                          className={`${styles.previewActionBtn} ${styles.previewActionBtnReplace}`}
                          onClick={() => fileInputRef.current?.click()}
                          aria-label="Replace dish photo"
                          disabled={actionLoading}
                        >
                          <UploadCloudIcon size={16} />
                          <span>Replace</span>
                        </button>
                        <button
                          type="button"
                          className={`${styles.previewActionBtn} ${styles.previewActionBtnRemove}`}
                          onClick={handleRemoveImage}
                          aria-label="Remove dish photo"
                          disabled={actionLoading}
                        >
                          <TrashIcon size={16} />
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`${styles.uploadDropzone} ${
                        isDragging ? styles.uploadDropzoneActive : ""
                      }`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                        if (e.dataTransfer.files?.[0]) {
                          handleFileSelect(e.dataTransfer.files[0]);
                        }
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          fileInputRef.current?.click();
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-labelledby="dishImageLabel dishImagePrompt dishImageHint"
                    >
                      <span className={styles.uploadIcon}>
                        <UploadCloudIcon size={32} />
                      </span>
                      <p id="dishImagePrompt" className={styles.uploadPrompt}>
                        Drag and drop dish photo here, or{" "}
                        <span className={styles.uploadBrowseText}>browse files</span>
                      </p>
                      <p id="dishImageHint" className={styles.uploadHint}>
                        Accepted formats: JPEG, PNG, WebP (Max 30 MB)
                      </p>
                    </div>
                  )}
                  {selectedImageFile && (
                    <div className={styles.imageFileInfoRow}>
                      <span>Selected: {selectedImageFile.name}</span>
                      <span>{(selectedImageFile.size / 1024).toFixed(0)} KB</span>
                    </div>
                  )}
                </div>

                {/* Category Selection & Price */}
                <div className={styles.formRowTwo}>
                  <div className={styles.formGroup}>
                    <label htmlFor={dishCatInputId} className={styles.formLabel}>
                      Category *
                    </label>
                    <select
                      id={dishCatInputId}
                      className={styles.formSelect}
                      value={dishCategoryId}
                      onChange={(e) => setDishCategoryId(Number(e.target.value))}
                      required
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Price (Philippine Pesos) */}
                  <div className={styles.formGroup}>
                    <label htmlFor={dishPriceInputId} className={styles.formLabel}>
                      Price (PHP ₱) *
                    </label>
                    <div className={styles.priceInputWrapper}>
                      <span className={styles.currencySymbol} aria-hidden="true">
                        ₱
                      </span>
                      <input
                        id={dishPriceInputId}
                        type="number"
                        step="0.01"
                        min="0.01"
                        className={`${styles.formInput} ${styles.priceInput}`}
                        value={dishPrice}
                        onChange={(e) => setDishPrice(e.target.value)}
                        placeholder="0.00"
                        required
                        aria-label="Price in Philippine Pesos"
                      />
                    </div>
                  </div>
                </div>

                {/* Dish Name */}
                <div className={styles.formGroup}>
                  <label htmlFor={dishNameInputId} className={styles.formLabel}>
                    Dish Name *
                  </label>
                  <input
                    id={dishNameInputId}
                    type="text"
                    className={styles.formInput}
                    value={dishName}
                    onChange={(e) => setDishName(e.target.value)}
                    placeholder="e.g. Crispy Garlic Butter Shrimp"
                    required
                    maxLength={100}
                  />
                </div>

                {/* Description */}
                <div className={styles.formGroup}>
                  <label htmlFor={dishDescInputId} className={styles.formLabel}>
                    Description
                  </label>
                  <textarea
                    id={dishDescInputId}
                    className={styles.formTextarea}
                    value={dishDescription}
                    onChange={(e) => setDishDescription(e.target.value)}
                    placeholder="Concise ingredient and preparation summary..."
                    rows={3}
                    maxLength={500}
                  />
                </div>

                {/* Availability Toggle */}
                <div className={styles.availabilityToggleRow}>
                  <label htmlFor="modal-dish-available" className={styles.availabilityToggleLabel}>
                    <span className={styles.availabilityToggleTitle}>Customer Ordering Availability</span>
                    <span className={styles.availabilityToggleDesc}>
                      When active, this dish appears immediately on customer-facing dining and takeaway menus.
                    </span>
                  </label>
                  <input
                    id="modal-dish-available"
                    type="checkbox"
                    className={styles.checkboxCustom}
                    checked={dishIsAvailable}
                    onChange={(e) => setDishIsAvailable(e.target.checked)}
                  />
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={closeDishModal}
                  disabled={actionLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.primaryBtn}
                  disabled={actionLoading}
                >
                  {actionLoading ? "Saving Dish..." : editingProduct ? "Save Changes" : "Save Dish"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Category Modal */}
      {categoryModalOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="catModalTitle">
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h2 id="catModalTitle" className={styles.modalTitle}>
                {editingCategory ? `Edit Category: "${editingCategory.name}"` : "Create Dish Category"}
              </h2>
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => setCategoryModalOpen(false)}
                aria-label="Close modal"
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveCategory}>
              <div className={styles.modalBody}>
                {catFormError && (
                  <div className={`${styles.alertBox} ${styles.alertError}`} role="alert">
                    {catFormError}
                  </div>
                )}

                <div className={styles.formGroup}>
                  <label htmlFor={catNameInputId} className={styles.formLabel}>
                    Category Name *
                  </label>
                  <input
                    id={catNameInputId}
                    type="text"
                    className={styles.formInput}
                    value={catName}
                    onChange={(e) => setCatName(e.target.value)}
                    placeholder="e.g. Appetizers, Main Course, Desserts"
                    required
                    maxLength={100}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor={catOrderInputId} className={styles.formLabel}>
                    Display Order
                  </label>
                  <input
                    id={catOrderInputId}
                    type="number"
                    className={styles.formInput}
                    value={catOrder}
                    onChange={(e) => setCatOrder(e.target.value)}
                    placeholder="10, 20, 30..."
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor={catDescInputId} className={styles.formLabel}>
                    Description (optional)
                  </label>
                  <textarea
                    id={catDescInputId}
                    className={styles.formTextarea}
                    value={catDesc}
                    onChange={(e) => setCatDesc(e.target.value)}
                    placeholder="Category details..."
                    rows={2}
                  />
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => setCategoryModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.primaryBtn}
                  disabled={actionLoading}
                >
                  {actionLoading ? "Saving..." : editingCategory ? "Update Category" : "Create Category"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalOpen && itemToDelete && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="delModalTitle">
          <div className={`${styles.modalContent} ${styles.modalContentNarrow}`}>
            <div className={styles.modalHeader}>
              <h2 id="delModalTitle" className={styles.modalTitle}>
                Confirm Removal
              </h2>
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => setDeleteModalOpen(false)}
                aria-label="Close modal"
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <p className={styles.confirmLead}>
                Are you sure you want to remove{" "}
                <strong>&quot;{itemToDelete.name}&quot;</strong>?
              </p>
              {itemToDelete.type === "product" ? (
                <p className={`${styles.confirmNote} ${styles.confirmNoteWarning}`}>
                  This dish will be safely archived and hidden from live customer ordering, preserving all historical
                  kitchen receipts and reports.
                </p>
              ) : (
                <p className={`${styles.confirmNote} ${styles.confirmNoteNeutral}`}>
                  Categories containing active dishes cannot be deleted. Any dishes must be reassigned or removed first.
                </p>
              )}
            </div>

            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setDeleteModalOpen(false)}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.actionBtnDelete}
                onClick={() => void handleExecuteDelete()}
                disabled={actionLoading}
              >
                {actionLoading ? "Removing..." : "Confirm Removal"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
