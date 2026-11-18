import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ choose: vi.fn() }));
vi.mock("@/lib/native", () => ({ isNative: () => true, chooseNativeProfilePhoto: mock.choose, onProfilePhotoRestored: async () => () => {}, haptic: vi.fn() }));
vi.mock("@/lib/team-auth", () => ({ useTeamAuth: () => ({ staff: { id: "qa", photo: null }, refresh: vi.fn() }) }));
vi.mock("@/lib/l10n", () => ({ useLang: () => ({ lang: "hi", t: (key: string) => key }) }));
vi.mock("@/lib/photo", () => ({ photoUrl: async () => null, fileToDataUrl: async () => "data:image/jpeg;base64,YQ==" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { ProfilePhoto } from "@/components/team/profile-photo";
afterEach(cleanup);
describe("native sources enter profile adjustment", () => {
  it.each([["camera", "कैमरा से लें"], ["gallery", "गैलरी से चुनें"]])("always opens cropper after Android %s", async (source, label) => {
    mock.choose.mockResolvedValue(new File(["image"], "photo.jpg", { type: "image/jpeg" }));
    Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: true, value: vi.fn(async () => {}) });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(<ProfilePhoto name="QA" />);
    fireEvent.click(screen.getByTestId("profile-photo"));
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(screen.getByTestId("crop-canvas")).toBeInTheDocument());
    expect(mock.choose).toHaveBeenCalledWith(source);
  });
});