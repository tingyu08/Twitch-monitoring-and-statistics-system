import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LocaleSwitcher from "../LocaleSwitcher";

const mockPush = jest.fn();
let mockPathname = "/zh-TW/dashboard/viewer";
let mockParams: { locale?: string } = { locale: "zh-TW" };

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => mockPathname,
  useParams: () => mockParams,
}));

describe("LocaleSwitcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = "/zh-TW/dashboard/viewer";
    mockParams = { locale: "zh-TW" };
  });

  it("renders locale options and uses the current locale from params", () => {
    render(<LocaleSwitcher />);

    expect(screen.getByRole("combobox", { name: "切換語言" })).toHaveValue("zh-TW");
    expect(screen.getByRole("option", { name: "繁體中文" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "English" })).toBeInTheDocument();
  });

  it("replaces the locale segment when the path already contains one", async () => {
    const user = userEvent.setup();
    render(<LocaleSwitcher />);

    await user.selectOptions(screen.getByRole("combobox", { name: "切換語言" }), "en");

    expect(mockPush).toHaveBeenCalledWith("/en/dashboard/viewer");
  });

  it("adds a locale prefix when the path has no locale segment", async () => {
    const user = userEvent.setup();
    mockPathname = "/dashboard/viewer";
    mockParams = {};

    render(<LocaleSwitcher />);

    expect(screen.getByRole("combobox", { name: "切換語言" })).toHaveValue("zh-TW");

    await user.selectOptions(screen.getByRole("combobox", { name: "切換語言" }), "en");

    expect(mockPush).toHaveBeenCalledWith("/en/dashboard/viewer");
  });
});
