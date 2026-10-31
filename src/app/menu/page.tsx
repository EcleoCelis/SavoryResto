import Link from "next/link";
import { Suspense } from "react";

import { Footer } from "../../components/layout/Footer";
import { Header } from "../../components/layout/Header";
import { MenuCatalog } from "../../components/menu/MenuCatalog";
import { ArrowLeftIcon } from "../../components/ui/Icons";
import styles from "./menu.module.css";

export default function MenuPage() {
  return (
    <div className={styles.page}>
      <Header />
      <main id="main-content" className={styles.menu}>
        <Link href="/" className={styles.backLink}>
          <ArrowLeftIcon size={14} style={{ display: "inline", marginRight: "4px" }} />
          <span>Back to home</span>
        </Link>
        <header className={styles.menuIntroHeader}>
          <p>Crafted with care</p>
          <h1>Our Restaurant Menu</h1>
          <span className={styles.menuIntroText}>
            Explore our delicious selection of freshly prepared dishes, crafted for dine-in table service and swift counter pickup.
          </span>
        </header>
        <Suspense fallback={<p className={styles.catalogMessage} aria-live="polite">Loading the menu catalog...</p>}>
          <MenuCatalog />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
