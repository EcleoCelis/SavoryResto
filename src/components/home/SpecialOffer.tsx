import Link from "next/link";
import styles from "../../app/home.module.css";

export function SpecialOffer() {
  return (
    <section id="offers" className={styles.offer}>
      <div>
        <p className={styles.kicker}>Chef&apos;s Welcome</p>
        <h2>Experience Fresh Flavor Today</h2>
        <p>Explore our handcrafted specialties, prepared fresh daily for table service and counter pickup.</p>
      </div>
      <Link href="/start-order" className={styles.order}>
        Order now
      </Link>
    </section>
  );
}
