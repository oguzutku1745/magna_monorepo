import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger);

export const EASE = "expo.out";
export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let lenis: Lenis | null = null;

/** Smooth scroll for long brand pages. The GSAP ticker drives Lenis so ScrollTrigger and Lenis share one clock. */
export function useSmoothScroll() {
  useEffect(() => {
    if (reducedMotion()) return;
    const instance = new Lenis({ lerp: 0.09, wheelMultiplier: 1 });
    lenis = instance;
    instance.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => instance.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      instance.destroy();
      if (lenis === instance) lenis = null;
    };
  }, []);
}

export function scrollToTop() {
  if (lenis) lenis.scrollTo(0, { duration: 1.4 });
  else window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
}

export { gsap, ScrollTrigger };
