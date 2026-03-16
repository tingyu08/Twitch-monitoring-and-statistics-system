import { DashboardHeader } from "../DashboardHeader";
import { Providers } from "../Providers";
import { DashboardHeader as DashboardHeaderFromIndex, Providers as ProvidersFromIndex } from "../index";

describe("components index barrel", () => {
  it("re-exports shared components", () => {
    expect(DashboardHeaderFromIndex).toBe(DashboardHeader);
    expect(ProvidersFromIndex).toBe(Providers);
  });
});
