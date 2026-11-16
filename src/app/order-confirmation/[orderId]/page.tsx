import Link from "next/link";

import { CustomerRouteGuard } from "../../../components/auth/CustomerRouteGuard";
import { Footer } from "../../../components/layout/Footer";
import { Header } from "../../../components/layout/Header";
import { OrderConfirmation } from "../../../components/order/OrderConfirmation";
import { ArrowLeftIcon } from "../../../components/ui/Icons";
import styles from "../order-confirmation.module.css";

export default async function OrderConfirmationPage({
  params,
}: PageProps<"/order-confirmation/[orderId]">) {
  const { orderId } = await params;
  return (
    <CustomerRouteGuard>
      <div className={styles.page}>
        <Header />
        <main id="main-content" className={styles.content}>
          <Link href="/orders" className={styles.back}>
            <ArrowLeftIcon size={14} style={{ display: "inline", marginRight: "4px" }} />
            <span>Back to your order history</span>
          </Link>
          <OrderConfirmation orderId={orderId} />
        </main>
        <Footer />
      </div>
    </CustomerRouteGuard>
  );
}
