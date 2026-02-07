class Confetti {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.particles = [];
        this.animationFrame = null;

        this.canvas.style.position = 'fixed';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '9999';

        document.body.appendChild(this.canvas);

        window.addEventListener('resize', () => this.resize());
        this.resize();
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    createParticles() {
        const colors = ['#ff4081', '#00e5ff', '#ffab40', '#764ba2', '#fff'];
        for (let i = 0; i < 150; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height - this.canvas.height,
                size: Math.random() * 8 + 4,
                color: colors[Math.floor(Math.random() * colors.length)],
                speed: Math.random() * 3 + 2,
                angle: Math.random() * 360,
                spin: Math.random() * 10 - 5
            });
        }
    }

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        let finished = true;
        this.particles.forEach(p => {
            p.y += p.speed;
            p.angle += p.spin;

            if (p.y < this.canvas.height) finished = false;

            this.ctx.save();
            this.ctx.translate(p.x, p.y);
            this.ctx.rotate(p.angle * Math.PI / 180);
            this.ctx.fillStyle = p.color;
            this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            this.ctx.restore();
        });

        if (!finished) {
            this.animationFrame = requestAnimationFrame(() => this.draw());
        } else {
            this.particles = [];
        }
    }

    trigger() {
        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
        this.particles = [];
        this.createParticles();
        this.draw();
    }
}

window.confetti = new Confetti();
