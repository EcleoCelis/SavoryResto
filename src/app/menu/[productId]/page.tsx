import Link from "next/link";

import { Footer } from "../../../components/layout/Footer";
import { Header } from "../../../components/layout/Header";
import { ProductDetail } from "../../../components/menu/ProductDetail";
import { ArrowLeftIcon } from "../../../components/ui/Icons";
import styles from "../menu.module.css";

export default async function ProductPage({ params }: PageProps<"/menu/[productId]">) {
  const { productId } = await params;
  return (
    <div className={styles.page}>
      <Header />
      <main id="main-content" className={styles.menu}>
        <Link href="/menu" className={styles.backLink}>
          <ArrowLeftIcon size={14} style={{ display: "inline", marginRight: "4px" }} />
          <span>Back to menu</span>
        </Link>
        <ProductDetail productId={productId} />
      </main>
      <Footer />
    </div>
  );
}
