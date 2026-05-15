/**
 * AI Model Manager
 * Manages AI model loading and unloading
 */
class AIModelManager {
  constructor() {
    this.models = new Map();
    this.loadedModels = new Set();
  }

  loadModel(modelType) {
    if (this.models.has(modelType)) {
      return this.models.get(modelType);
    }

    const model = new LiteModel(); // Use lightweight model
    this.models.set(modelType, model);
    this.loadedModels.add(modelType);
    return model;
  }

  unloadModel(modelType) {
    if (this.loadedModels.has(modelType)) {
      this.loadedModels.delete(modelType);
      // Add logic to release model resources
    }
  }
}

export default new AIModelManager();