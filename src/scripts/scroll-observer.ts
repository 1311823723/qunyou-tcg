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
  document.querySelectorAll(".scroll-reveal").forEach((el) => {
    observer.observe(el);
  });
}

// 页面加载时自动初始化
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initScrollObserver);
  } else {
    initScrollObserver();
  }
}
