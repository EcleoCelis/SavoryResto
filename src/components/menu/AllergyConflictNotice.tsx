"use client";

import styles from "../../app/menu/menu.module.css";
import type { DishConflictResult } from "../../lib/personalization";
import { AlertTriangleIcon } from "../ui/Icons";

interface Props {
  conflicts: DishConflictResult;
  compact?: boolean;
}

export function AllergyConflictNotice({ conflicts, compact = false }: Props) {
  const { matchedAllergens, matchedDisliked } = conflicts;
  if (matchedAllergens.length === 0 && matchedDisliked.length === 0) {
    return null;
  }

  const parts: string[] = [];
  if (matchedAllergens.length > 0) {
    parts.push(`May contain or match saved allergen(s): ${matchedAllergens.join(", ")}`);
  }
  if (matchedDisliked.length > 0) {
    parts.push(`Contains avoided ingredient(s): ${matchedDisliked.join(", ")}`);
  }

  if (compact) {
    return (
      <span className={styles.conflictPill} title={parts.join(" · ")}>
        <AlertTriangleIcon size={12} />
        <span>
          {matchedAllergens.length > 0
            ? `Check allergen: ${matchedAllergens[0]}`
            : `Check ingredient: ${matchedDisliked[0]}`}
        </span>
      </span>
    );
  }

  return (
    <div className={styles.conflictBanner} role="note">
      <AlertTriangleIcon size={18} className={styles.conflictBannerIcon} />
      <div>
        <strong>Ingredient &amp; Allergen Notice</strong>
        <p>{parts.join(". ")}.</p>
        <p className={styles.conflictDisclaimer}>
          Dishes are prepared in a shared kitchen where cross-contact may occur. If you have a severe food allergy, please verify ingredients with SavoryBites staff before ordering.
        </p>
      </div>
    </div>
  );
}
