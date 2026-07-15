/**
 * 滚动触发动画观察器
 * 当元素滚动到视口时添加 is-visible 类
 */

const observerOptions: IntersectionObserverInit = {
  threshold: 0.1,
  rootMargin: "0px 0px -50px 0px",
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  });
}, observerOptions);

/**
 * 初始化滚动观察器
 */
export function initScrollObserver() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll(".scroll-reveal").forEach((el) => el.classList.add("is-visible"));
    return;
  }
  document.querySelectorAll(".scroll-reveal").forEach((el) => {
    observer.observe(el);
  });
}
