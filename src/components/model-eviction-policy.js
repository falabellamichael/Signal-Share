/**
 * Model Eviction Policy
 * Implements automatic model eviction when memory is low
 */
class ModelEvictionPolicy {
  constructor() {
    this.memoryOptimizer = new VRAMOptimizer();
    this.memoryMonitor = new MemoryMonitor();
  }

  checkAndEvict() {
    if (this.memoryMonitor.getAverageUsage() > 700) {
      console.warn("Memory usage is high - evicting models...");
      this.memoryOptimizer.optimize();

      // Additional eviction logic can be added here
    }
  }
}

export default new ModelEvictionPolicy();