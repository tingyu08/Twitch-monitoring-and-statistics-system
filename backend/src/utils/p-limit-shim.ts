type AsyncTask<T> = () => Promise<T>;

export function createRunNext(
  getActiveCount: () => number,
  maxConcurrency: number,
  queue: Array<() => void>
) {
  return () => {
    if (getActiveCount() >= maxConcurrency) {
      return;
    }

    const nextTask = queue.shift();
    if (!nextTask) {
      return;
    }

    nextTask();
  };
}

export default function pLimit(concurrency: number) {
  const maxConcurrency = Math.max(1, concurrency);
  let activeCount = 0;
  const queue: Array<() => void> = [];

  const runNext = createRunNext(() => activeCount, maxConcurrency, queue);

  return function limit<T>(task: AsyncTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const executeTask = () => {
        activeCount += 1;

        void task()
          .then(resolve, reject)
          .finally(() => {
            activeCount -= 1;
            runNext();
          });
      };

      if (activeCount < maxConcurrency) {
        executeTask();
        return;
      }

      queue.push(executeTask);
    });
  };
}

export const __pLimitTestables = {
  createRunNext,
};
