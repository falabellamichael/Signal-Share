/**
 * Signal Share GPU Optimization Utilities
 *
 * Purpose:
 * - Keep expensive AI/GPU-adjacent work off hot UI paths.
 * - Serialize heavy AI calls through a small async queue.
 * - Debounce/throttle repeated work from search, scroll, input, and image loading.
 * - Yield back to the browser between chunks so rendering remains responsive.
 * - Prevent accidental heavy calls from requestAnimationFrame/setInterval loops.
 *
 * Usage:
 *   window.SignalShareGpuOptimization.enqueueAiTask(async () => {
 *     return fetch('/api/local-llm/chat', { method: 'POST', body: JSON.stringify(payload) });
 *   });
 *
 *   const debouncedSearch = window.SignalShareGpuOptimization.debounce(runSearch, 250);
 *   const throttledScroll = window.SignalShareGpuOptimization.throttle(handleScroll, 150);
 */
(function initSignalShareGpuOptimization(global) {
  if (global.SignalShareGpuOptimization) return;

  const DEFAULT_AI_TASK_DELAY_MS = 24;
  const DEFAULT_AI_CONCURRENCY = 1;
  const DEFAULT_DEBOUNCE_MS = 250;
  const DEFAULT_THROTTLE_MS = 150;
  const DEFAULT_CHUNK_BUDGET_MS = 8;

  let activeUiLoopDepth = 0;

  function now() {
    return typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();
  }

  function sleep(ms = 0) {
    return new Promise((resolve) => global.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function yieldToMainThread(delayMs = 0) {
    return sleep(delayMs);
  }

  function scheduleIdle(callback, options = {}) {
    const timeout = Number(options.timeout || 1000);
    if (typeof global.requestIdleCallback === 'function') {
      return global.requestIdleCallback(callback, { timeout });
    }

    return global.setTimeout(() => {
      const startedAt = now();
      callback({
        didTimeout: false,
        timeRemaining: () => Math.max(0, 16 - (now() - startedAt))
      });
    }, 1);
  }

  function cancelIdle(handle) {
    if (typeof global.cancelIdleCallback === 'function') {
      global.cancelIdleCallback(handle);
      return;
    }
    global.clearTimeout(handle);
  }

  function debounce(fn, waitMs = DEFAULT_DEBOUNCE_MS, options = {}) {
    let timer = null;
    let lastArgs = null;
    let lastThis = null;
    let pendingResolvers = [];
    const leading = Boolean(options.leading);
    const trailing = options.trailing !== false;

    function flush() {
      const resolvers = pendingResolvers;
      pendingResolvers = [];
      timer = null;

      if (!trailing || !lastArgs) {
        resolvers.forEach(({ resolve }) => resolve(undefined));
        return;
      }

      Promise.resolve(fn.apply(lastThis, lastArgs))
        .then((value) => resolvers.forEach(({ resolve }) => resolve(value)))
        .catch((error) => resolvers.forEach(({ reject }) => reject(error)))
        .finally(() => {
          lastArgs = null;
          lastThis = null;
        });
    }

    return function debounced(...args) {
      lastArgs = args;
      lastThis = this;

      const shouldRunLeading = leading && !timer;
      if (timer) global.clearTimeout(timer);

      const promise = new Promise((resolve, reject) => {
        pendingResolvers.push({ resolve, reject });
      });

      if (shouldRunLeading) {
        Promise.resolve(fn.apply(lastThis, lastArgs))
          .then((value) => {
            const resolvers = pendingResolvers;
            pendingResolvers = [];
            resolvers.forEach(({ resolve }) => resolve(value));
          })
          .catch((error) => {
            const resolvers = pendingResolvers;
            pendingResolvers = [];
            resolvers.forEach(({ reject }) => reject(error));
          });
      }

      timer = global.setTimeout(flush, Math.max(0, Number(waitMs) || 0));
      return promise;
    };
  }

  function throttle(fn, waitMs = DEFAULT_THROTTLE_MS, options = {}) {
    let lastRunAt = 0;
    let timer = null;
    let lastArgs = null;
    let lastThis = null;
    const leading = options.leading !== false;
    const trailing = options.trailing !== false;

    function invoke() {
      lastRunAt = now();
      timer = null;
      const args = lastArgs;
      const ctx = lastThis;
      lastArgs = null;
      lastThis = null;
      return Promise.resolve(fn.apply(ctx, args));
    }

    return function throttled(...args) {
      lastArgs = args;
      lastThis = this;

      const elapsed = now() - lastRunAt;
      const remaining = Math.max(0, waitMs - elapsed);

      if (lastRunAt === 0 && !leading) {
        lastRunAt = now();
      }

      if (remaining === 0 || elapsed >= waitMs) {
        if (timer) {
          global.clearTimeout(timer);
          timer = null;
        }
        return invoke();
      }

      if (trailing && !timer) {
        timer = global.setTimeout(invoke, remaining);
      }

      return Promise.resolve(undefined);
    };
  }

  function createAsyncQueue(options = {}) {
    const concurrency = Math.max(1, Number(options.concurrency || DEFAULT_AI_CONCURRENCY));
    const taskDelayMs = Math.max(0, Number(options.taskDelayMs ?? DEFAULT_AI_TASK_DELAY_MS));
    const onError = typeof options.onError === 'function' ? options.onError : null;

    const queue = [];
    let running = 0;
    let paused = false;

    async function runNext() {
      if (paused || running >= concurrency || queue.length === 0) return;

      const item = queue.shift();
      running += 1;

      try {
        await yieldToMainThread(taskDelayMs);
        const value = await item.task({ signal: item.signal });
        item.resolve(value);
      } catch (error) {
        if (onError) {
          try { onError(error); } catch (_ignored) {}
        }
        item.reject(error);
      } finally {
        running -= 1;
        runNext();
      }
    }

    function enqueue(task, options = {}) {
      if (typeof task !== 'function') {
        return Promise.reject(new TypeError('Queue task must be a function.'));
      }

      const controller = options.controller || new AbortController();
      const priority = Number(options.priority || 0);

      const promise = new Promise((resolve, reject) => {
        const item = {
          task,
          resolve,
          reject,
          signal: controller.signal,
          priority,
          createdAt: now()
        };

        queue.push(item);
        queue.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
        runNext();
      });

      promise.cancel = () => controller.abort();
      return promise;
    }

    function clear(reason = 'Queue cleared.') {
      while (queue.length) {
        const item = queue.shift();
        item.reject(new Error(reason));
      }
    }

    return {
      enqueue,
      clear,
      pause: () => { paused = true; },
      resume: () => { paused = false; runNext(); },
      size: () => queue.length,
      running: () => running,
      isIdle: () => queue.length === 0 && running === 0
    };
  }

  const aiQueue = createAsyncQueue({ concurrency: DEFAULT_AI_CONCURRENCY });

  function assertNotInUiLoop(label = 'AI task') {
    if (activeUiLoopDepth > 0) {
      console.warn(`[GPU Optimization] ${label} was scheduled from a UI loop. Deferring to the async queue.`);
      return false;
    }
    return true;
  }

  function enqueueAiTask(task, options = {}) {
    assertNotInUiLoop(options.label || 'AI task');
    return aiQueue.enqueue(task, {
      priority: options.priority || 0,
      controller: options.controller
    });
  }

  async function runChunked(items, worker, options = {}) {
    const list = Array.from(items || []);
    const budgetMs = Math.max(1, Number(options.budgetMs || DEFAULT_CHUNK_BUDGET_MS));
    const delayMs = Math.max(0, Number(options.delayMs || 0));
    const results = [];

    let chunkStartedAt = now();

    for (let index = 0; index < list.length; index += 1) {
      results.push(await worker(list[index], index, list));

      if (now() - chunkStartedAt >= budgetMs) {
        await yieldToMainThread(delayMs);
        chunkStartedAt = now();
      }
    }

    return results;
  }

  async function safeAiFetch(url, payload, options = {}) {
    const controller = options.controller || new AbortController();
    const timeoutMs = Number(options.timeoutMs || 60000);
    let timeout = null;

    const task = async () => {
      timeout = global.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          method: options.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
          },
          body: typeof payload === 'string' ? payload : JSON.stringify(payload || {}),
          signal: controller.signal
        });
        return response;
      } finally {
        if (timeout) global.clearTimeout(timeout);
      }
    };

    return enqueueAiTask(task, {
      priority: options.priority || 0,
      controller,
      label: options.label || 'safeAiFetch'
    });
  }

  function deferNonUrgent(task, options = {}) {
    return new Promise((resolve, reject) => {
      scheduleIdle(async () => {
        try {
          resolve(await task());
        } catch (error) {
          reject(error);
        }
      }, { timeout: options.timeout || 1000 });
    });
  }

  function wrapUiLoop(fn) {
    return function wrappedUiLoop(...args) {
      activeUiLoopDepth += 1;
      try {
        return fn.apply(this, args);
      } finally {
        activeUiLoopDepth = Math.max(0, activeUiLoopDepth - 1);
      }
    };
  }

  function scheduleBackgroundTask(task, delayMs = 0) {
    return new Promise((resolve, reject) => {
      global.setTimeout(async () => {
        try {
          resolve(await task());
        } catch (error) {
          reject(error);
        }
      }, Math.max(0, Number(delayMs) || 0));
    });
  }

  const api = Object.freeze({
    createAsyncQueue,
    enqueueAiTask,
    safeAiFetch,
    debounce,
    throttle,
    runChunked,
    deferNonUrgent,
    scheduleBackgroundTask,
    scheduleIdle,
    cancelIdle,
    sleep,
    yieldToMainThread,
    wrapUiLoop,
    assertNotInUiLoop,
    aiQueue
  });

  global.SignalShareGpuOptimization = api;
})(window);
