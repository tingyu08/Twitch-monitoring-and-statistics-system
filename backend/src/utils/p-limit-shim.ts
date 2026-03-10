type AsyncTask<T> = () => Promise<T>;

export default function pLimit(concurrency: number) {
  const maxConcurrency = Math.max(1, concurrency);
  let activeCount = 0;
  const queue: Array<() => void> = [];

  const runNext = () => {
    if (activeCount >= maxConcurrency) {
      return;
    }

    const nextTask = queue.shift();
    if (!nextTask) {
      return;
    }

    nextTask();
  };

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
