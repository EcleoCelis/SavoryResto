import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "../components/auth/AuthProvider";
import { CartProvider } from "../components/cart/CartProvider";
import { FulfillmentProvider } from "../components/fulfillment/FulfillmentProvider";
import { RestaurantSettingsProvider } from "../components/settings/RestaurantSettingsProvider";
import { ThemeProvider } from "../components/theme/ThemeProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SavoryBites — Freshly Prepared, Always Delicious",
  description: "Freshly prepared dining favorites, delivered warm to your table or packed fresh for takeout.",
};

const themeInitScript = `(() => {
  try {
    var pref = localStorage.getItem("savorybites_theme_preference") || "system";
    if (pref !== "light" && pref !== "dark" && pref !== "system") pref = "system";
    var resolved = pref === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : (pref === "dark" ? "dark" : "light");
    document.documentElement.dataset.theme = pref;
    document.documentElement.dataset.resolvedTheme = resolved;
  } catch (e) {}
})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <AuthProvider>
          <RestaurantSettingsProvider>
            <ThemeProvider>
              <CartProvider>
                <FulfillmentProvider>{children}</FulfillmentProvider>
              </CartProvider>
            </ThemeProvider>
          </RestaurantSettingsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
