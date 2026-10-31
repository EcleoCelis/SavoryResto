import { AboutSection } from "../components/home/AboutSection";
import { BestSellers } from "../components/home/BestSellers";
import { Hero } from "../components/home/Hero";
import { PopularCategories } from "../components/home/PopularCategories";
import { SpecialOffer } from "../components/home/SpecialOffer";
import { Footer } from "../components/layout/Footer";
import { Header } from "../components/layout/Header";
import { BackToTopButton } from "../components/layout/BackToTopButton";
import styles from "./home.module.css";

export default function Home() {
  return (
    <div className={styles.site}>
      <Header />
      <main id="main-content">
        <Hero />
        <PopularCategories />
        <BestSellers />
        <BackToTopButton />
        <SpecialOffer />
        <AboutSection />
      </main>
      <Footer />
    </div>
  );
}
