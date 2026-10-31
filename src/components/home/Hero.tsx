"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import styles from "../../app/home.module.css";
import { ArrowRightIcon } from "../ui/Icons";

const HERO_BACKGROUNDS = [
  {
    src: "/images/savory-hero.png",
    alt: "Signature double burger with french fries",
  },
  {
    src: "/images/pizza.jpg",
    alt: "Fire-baked artisan pizza with melted cheese and fresh herbs",
  },
  {
    src: "/images/delicious-crispy-chicken-nuggets-with-garlic-dip-wooden-table.jpg",
    alt: "Crispy golden fried chicken served with artisanal garlic dip",
  },
  {
    src: "/images/appetizing-pasta-with-tomato-sauce-parmesan-plate-closeup.jpg",
    alt: "Artisan pasta with slow-simmered tomato sugo and shaved parmesan",
  },
];

const THIRD_PHRASES = [
  "together.",
  "closer.",
  "pure joy.",
  "smiles.",
];

function subscribeReducedMotion(callback: () => void) {
  const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

function getReducedMotionSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getReducedMotionServerSnapshot() {
  return false;
}

export function Hero() {
  const [currentBgIndex, setCurrentBgIndex] = useState(0);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [displayText, setDisplayText] = useState(THIRD_PHRASES[0]);
  const [isDeleting, setIsDeleting] = useState(false);
  const prefersReducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot
  );

  // Automatic background image transitions (every 6 seconds)
  useEffect(() => {
    if (prefersReducedMotion) return;

    const bgTimer = setInterval(() => {
      setCurrentBgIndex((prev) => (prev + 1) % HERO_BACKGROUNDS.length);
    }, 6000);

    return () => clearInterval(bgTimer);
  }, [prefersReducedMotion]);

  // Typing simulation for the 3rd phrase of the hero headline ("together.", "closer.", etc.)
  useEffect(() => {
    if (prefersReducedMotion) return;

    const currentPhrase = THIRD_PHRASES[phraseIndex];

    if (!isDeleting && displayText === currentPhrase) {
      const pauseTimer = setTimeout(() => {
        setIsDeleting(true);
      }, 2000);
      return () => clearTimeout(pauseTimer);
    }

    if (isDeleting && displayText === "") {
      const pauseTimer = setTimeout(() => {
        setIsDeleting(false);
        setPhraseIndex((prev) => (prev + 1) % THIRD_PHRASES.length);
      }, 450);
      return () => clearTimeout(pauseTimer);
    }

    const typingSpeed = isDeleting ? 45 : 85;
    const charTimer = setTimeout(() => {
      setDisplayText((current) => {
        if (isDeleting) {
          return currentPhrase.slice(0, current.length - 1);
        } else {
          return currentPhrase.slice(0, current.length + 1);
        }
      });
    }, typingSpeed);

    return () => clearTimeout(charTimer);
  }, [displayText, isDeleting, phraseIndex, prefersReducedMotion]);

  return (
    <section className={styles.hero} aria-label="Welcome to SavoryBites">
      {/* Background Image Carousel Layers */}
      <div className={styles.heroBackgroundLayers} aria-hidden="true">
        {HERO_BACKGROUNDS.map((bg, idx) => (
          <div
            key={bg.src}
            className={`${styles.heroBgSlide} ${idx === currentBgIndex ? styles.heroBgSlideActive : ""}`}
          >
            <Image
              src={bg.src}
              alt=""
              fill
              priority={idx === 0}
              quality={85}
              sizes="100vw"
              className={styles.heroBgImage}
            />
          </div>
        ))}
        <div className={styles.heroGradientOverlay} />
      </div>

      <div className={styles.heroContent}>
        <p className={styles.kicker}>Freshly prepared, always</p>

        <h1 id="hero-heading" className={styles.heroHeading}>
          <span className="sr-only">
            SavoryBites — Good food brings people together.
          </span>
          <span aria-hidden="true">
            Good food<br />
            brings people<br />
            <em className={styles.dynamicPhrase}>
              {displayText}
              {!prefersReducedMotion}
               {/* && (
                <span className={styles.typingCursor} aria-hidden="true" />
              ) */}
            </em>
          </span>
        </h1>

        <p>
          Comforting favorites, prepared fresh daily from authentic recipes.
          Enjoy table service in our dining room or swift counter pickup.
        </p>

        <aside>
          <Link href="/start-order" className={styles.order}>
            <span>Order now</span>
            <ArrowRightIcon size={14} style={{ marginLeft: "4px" }} />
          </Link>
          <Link href="/menu" className={styles.outline}>
            Explore menu
          </Link>
        </aside>

        <ul>
          <li>
            <b>4.9/5</b>
            <small>Customer rating</small>
          </li>
          <li>
            <b>10k+</b>
            <small>Orders served</small>
          </li>
          <li>
            <b>Fresh</b>
            <small>Made daily</small>
          </li>
        </ul>
      </div>

      <div className={styles.heroImage} aria-hidden="true" />
    </section>
  );
}
