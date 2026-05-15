/**
 * Memory Monitoring System
 * Tracks and reports memory usage
 */
class MemoryMonitor {
  constructor() {
    this.usageHistory = [];
    this.threshold = 500; // MB
  }

  trackUsage(usage) {
    this.usageHistory.push(usage);
    if (this.usageHistory.length > 100) {
      this.usageHistory.shift();
    }

    if (usage > this.threshold) {
      console.warn(`Memory usage exceeded threshold: ${usage}MB`);
    }
  }

  getAverageUsage() {
    return this.usageHistory.reduce((sum, usage) => sum + usage, 0) / this.usageHistory.length;
  }
}

export default new MemoryMonitor();