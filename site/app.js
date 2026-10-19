// Threenglish 介绍页
// 首屏入场、区块出场、滚动叙事。GSAP / ScrollTrigger 从 CDN 引入；
// 不接管滚轮：滚动交给浏览器原生处理，滚一下走一下。

document.documentElement.classList.remove("no-js");

const REPO_URL = "https://github.com/weilantianhai/threenglish";
const APK_URL = `${REPO_URL}/releases/latest/download/Threenglish-1.1.05.apk`;

const apkLink = document.getElementById("apk-link");
const repoLink = document.getElementById("repo-link");
if (apkLink) apkLink.href = APK_URL;
if (repoLink) repoLink.href = REPO_URL;

const nav = document.getElementById("nav");
const onScroll = () => nav && nav.classList.toggle("is-scrolled", window.scrollY > 8);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// ---------- 首屏难度胶囊：切换词库 ----------
const levelPill = document.getElementById("level-pill");
const levelMenu = document.getElementById("level-menu");
const levelLabel = document.getElementById("level-label");
const levelBackdrop = document.getElementById("level-backdrop");
const levelToast = document.getElementById("level-toast");

if (levelPill && levelMenu && levelLabel) {
  const levelOptions = Array.from(levelMenu.querySelectorAll(".a-level-option"));
  let toastTimer = 0;

  const closeLevelMenu = (focusPill = false) => {
    levelMenu.hidden = true;
    if (levelBackdrop) levelBackdrop.hidden = true;
    levelPill.setAttribute("aria-expanded", "false");
    if (focusPill) levelPill.focus();
  };

  const openLevelMenu = () => {
    levelMenu.hidden = false;
    if (levelBackdrop) levelBackdrop.hidden = false;
    levelPill.setAttribute("aria-expanded", "true");
    const active = levelOptions.find((option) => option.classList.contains("is-active"));
    if (active) active.focus();
  };

  const showLevelToast = (message) => {
    if (!levelToast) return;
    levelToast.textContent = message;
    levelToast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      levelToast.hidden = true;
    }, 2600);
  };

  levelPill.addEventListener("click", () => {
    if (levelMenu.hidden) openLevelMenu();
    else closeLevelMenu(true);
  });

  if (levelBackdrop) {
    levelBackdrop.addEventListener("click", () => closeLevelMenu());
  }

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".a-level-wrap")) closeLevelMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !levelMenu.hidden) closeLevelMenu(true);
  });

  levelOptions.forEach((option) => {
    option.addEventListener("click", () => {
      const level = option.dataset.level || "日常";
      levelLabel.textContent = level;
      levelOptions.forEach((item) => {
        const active = item === option;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
      closeLevelMenu(true);
      showLevelToast(
        level === "日常"
          ? "已切换回日常：不查词库，只求自然。"
          : `已切换到 ${level} 词库：改写前会先查这本词库。`,
      );
    });
  });
}

const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const params = new URLSearchParams(window.location.search);
const staticMode = params.has("static") || params.get("state") === "static";
const hasGsap =
  typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";

const journeySteps = Array.from(document.querySelectorAll("[data-journey-step]"));
const journeyDots = Array.from(document.querySelectorAll(".journey-dots span"));

function setJourneyStep(index) {
  journeySteps.forEach((step, i) => step.classList.toggle("is-on", i === index));
  journeyDots.forEach((dot, i) => dot.classList.toggle("is-on", i === index));
}

if (!hasGsap || prefersReduced || staticMode) {
  if (!hasGsap || staticMode) document.documentElement.classList.add("no-motion");
  journeySteps.forEach((step) => step.classList.add("is-on"));
  journeyDots.forEach((dot) => dot.classList.add("is-on"));
} else {
  gsap.registerPlugin(ScrollTrigger);

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const id = link.getAttribute("href");
      if (!id || id === "#") return;
      const target = document.querySelector(id);
      if (!target) return;
      event.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - 72;
      window.scrollTo({ top, behavior: prefersReduced ? "auto" : "smooth" });
    });
  });

  // ---------- 首屏：本来就在第一屏，加载即入场 ----------
  const hero = gsap.timeline({ defaults: { ease: "power3.out" } });
  hero
    .from(".hero-copy > *", { opacity: 0, y: 20, duration: 0.7, stagger: 0.09 })
    .from(".hero-visual .phone", { opacity: 0, y: 32, scale: 0.975, duration: 0.85 }, 0.12)
    .from(".hero-visual .a-card > *", { opacity: 0, y: 8, duration: 0.4, stagger: 0.05 }, 0.42);

  gsap.from(".hero-hint", {
    opacity: 0,
    y: 8,
    duration: 0.4,
    ease: "power3.out",
    scrollTrigger: { trigger: ".hero-hint", start: "top 100%", once: true },
  });

  // ---------- 区块出场：元素进入屏幕才播，滚回去离开后再进来会重播 ----------
  const reveal = (el, vars = {}) =>
    gsap.from(el, {
      opacity: 0,
      y: 30,
      duration: 0.8,
      ease: "power3.out",
      ...vars,
      scrollTrigger: {
        trigger: el,
        start: "top 80%",
        toggleActions: "play none none reverse",
        invalidateOnRefresh: true,
      },
    });

  document.querySelectorAll("[data-reveal]").forEach((el) => {
    // 画像卡：先让卡片进入，再让里面的条从左侧长出来
    if (el.classList.contains("profile-board")) {
      const bars = el.querySelectorAll(".pb-meter-track i, .pb-scale span");
      gsap.set(bars, { transformOrigin: "left center", scaleX: 0 });
      const boardTl = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
      boardTl
        .from(el, { opacity: 0, y: 30, duration: 0.8 })
        .to(bars, { scaleX: 1, duration: 0.9, stagger: 0.045 }, 0.25);
      ScrollTrigger.create({
        trigger: el,
        start: "top 80%",
        onEnter: () => boardTl.play(),
        onLeaveBack: () => boardTl.reverse(),
      });
    } else {
      reveal(el);
    }
  });

  document
    .querySelectorAll(
      ".section-head, .split-copy h2, .split-copy .lede, .dict-counts, .profile-facts, .split-copy .aside, .live-shots",
    )
    .forEach((el, index) => {
      if (el.closest("[data-reveal]")) return;
      reveal(el, { y: 20, duration: 0.7, delay: Math.min(index * 0.03, 0.12) });
    });

  // ---------- 滚动叙事：一句怎么改出来 ----------
  const journey = document.querySelector(".journey");
  if (journey) {
    gsap.set("[data-strike]", { "--strike": 0 });
    gsap.set("[data-rw='result'], [data-rw='anchors'], [data-rw='analysis']", {
      opacity: 0,
      y: 16,
    });
    gsap.set(".rw-skeleton", { display: "flex", autoAlpha: 1 });
    gsap.set("[data-rw-pending]", { display: "flex", autoAlpha: 1 });
    setJourneyStep(0);

    const journeyTl = gsap.timeline({
      defaults: { ease: "none" },
      scrollTrigger: {
        trigger: journey,
        start: "top top",
        end: "bottom bottom",
        scrub: true,
        onUpdate: (self) => {
          const p = self.progress;
          setJourneyStep(p < 0.33 ? 0 : p < 0.66 ? 1 : 2);
        },
      },
    });

    journeyTl
      .to("[data-strike]", { "--strike": 1, duration: 0.1, stagger: 0.04 }, 0.02)
      .to(".rw-scroll-hint", { opacity: 0, duration: 0.06 }, 0.02)
      .to(".rw-skeleton", { autoAlpha: 0, duration: 0.06 }, 0.14)
      .to(".rw-original", { color: "#64748b", duration: 0.18, ease: "power1.out" }, 0.3)
      .to("[data-rw='result']", { opacity: 1, y: 0, duration: 0.16, ease: "power2.out" }, 0.2)
      .to("[data-rw-pending]", { autoAlpha: 1, duration: 0.03 }, 0.2)
      .to("[data-rw='anchors']", { opacity: 1, y: 0, duration: 0.14, ease: "power2.out" }, 0.36)
      .to("[data-rw-pending]", { autoAlpha: 0, duration: 0.05 }, 0.62)
      .to("[data-rw='analysis']", { opacity: 1, y: 0, duration: 0.14, ease: "power2.out" }, 0.66)
      .to({}, { duration: 0.14 }, 0.86);
  }

  window.addEventListener("load", () => ScrollTrigger.refresh());
}
