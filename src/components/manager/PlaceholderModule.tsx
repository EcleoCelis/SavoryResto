import type { ReactNode } from "react";
import styles from "./placeholder.module.css";

interface PlaceholderModuleProps {
  title: string;
  subtitle: string;
  icon?: ReactNode;
}

export function PlaceholderModule({ title, subtitle, icon }: PlaceholderModuleProps) {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>
      </header>

      <div className={styles.card}>
        {icon && <div className={styles.iconWrapper} aria-hidden="true">{icon}</div>}
        <span className={styles.badge}>Module In Development</span>
        <h2 className={styles.cardTitle}>{title} Workspace</h2>
        <p className={styles.cardDescription}>
          This administrative section is reserved for future restaurant management integration.
          It will be available in an upcoming system release.
        </p>
      </div>
    </div>
  );
}
