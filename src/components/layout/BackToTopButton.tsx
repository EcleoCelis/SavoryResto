"use client";

import { useEffect, useState } from "react";
import styles from "../../app/home.module.css";

export function BackToTopButton() {
  const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const handleScroLL = () => {
           setIsVisible(window.scrollY > window.innerHeight);
        };

        handleScroLL(); 

        window.addEventListener("scroll", handleScroLL, { passive: true });
        return () => {
            window.removeEventListener("scroll", handleScroLL);
        };


    }, []);

    const scroLLToTop = () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    if (isVisible) {
        return (
            <button
                type="button"
                className={styles.backToTopButton}
                onClick={scroLLToTop}
                aria-label="Back to top"
                title="Back to top"
            >   
                ↑             
            </button>
        );
    }
}