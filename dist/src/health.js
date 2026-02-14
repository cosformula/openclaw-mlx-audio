/** Health check for mlx_audio.server. */
import http from "node:http";
export class HealthChecker {
    port;
    intervalMs;
    logger;
    onUnhealthy;
    timer = null;
    consecutive_failures = 0;
    constructor(port, intervalMs, logger, onUnhealthy) {
        this.port = port;
        this.intervalMs = intervalMs;
        this.logger = logger;
        this.onUnhealthy = onUnhealthy;
    }
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => this.check(), this.intervalMs);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.consecutive_failures = 0;
    }
    async check() {
        try {
            const ok = await this.ping();
            if (ok) {
                if (this.consecutive_failures > 0) {
                    this.logger.info("[mlx-audio] Health check recovered");
                }
                this.consecutive_failures = 0;
                return true;
            }
        }
        catch {
            // fall through
        }
        this.consecutive_failures++;
        if (this.consecutive_failures >= 3) {
            this.logger.warn(`[mlx-audio] Health check failed ${this.consecutive_failures} times`);
            this.onUnhealthy();
            this.consecutive_failures = 0;
        }
        return false;
    }
    ping() {
        return new Promise((resolve) => {
            const req = http.get(`http://127.0.0.1:${this.port}/v1/models`, { timeout: 5000 }, (res) => {
                // Consume response
                res.resume();
                resolve(res.statusCode === 200);
            });
            req.on("error", () => resolve(false));
            req.on("timeout", () => {
                req.destroy();
                resolve(false);
            });
        });
    }
}
