import Link from "next/link";
import { ArrowRightIcon } from "../ui/Icons";
import styles from "../../app/home.module.css";

export function AboutSection() {
  return (
    <section id="about" className={styles.about}>
      <div className={styles.aboutImage} />
      <div>
        <p className={styles.kicker}>Our story</p>
        <h2>A place where good food meets good days.</h2>
        <p>
          Every plate is prepared with generous flavor, familiar ingredients, and
          a little extra care.
        </p>
        <div className={styles.values}>
          <span>
            Fresh<small>ingredients</small>
          </span>
          <span>
            Made by<small>real cooks</small>
          </span>
          <span>
            Ready for<small>your table</small>
          </span>
        </div>
        <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap", marginTop: "24px" }}>
          <Link href="/menu" className={styles.outline}>
            Meet the menu
          </Link>
          <Link
            href="/about"
            style={{
              color: "var(--green)",
              fontWeight: "700",
              fontSize: "13px",
              textDecoration: "underline",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            Read our full story <ArrowRightIcon size={12} />
          </Link>
        </div>
      </div>
    </section>
  );
}
