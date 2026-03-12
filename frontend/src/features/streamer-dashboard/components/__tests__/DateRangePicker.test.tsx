import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateRangePicker } from "../DateRangePicker";

describe("DateRangePicker", () => {
  it("renders all ranges and marks the selected one", () => {
    render(<DateRangePicker selectedRange="30d" onRangeChange={jest.fn()} />);

    expect(screen.getByRole("group", { name: "select" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "recent30, current" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "recent7" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: "recent90" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("calls onRangeChange for each range button", async () => {
    const user = userEvent.setup();
    const onRangeChange = jest.fn();

    render(<DateRangePicker selectedRange="7d" onRangeChange={onRangeChange} />);

    await user.click(screen.getByRole("button", { name: "recent30" }));
    await user.click(screen.getByRole("button", { name: "recent90" }));

    expect(onRangeChange).toHaveBeenNthCalledWith(1, "30d");
    expect(onRangeChange).toHaveBeenNthCalledWith(2, "90d");
  });
});
