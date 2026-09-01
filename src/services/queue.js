/**
 * Message Queue Service
 * Processes outbound WhatsApp messages sequentially with random jitter delay
 * to protect Chromium memory and mimic natural human sending patterns.
 */

class MessageQueue {
  constructor({ minDelay = 600, maxDelay = 1500 } = {}) {
    this.queue = [];
    this.isProcessing = false;
    this.minDelay = minDelay;
    this.maxDelay = maxDelay;
  }

  enqueue(taskFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        taskFn,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      });

      this._processNext();
    });
  }

  async _processNext() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const item = this.queue.shift();

    try {
      const result = await item.taskFn();
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    } finally {
      // Calculate randomized jitter delay before taking the next item
      const delay = Math.floor(
        Math.random() * (this.maxDelay - this.minDelay + 1) + this.minDelay
      );

      setTimeout(() => {
        this.isProcessing = false;
        this._processNext();
      }, delay);
    }
  }

  get length() {
    return this.queue.length;
  }

  clear() {
    const dropped = this.queue.splice(0, this.queue.length);
    dropped.forEach((item) =>
      item.reject(new Error("Queue cleared by system reset or shutdown"))
    );
  }
}

const messageQueue = new MessageQueue();

module.exports = { MessageQueue, messageQueue };
