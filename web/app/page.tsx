import type { Metadata } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import LandingPage from "@/components/landing/LandingPage";
import "./landing.css";
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-play",
  display: "swap",
});
export const metadata: Metadata = {
  title: "A Sky Full of Stories | Annual Function 2026",
  description:
    "Little stars. Big dreams. Join our school family for an evening of stories, music, and moments to remember. Discover the programme, meet our guests, and find your invitation.",
};
export default function Home() {
  return (
    <div className={display.variable}>
      <LandingPage />
    </div>
  );
}
