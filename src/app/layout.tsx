import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "../components/auth/AuthProvider";
import { CartProvider } from "../components/cart/CartProvider";
import { FulfillmentProvider } from "../components/fulfillment/FulfillmentProvider";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><AuthProvider><CartProvider><FulfillmentProvider>{children}</FulfillmentProvider></CartProvider></AuthProvider></body>
    </html>
  );
}
