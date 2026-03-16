import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DisplayPreferences } from "../DisplayPreferences";

const mockTogglePreference = jest.fn();

jest.mock("../../hooks/useUiPreferences", () => ({
  PREFERENCE_ITEMS: [
    { key: "showSummaryCards", icon: "A" },
    { key: "showTimeSeriesChart", icon: "B" },
    { key: "showHeatmapChart", icon: "C" },
    { key: "showSubscriptionChart", icon: "D" },
  ],
  useUiPreferences: () => ({
    preferences: {
      showSummaryCards: true,
      showTimeSeriesChart: false,
      showHeatmapChart: true,
      showSubscriptionChart: false,
    },
    togglePreference: mockTogglePreference,
  }),
}));

describe("DisplayPreferences internal preferences", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("falls back to useUiPreferences when controlled props are omitted", async () => {
    const user = userEvent.setup();

    render(<DisplayPreferences compact />);

    await user.click(screen.getByTestId("display-preferences-button"));
    await user.click(screen.getByLabelText("summaryCards"));

    expect(mockTogglePreference).toHaveBeenCalledWith("showSummaryCards");
    expect(screen.getByText("(2/4)")).toBeInTheDocument();
  });
});
