import { queryClient } from "../queryClient";

describe("queryClient", () => {
  it("uses expected default query and mutation options", () => {
    const options = queryClient.getDefaultOptions();
    const queryOptions = options.queries;
    const mutationOptions = options.mutations;

    expect(queryOptions?.staleTime).toBe(30 * 1000);
    expect(queryOptions?.gcTime).toBe(5 * 60 * 1000);
    expect(queryOptions?.retry).toBe(1);
    expect(queryOptions?.refetchOnWindowFocus).toBe(false);
    expect(queryOptions?.refetchOnReconnect).toBe(true);
    expect(queryOptions?.refetchOnMount).toBe(false);
    expect(mutationOptions?.retry).toBe(1);
  });

  it("applies exponential retry delay with 30s cap", () => {
    const retryDelay = queryClient.getDefaultOptions().queries
      ?.retryDelay as ((attemptIndex: number) => number) | undefined;

    expect(retryDelay).toBeDefined();
    expect(retryDelay?.(0)).toBe(1000);
    expect(retryDelay?.(1)).toBe(2000);
    expect(retryDelay?.(4)).toBe(16000);
    expect(retryDelay?.(5)).toBe(30000);
    expect(retryDelay?.(8)).toBe(30000);
  });
});
