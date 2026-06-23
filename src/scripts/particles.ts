/**
 * 粒子效果系统
 * 为首页和对战页面添加飘浮粒子效果
 */

interface ParticleConfig {
  count?: number;
  color?: string;
  speed?: number;
  size?: number;
  opacity?: number;
}

class Particle {
  x: number;
  y: number;
  size: number;
  speedX: number;
  speedY: number;
  opacity: number;
  color: string;
  canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, config: ParticleConfig = {}) {
    this.canvas = canvas;
    this.x = Math.random() * canvas.width;
    this.y = Math.random() * canvas.height;
    this.size = Math.random() * (config.size || 2) + 0.5;
    this.speedX = (Math.random() - 0.5) * (config.speed || 0.5);
    this.speedY = (Math.random() - 0.5) * (config.speed || 0.5);
    this.opacity = Math.random() * (config.opacity || 0.5) + 0.1;
    this.color = config.color || "0, 212, 255";
  }

  update() {
    this.x += this.speedX;
    this.y += this.speedY;

    // 边界检测
    if (this.x < 0 || this.x > this.canvas.width) {
      this.speedX *= -1;
    }
    if (this.y < 0 || this.y > this.canvas.height) {
      this.speedY *= -1;
    }

    // 确保粒子在画布内
    this.x = Math.max(0, Math.min(this.canvas.width, this.x));
    this.y = Math.max(0, Math.min(this.canvas.height, this.y));
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${this.color}, ${this.opacity})`;
    ctx.fill();
  }
}

class ParticleSystem {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private animationId: number | null = null;
  private config: ParticleConfig;

  constructor(container: HTMLElement, config: ParticleConfig = {}) {
    this.config = config;
    this.canvas = document.createElement("canvas");
    this.canvas.style.position = "absolute";
    this.canvas.style.top = "0";
    this.canvas.style.left = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.pointerEvents = "none";
    this.canvas.style.zIndex = "0";

    container.style.position = "relative";
    container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext("2d")!;
    this.resize();
    this.init();
    this.animate();

    // 监听窗口大小变化
    window.addEventListener("resize", () => this.resize());
  }

  private resize() {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    if (rect) {
      this.canvas.width = rect.width;
      this.canvas.height = rect.height;
    }
  }

  private init() {
    const count = this.config.count || Math.floor(window.innerWidth / 20);
    for (let i = 0; i < count; i++) {
      this.particles.push(new Particle(this.canvas, this.config));
    }
  }

  private animate() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 绘制连接线
    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < this.particles.length; j++) {
        const dx = this.particles[i].x - this.particles[j].x;
        const dy = this.particles[i].y - this.particles[j].y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 100) {
          const opacity = (1 - distance / 100) * 0.2;
          this.ctx.beginPath();
          this.ctx.strokeStyle = `rgba(${this.config.color || "0, 212, 255"}, ${opacity})`;
          this.ctx.lineWidth = 0.5;
          this.ctx.moveTo(this.particles[i].x, this.particles[i].y);
          this.ctx.lineTo(this.particles[j].x, this.particles[j].y);
          this.ctx.stroke();
        }
      }
    }

    // 更新和绘制粒子
    this.particles.forEach((p) => {
      p.update();
      p.draw(this.ctx);
    });

    this.animationId = requestAnimationFrame(() => this.animate());
  }

  destroy() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    this.canvas.remove();
  }
}

/**
 * 初始化粒子系统
 */
export function initParticles(containerId: string, config?: ParticleConfig) {
  const container = document.getElementById(containerId);
  if (container) {
    return new ParticleSystem(container, config);
  }
  return null;
}

// 页面加载时自动初始化
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initParticles("hero-particles", {
        count: 50,
        color: "0, 212, 255",
        speed: 0.3,
        size: 1.5,
        opacity: 0.3,
      });
    });
  } else {
    initParticles("hero-particles", {
      count: 50,
      color: "0, 212, 255",
      speed: 0.3,
      size: 1.5,
      opacity: 0.3,
    });
  }
}
